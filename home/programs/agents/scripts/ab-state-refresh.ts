#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=HOME,AB_STATE_REFRESH_CONNECT_TIMEOUT_MS,AB_STATE_REFRESH_REQUEST_TIMEOUT_MS,AB_STATE_REFRESH_LOAD_TIMEOUT_MS,AB_STATE_REFRESH_SETTLE_MS,AB_STATE_REFRESH_TARGET_DEADLINE_MS --allow-net=127.0.0.1 --allow-run=fzf,osascript

// Import the running Chrome's auth state into ~/.agent-browser-state/main.json
// so headless agent-browser sessions can replay it.
//
// Modes:
//   (no args)   harvest the origin of Chrome's active tab
//   URL [URL…]  harvest each origin
//   -i          pick origins from the open tabs with fzf
//   --all-cookies  keep every browser cookie instead of narrowing to the
//                  tracked origins
//
// This talks CDP directly instead of driving `agent-browser connect`, and the
// invariant that makes it work is: NEVER attach to a target we did not create.
// `agent-browser connect` attaches to every page target and calls Page.enable
// on one of them; Chrome freezes background tab renderers, a frozen renderer
// never answers Page.enable, and the daemon blocks forever. Cookies come from
// the browser-session Storage domain (no page involved) and storage comes from
// a throwaway tab we opened ourselves, so no pre-existing tab is ever touched.

const DEVTOOLS_PORT_FILE =
  "Library/Application Support/Google/Chrome/DevToolsActivePort";

const REQUEST_TIMEOUT_MS = envInt("AB_STATE_REFRESH_REQUEST_TIMEOUT_MS", 5_000);
const LOAD_TIMEOUT_MS = envInt("AB_STATE_REFRESH_LOAD_TIMEOUT_MS", 10_000);
const SETTLE_MS = envInt("AB_STATE_REFRESH_SETTLE_MS", 2_000);
const CONNECT_TIMEOUT_MS = envInt(
  "AB_STATE_REFRESH_CONNECT_TIMEOUT_MS",
  15_000,
);
const TARGET_DEADLINE_MS = envInt(
  "AB_STATE_REFRESH_TARGET_DEADLINE_MS",
  30_000,
);

function envInt(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type StorageEntry = { name: string; value: string };

export type OriginState = {
  origin: string;
  localStorage: StorageEntry[];
  sessionStorage: StorageEntry[];
};

export type Cookie = {
  name: string;
  domain: string;
  path: string;
  value?: string;
  expires?: number;
  httpOnly?: boolean;
  sameSite?: string;
  secure?: boolean;
  session?: boolean;
  size?: number;
};

export type StateFile = { cookies: Cookie[]; origins: OriginState[] };

export type TargetInfo = {
  targetId: string;
  type: string;
  url: string;
  title?: string;
};

export type TabRow = { origin: string; url: string; display: string };

export type ParsedArgs = {
  mode: "active" | "urls" | "interactive";
  urls: string[];
  allCookies: boolean;
};

export class UsageError extends Error {}

/**
 * The exact key set `main.json` has always carried. Chrome's Storage domain
 * returns a superset (priority, sourceScheme, sourcePort, sameParty,
 * partitionKey); projecting through a whitelist keeps the file shape stable
 * even when a future Chrome adds fields.
 */
export const COOKIE_KEYS = [
  "domain",
  "expires",
  "httpOnly",
  "name",
  "path",
  "sameSite",
  "secure",
  "session",
  "size",
  "value",
] as const;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

export function projectCookie(raw: Record<string, unknown>): Cookie {
  const out: Record<string, unknown> = {};
  for (const key of COOKIE_KEYS) {
    if (raw[key] !== undefined) out[key] = raw[key];
  }
  return out as Cookie;
}

export function originOf(url: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
  return parsed.origin;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function normalizeOrigin(raw: unknown): OriginState | null {
  if (!isPlainObject(raw) || typeof raw.origin !== "string") return null;
  const entries = (v: unknown): StorageEntry[] =>
    Array.isArray(v)
      ? v.filter((e): e is StorageEntry =>
        isPlainObject(e) && typeof e.name === "string" &&
        typeof e.value === "string"
      )
      : [];
  return {
    origin: raw.origin,
    localStorage: entries(raw.localStorage),
    sessionStorage: entries(raw.sessionStorage),
  };
}

/**
 * A tab we just opened always reports an empty sessionStorage (it is per-tab by
 * definition) and can report an empty localStorage while an app is still
 * booting. Plain last-wins would erase a previously captured value on every
 * run, so an empty incoming list defers to the stored one.
 */
export function mergeOriginStorage(
  prev: OriginState,
  next: OriginState,
): OriginState {
  return {
    origin: next.origin,
    localStorage: next.localStorage.length > 0
      ? next.localStorage
      : prev.localStorage,
    sessionStorage: next.sessionStorage.length > 0
      ? next.sessionStorage
      : prev.sessionStorage,
  };
}

/**
 * Last-wins merge over the input sequence: index 0 is the seed (the existing
 * main.json), later entries are this run's captures.
 */
export function mergeStates(inputs: unknown[]): StateFile {
  const cookies = new Map<string, Cookie>();
  const origins = new Map<string, OriginState>();

  for (const input of inputs) {
    if (!isPlainObject(input)) continue;

    if (Array.isArray(input.cookies)) {
      for (const raw of input.cookies) {
        if (!isPlainObject(raw)) continue;
        if (
          typeof raw.name !== "string" || typeof raw.domain !== "string" ||
          typeof raw.path !== "string"
        ) continue;
        cookies.set(
          `${raw.name}\u0000${raw.domain}\u0000${raw.path}`,
          raw as Cookie,
        );
      }
    }

    if (Array.isArray(input.origins)) {
      for (const raw of input.origins) {
        const next = normalizeOrigin(raw);
        if (!next) continue;
        const prev = origins.get(next.origin);
        origins.set(next.origin, prev ? mergeOriginStorage(prev, next) : next);
      }
    }
  }

  return { cookies: [...cookies.values()], origins: [...origins.values()] };
}

/** RFC 6265 domain-match: would this cookie be sent to `host`? */
function domainMatches(cookieDomain: string, host: string): boolean {
  const domain = cookieDomain.replace(/^\./, "").toLowerCase();
  const target = host.toLowerCase();
  return target === domain || target.endsWith(`.${domain}`);
}

export function filterCookiesByOrigins(
  cookies: Cookie[],
  origins: string[],
): Cookie[] {
  const hosts: string[] = [];
  for (const origin of origins) {
    try {
      hosts.push(new URL(origin).hostname);
    } catch {
      // Not an origin we can match against; skip it.
    }
  }
  return cookies.filter((c) =>
    hosts.some((host) => domainMatches(c.domain, host))
  );
}

const INTERNAL_SCHEME =
  /^(chrome|about|chrome-extension|devtools|chrome-error|blob|data|file|view-source):/i;

export function buildTabRows(targets: TargetInfo[]): TabRow[] {
  const byOrigin = new Map<string, { url: string; title: string }>();
  for (const t of targets) {
    if (t.type !== "page") continue;
    if (INTERNAL_SCHEME.test(t.url)) continue;
    const origin = originOf(t.url);
    if (origin === null) continue;
    if (byOrigin.has(origin)) continue;
    byOrigin.set(origin, { url: t.url, title: (t.title ?? "").slice(0, 80) });
  }

  const rows = [...byOrigin.entries()]
    .map(([origin, v]) => ({ origin, url: v.url, title: v.title }))
    .sort((a, b) =>
      a.origin.localeCompare(b.origin) || a.title.localeCompare(b.title)
    );

  const width = rows.reduce((m, r) => Math.max(m, r.origin.length), 0);
  return rows.map((r) => ({
    origin: r.origin,
    url: r.url,
    display: `${r.origin.padEnd(width)}  ${r.title}`,
  }));
}

export function parseArgs(args: string[]): ParsedArgs {
  let allCookies = false;
  let interactive = false;
  const urls: string[] = [];

  for (const arg of args) {
    if (arg === "--all-cookies") {
      allCookies = true;
    } else if (arg === "-i") {
      interactive = true;
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown option: ${arg}`);
    } else {
      const origin = originOf(arg);
      if (origin === null) {
        throw new UsageError(`not an http(s) URL: ${arg}`);
      }
      urls.push(arg);
    }
  }

  if (interactive && urls.length > 0) {
    throw new UsageError("cannot combine -i with positional URL arguments");
  }
  if (interactive) return { mode: "interactive", urls: [], allCookies };
  if (urls.length > 0) return { mode: "urls", urls, allCookies };
  return { mode: "active", urls: [], allCookies };
}

// ---------------------------------------------------------------------------
// CDP client
// ---------------------------------------------------------------------------

type Timer = ReturnType<typeof setTimeout>;

type Pending = {
  resolve: (v: Record<string, unknown>) => void;
  reject: (e: Error) => void;
  timer: Timer;
};

type EventWaiter = {
  method: string;
  sessionId?: string;
  resolve: () => void;
  timer: Timer;
};

class CdpClient {
  #ws: WebSocket;
  #nextId = 1;
  #pending = new Map<number, Pending>();
  #waiters = new Set<EventWaiter>();
  #dead: Error | null = null;

  private constructor(ws: WebSocket) {
    this.#ws = ws;
    ws.onmessage = (ev) => this.#onMessage(String(ev.data));
    ws.onclose = () => this.#kill(new Error("CDP connection closed"));
    ws.onerror = () => this.#kill(new Error("CDP connection error"));
  }

  /**
   * Chrome's DevTools handshake takes 0.8-2.5 s on a browser with dozens of
   * open targets and occasionally refuses a connection outright, so the
   * connect budget is generous and a refusal is retried rather than surfaced.
   */
  static async connect(wsUrl: string, attempts = 3): Promise<CdpClient> {
    let last: Error = new Error(`failed to connect to ${wsUrl}`);
    for (let i = 0; i < attempts; i++) {
      if (i > 0) await sleep(500);
      try {
        return await CdpClient.#connectOnce(wsUrl, CONNECT_TIMEOUT_MS);
      } catch (e) {
        last = e instanceof Error ? e : new Error(String(e));
      }
    }
    throw last;
  }

  static #connectOnce(wsUrl: string, timeoutMs: number): Promise<CdpClient> {
    return new Promise((resolve, reject) => {
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl);
      } catch (e) {
        reject(e instanceof Error ? e : new Error(String(e)));
        return;
      }
      const timer = setTimeout(() => {
        try {
          ws.close();
        } catch {
          // Already closing.
        }
        reject(new Error(`timed out connecting to ${wsUrl}`));
      }, timeoutMs);
      ws.onopen = () => {
        clearTimeout(timer);
        resolve(new CdpClient(ws));
      };
      ws.onerror = () => {
        clearTimeout(timer);
        reject(new Error(`failed to connect to ${wsUrl}`));
      };
    });
  }

  #kill(err: Error) {
    if (this.#dead) return;
    this.#dead = err;
    for (const [, p] of this.#pending) {
      clearTimeout(p.timer);
      p.reject(err);
    }
    this.#pending.clear();
    for (const w of this.#waiters) clearTimeout(w.timer);
    this.#waiters.clear();
  }

  #onMessage(data: string) {
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }

    if (typeof msg.id === "number") {
      const p = this.#pending.get(msg.id);
      if (!p) return;
      this.#pending.delete(msg.id);
      clearTimeout(p.timer);
      if (msg.error) {
        p.reject(new Error(`CDP error: ${JSON.stringify(msg.error)}`));
      } else {
        p.resolve((msg.result ?? {}) as Record<string, unknown>);
      }
      return;
    }

    if (typeof msg.method === "string") {
      for (const w of [...this.#waiters]) {
        if (w.method !== msg.method) continue;
        if (w.sessionId && msg.sessionId !== w.sessionId) continue;
        this.#waiters.delete(w);
        clearTimeout(w.timer);
        w.resolve();
      }
    }
  }

  /** Every request is time-boxed; nothing in this client awaits unbounded. */
  send(
    method: string,
    params: Record<string, unknown> = {},
    sessionId?: string,
    timeoutMs = REQUEST_TIMEOUT_MS,
  ): Promise<Record<string, unknown>> {
    if (this.#dead) return Promise.reject(this.#dead);
    const id = this.#nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(new Error(`timed out waiting for ${method}`));
      }, timeoutMs);
      this.#pending.set(id, { resolve, reject, timer });
      const payload: Record<string, unknown> = { id, method, params };
      if (sessionId) payload.sessionId = sessionId;
      try {
        this.#ws.send(JSON.stringify(payload));
      } catch (e) {
        this.#pending.delete(id);
        clearTimeout(timer);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
    });
  }

  /** Resolves true when the event arrives, false when the wait times out. */
  waitForEvent(
    method: string,
    sessionId: string | undefined,
    timeoutMs: number,
  ): Promise<boolean> {
    if (this.#dead) return Promise.resolve(false);
    return new Promise((resolve) => {
      const waiter: EventWaiter = {
        method,
        sessionId,
        resolve: () => resolve(true),
        timer: setTimeout(() => {
          this.#waiters.delete(waiter);
          resolve(false);
        }, timeoutMs),
      };
      this.#waiters.add(waiter);
    });
  }

  /**
   * Waits (briefly) for the close handshake so Chrome sees a clean shutdown
   * rather than a process exit yanking the socket mid-frame.
   */
  close(): Promise<void> {
    this.#kill(new Error("CDP connection closed by client"));
    if (this.#ws.readyState === WebSocket.CLOSED) return Promise.resolve();
    return new Promise((resolve) => {
      const done = setTimeout(resolve, 500);
      this.#ws.onclose = () => {
        clearTimeout(done);
        resolve();
      };
      try {
        this.#ws.close();
      } catch {
        clearTimeout(done);
        resolve();
      }
    });
  }
}

// ---------------------------------------------------------------------------
// Harvesting
// ---------------------------------------------------------------------------

const HARVEST_EXPR = `(() => {
  const dump = (s) => {
    const out = [];
    try {
      for (let i = 0; i < s.length; i++) {
        const k = s.key(i);
        out.push({ name: k, value: s.getItem(k) });
      }
    } catch (_) {}
    return out;
  };
  return {
    origin: location.origin,
    href: location.href,
    localStorage: dump(localStorage),
    sessionStorage: dump(sessionStorage),
  };
})()`;

const createdTargets = new Set<string>();

async function harvestOrigin(
  client: CdpClient,
  url: string,
): Promise<OriginState | null> {
  const created = await client.send("Target.createTarget", {
    url: "about:blank",
    background: true,
    newWindow: false,
  });
  const targetId = String(created.targetId ?? "");
  if (!targetId) throw new Error("Target.createTarget returned no targetId");
  createdTargets.add(targetId);

  try {
    return await Promise.race([
      harvestInTarget(client, targetId, url),
      sleep(TARGET_DEADLINE_MS).then(() => {
        throw new Error(`deadline exceeded for ${url}`);
      }),
    ]);
  } finally {
    try {
      await client.send("Target.closeTarget", { targetId });
    } catch {
      // The tab may already be gone, or the socket may be down. Either way the
      // run must not fail on cleanup.
    }
    createdTargets.delete(targetId);
  }
}

async function harvestInTarget(
  client: CdpClient,
  targetId: string,
  url: string,
): Promise<OriginState | null> {
  const attached = await client.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  const sessionId = String(attached.sessionId ?? "");
  if (!sessionId) {
    throw new Error("Target.attachToTarget returned no sessionId");
  }

  await client.send("Page.enable", {}, sessionId);

  // Navigate only after Page.enable so loadEventFired cannot be missed in the
  // gap between target creation and subscribing.
  const loaded = client.waitForEvent(
    "Page.loadEventFired",
    sessionId,
    LOAD_TIMEOUT_MS,
  );
  const nav = await client.send("Page.navigate", { url }, sessionId);
  if (nav.errorText) {
    console.error(
      `ab-state-refresh: navigation failed for ${url}: ${nav.errorText}`,
    );
    return null;
  }
  if (!(await loaded)) {
    console.error(
      `ab-state-refresh: load event not seen for ${url}; evaluating anyway.`,
    );
  }
  if (SETTLE_MS > 0) await sleep(SETTLE_MS);

  const evaluated = await client.send("Runtime.evaluate", {
    expression: HARVEST_EXPR,
    returnByValue: true,
    awaitPromise: false,
  }, sessionId);
  if (evaluated.exceptionDetails) {
    console.error(
      `ab-state-refresh: could not read storage for ${url}: ${
        JSON.stringify(evaluated.exceptionDetails)
      }`,
    );
    return null;
  }

  const result = evaluated.result as { value?: unknown } | undefined;
  const state = normalizeOrigin(result?.value);
  if (!state || originOf(state.origin) === null) {
    console.error(`ab-state-refresh: no usable origin for ${url}.`);
    return null;
  }
  return state;
}

async function collectCookies(client: CdpClient): Promise<Cookie[]> {
  const res = await client.send("Storage.getCookies", {});
  const raw = Array.isArray(res.cookies) ? res.cookies : [];
  return raw.filter(isPlainObject).map(projectCookie);
}

async function listTabs(client: CdpClient): Promise<TabRow[]> {
  const res = await client.send("Target.getTargets", {});
  const raw = Array.isArray(res.targetInfos) ? res.targetInfos : [];
  return buildTabRows(raw.filter(isPlainObject) as unknown as TargetInfo[]);
}

// ---------------------------------------------------------------------------
// Modes
// ---------------------------------------------------------------------------

async function pickWithFzf(rows: TabRow[]): Promise<TabRow[]> {
  const index = new Map(rows.map((r) => [r.display, r]));
  const child = new Deno.Command("fzf", {
    args: [
      "--height",
      "40%",
      "--reverse",
      "--border",
      "--multi",
      "--header",
      "Select origins to refresh (TAB to mark, ESC to cancel)",
    ],
    stdin: "piped",
    stdout: "piped",
    stderr: "inherit",
  }).spawn();

  const writer = child.stdin.getWriter();
  await writer.write(
    new TextEncoder().encode(rows.map((r) => r.display).join("\n") + "\n"),
  );
  await writer.close();

  const out = await child.output();
  if (out.code !== 0) return [];
  return new TextDecoder().decode(out.stdout)
    .split("\n")
    .map((line) => index.get(line))
    .filter((r): r is TabRow => r !== undefined);
}

async function activeTabUrl(): Promise<string | null> {
  try {
    const out = await new Deno.Command("osascript", {
      args: [
        "-e",
        'tell application "Google Chrome" to get URL of active tab of front window',
      ],
      stdout: "piped",
      stderr: "piped",
    }).output();
    if (out.code !== 0) return null;
    const url = new TextDecoder().decode(out.stdout).trim();
    return originOf(url) === null ? null : url;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// State file
// ---------------------------------------------------------------------------

async function readSeed(statePath: string): Promise<unknown | null> {
  let text: string;
  try {
    text = await Deno.readTextFile(statePath);
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return null;
    throw e;
  }
  if (text.trim() === "") return null;
  try {
    return JSON.parse(text);
  } catch {
    console.error(
      `ab-state-refresh: existing ${statePath} is not valid JSON; ignoring and rebuilding.`,
    );
    return null;
  }
}

async function writeState(
  stateDir: string,
  statePath: string,
  state: StateFile,
): Promise<void> {
  await Deno.mkdir(stateDir, { recursive: true, mode: 0o700 });
  await Deno.chmod(stateDir, 0o700);

  const tmp = `${stateDir}/.main.json.tmp.${Deno.pid}.${
    crypto.randomUUID().slice(0, 8)
  }`;
  try {
    await Deno.writeTextFile(tmp, JSON.stringify(state, null, 2) + "\n", {
      mode: 0o600,
    });
    // writeTextFile's mode is masked by umask; chmod closes the window before
    // the file becomes main.json.
    await Deno.chmod(tmp, 0o600);
    await Deno.rename(tmp, statePath);
  } finally {
    try {
      await Deno.remove(tmp);
    } catch {
      // Already renamed away, or never created.
    }
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

const USAGE = "usage: ab-state-refresh [-i | URL [URL ...]] [--all-cookies]";

function discoverWsUrl(home: string): string {
  const portFile = `${home}/${DEVTOOLS_PORT_FILE}`;
  let text: string;
  try {
    text = Deno.readTextFileSync(portFile);
  } catch {
    console.error(
      `ab-state-refresh: DevToolsActivePort not found at ${portFile}.`,
    );
    console.error(
      "  Start Chrome with --remote-debugging-port=9222 (or enable it via chrome://inspect/#remote-debugging),",
    );
    console.error(
      "  log in to your target sites, then re-run ab-state-refresh.",
    );
    throw new SilentExit(1);
  }
  const lines = text.split("\n");
  const port = lines[0]?.trim();
  const path = lines[1]?.trim() ?? "";
  if (!port) {
    console.error(`ab-state-refresh: ${portFile} has no port.`);
    throw new SilentExit(1);
  }
  return `ws://127.0.0.1:${port}${path}`;
}

class SilentExit extends Error {
  constructor(public code: number) {
    super("silent exit");
  }
}

async function main(): Promise<number> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(Deno.args);
  } catch (e) {
    if (e instanceof UsageError) {
      console.error(`ab-state-refresh: ${e.message}`);
      console.error(`  ${USAGE}`);
      return 1;
    }
    throw e;
  }

  if (parsed.mode === "interactive") {
    if (!Deno.stdin.isTerminal()) {
      console.error(
        "ab-state-refresh -i: requires TTY (fzf cannot run on piped stdin)",
      );
      return 1;
    }
    try {
      await new Deno.Command("fzf", {
        args: ["--version"],
        stdout: "null",
        stderr: "null",
      })
        .output();
    } catch {
      console.error("ab-state-refresh -i: fzf not found in PATH");
      return 1;
    }
  }

  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME is not set");
  const stateDir = `${home}/.agent-browser-state`;
  const statePath = `${stateDir}/main.json`;

  const wsUrl = discoverWsUrl(home);
  const seed = await readSeed(statePath);

  let client: CdpClient;
  try {
    client = await CdpClient.connect(wsUrl);
  } catch (e) {
    console.error(
      `ab-state-refresh: failed to connect to ${wsUrl}: ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
    return 1;
  }

  // Exiting synchronously here would kill the process before the close frames
  // reach Chrome, leaving the tabs we opened behind on the user's tab strip.
  const onSignal = async () => {
    await Promise.race([
      Promise.allSettled(
        [...createdTargets].map((targetId) =>
          client.send("Target.closeTarget", { targetId }, undefined, 2_000)
        ),
      ),
      sleep(3_000),
    ]);
    Deno.exit(130);
  };
  Deno.addSignalListener("SIGINT", onSignal);
  Deno.addSignalListener("SIGTERM", onSignal);

  try {
    await client.send("Browser.getVersion", {});

    let requested: string[];
    switch (parsed.mode) {
      case "urls":
        requested = parsed.urls;
        break;
      case "interactive": {
        const rows = await listTabs(client);
        if (rows.length === 0) {
          console.error(
            "ab-state-refresh: no eligible tabs to pick (all internal pages?).",
          );
          return 1;
        }
        const picked = await pickWithFzf(rows);
        if (picked.length === 0) return 0;
        requested = picked.map((r) => r.url);
        break;
      }
      case "active": {
        const url = await activeTabUrl();
        if (url === null) {
          console.error(
            "ab-state-refresh: could not resolve the active tab (grant Automation permission, or pass the URL explicitly); refreshing cookies only.",
          );
          requested = [];
        } else {
          requested = [url];
        }
        break;
      }
    }

    const captured: OriginState[] = [];
    const notCaptured: string[] = [];
    for (const url of requested) {
      const requestedOrigin = originOf(url);
      let state: OriginState | null = null;
      try {
        state = await harvestOrigin(client, url);
      } catch (e) {
        console.error(
          `ab-state-refresh: ${url}: ${
            e instanceof Error ? e.message : String(e)
          }`,
        );
      }
      if (state === null) {
        if (requestedOrigin) notCaptured.push(requestedOrigin);
        continue;
      }
      captured.push(state);
      // Record what actually loaded, never relabel an IdP's storage as the app.
      if (requestedOrigin && state.origin !== requestedOrigin) {
        notCaptured.push(requestedOrigin);
      }
    }

    const cookies = await collectCookies(client);

    if (cookies.length === 0 && captured.length === 0) {
      console.error(
        "ab-state-refresh: no new state captured; main.json unchanged.",
      );
      return 1;
    }

    const merged = mergeStates([seed, { cookies, origins: captured }]);
    if (!parsed.allCookies) {
      const before = merged.cookies.length;
      merged.cookies = filterCookiesByOrigins(
        merged.cookies,
        merged.origins.map((o) => o.origin),
      );
      const dropped = before - merged.cookies.length;
      if (dropped > 0) {
        console.error(
          `ab-state-refresh: dropped ${dropped} cookie${
            dropped === 1 ? "" : "s"
          } outside tracked origins (use --all-cookies to keep them)`,
        );
      }
    }

    await writeState(stateDir, statePath, merged);

    if (notCaptured.length > 0) {
      console.error(
        `ab-state-refresh: selected origins not saved: ${
          [...new Set(notCaptured)].join(", ")
        }`,
      );
    }

    const size = (await Deno.stat(statePath)).size;
    console.log(
      `state saved: ${statePath} (${size} bytes, ${new Date().toString()})`,
    );
    return 0;
  } finally {
    Deno.removeSignalListener("SIGINT", onSignal);
    Deno.removeSignalListener("SIGTERM", onSignal);
    await client.close();
  }
}

if (import.meta.main) {
  try {
    Deno.exit(await main());
  } catch (e) {
    if (e instanceof SilentExit) Deno.exit(e.code);
    console.error(
      `ab-state-refresh: ${e instanceof Error ? e.message : String(e)}`,
    );
    Deno.exit(1);
  }
}
