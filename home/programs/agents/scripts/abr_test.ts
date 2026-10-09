import { test } from "bun:test";
import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:http";
import { type AddressInfo, createServer as createTcpServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type WebSocket as ServerSocket, WebSocketServer } from "ws";
import { run } from "../lib/proc.ts";
import {
  buildTabRows,
  type Cookie,
  COOKIE_KEYS,
  filterCookiesByOrigins,
  mergeOriginStorage,
  mergeStates,
  originOf,
  parseArgs,
  projectCookie,
  UsageError,
} from "./abr.ts";

const SCRIPT = join(import.meta.dirname, "abr.ts");
// The script runs with a throwaway HOME, where Bun would otherwise leave its
// transpiler cache.
const TRANSPILER_CACHE = `${process.env.HOME}/Library/Caches/bun/@t@`;

// ---------------------------------------------------------------------------
// Mock CDP server
// ---------------------------------------------------------------------------

type TargetInfo = {
  targetId: string;
  type: string;
  title?: string;
  url: string;
};

type MockConfig = {
  targets?: TargetInfo[];
  cookies?: Record<string, unknown>[];
  /** Page.enable is never answered for these targets (the frozen-tab bug). */
  frozenTargetIds?: Set<string>;
  /** Page.loadEventFired is never emitted for these targets. */
  neverFireLoad?: Set<string>;
  /** Runtime.evaluate payload, keyed by the URL passed to Page.navigate. */
  storageByUrl?: Record<string, unknown>;
  /** Page.navigate answers with errorText for these URLs. */
  navigateErrorByUrl?: Record<string, string>;
  /** Runtime.evaluate answers with exceptionDetails for these URLs. */
  evaluateThrowsForUrl?: Set<string>;
  /** Drop the socket immediately after receiving this method. */
  closeAfterMethod?: string;
  /** Refuse this many WebSocket upgrades before accepting any. */
  rejectFirstUpgrades?: number;
};

type MockCall = {
  method: string;
  params: Record<string, unknown>;
  sessionId?: string;
};

type MockServer = {
  port: number;
  wsPath: string;
  calls: MockCall[];
  createdTargets: { targetId: string; params: Record<string, unknown> }[];
  closedTargets: string[];
  navigated: { targetId: string; url: string }[];
  shutdown(): Promise<void>;
};

const WS_PATH = "/devtools/browser/mock-0000";

function startMockCdp(cfg: MockConfig = {}): Promise<MockServer> {
  const calls: MockCall[] = [];
  const createdTargets: {
    targetId: string;
    params: Record<string, unknown>;
  }[] = [];
  const closedTargets: string[] = [];
  const navigated: { targetId: string; url: string }[] = [];
  const urlByTarget = new Map<string, string>();
  const targetBySession = new Map<string, string>();
  let seq = 0;
  let refusalsLeft = cfg.rejectFirstUpgrades ?? 0;

  const refuse = (status: string, body: string) =>
    `HTTP/1.1 ${status}\r\nContent-Type: text/plain\r\n` +
    `Content-Length: ${body.length}\r\nConnection: close\r\n\r\n${body}`;

  return new Promise((resolveServer) => {
    const server = createServer((_req, res) => {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("not a websocket");
    });
    const wss = new WebSocketServer({ noServer: true });
    const open = new Set<ServerSocket>();

    server.on("upgrade", (req, tcp, head) => {
      if (req.headers.upgrade !== "websocket") {
        tcp.end(refuse("400 Bad Request", "not a websocket"));
        return;
      }
      if (refusalsLeft > 0) {
        refusalsLeft--;
        tcp.end(refuse("503 Service Unavailable", "try again"));
        return;
      }
      wss.handleUpgrade(req, tcp, head, (socket) => {
        open.add(socket);
        socket.on("close", () => open.delete(socket));
        serve(socket);
      });
    });

    server.listen(0, "127.0.0.1", () => {
      resolveServer({
        port: (server.address() as AddressInfo).port,
        wsPath: WS_PATH,
        calls,
        createdTargets,
        closedTargets,
        navigated,
        shutdown: () =>
          new Promise<void>((resolve) => {
            for (const socket of open) socket.terminate();
            server.close(() => resolve());
          }),
      });
    });

    const serve = (socket: ServerSocket) => {
      const send = (payload: unknown) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify(payload));
        }
      };
      const reply = (
        id: number,
        result: unknown,
        sessionId?: string,
      ) => send(sessionId ? { id, result, sessionId } : { id, result });

      socket.on("message", (data) => {
        const msg = JSON.parse(String(data)) as {
          id: number;
          method: string;
          params?: Record<string, unknown>;
          sessionId?: string;
        };
        const params = msg.params ?? {};
        calls.push({
          method: msg.method,
          params,
          sessionId: msg.sessionId,
        });

        if (cfg.closeAfterMethod && msg.method === cfg.closeAfterMethod) {
          socket.close();
          return;
        }

        const tid = msg.sessionId
          ? targetBySession.get(msg.sessionId) ?? ""
          : "";

        switch (msg.method) {
          case "Browser.getVersion":
            reply(msg.id, { product: "MockChrome/1" });
            return;
          case "Target.getTargets":
            reply(msg.id, { targetInfos: cfg.targets ?? [] });
            return;
          case "Storage.getCookies":
            reply(msg.id, { cookies: cfg.cookies ?? [] });
            return;
          case "Target.createTarget": {
            const targetId = `mock-${++seq}`;
            createdTargets.push({ targetId, params });
            reply(msg.id, { targetId });
            return;
          }
          case "Target.attachToTarget": {
            const target = String(params.targetId);
            const sessionId = `s-${target}`;
            targetBySession.set(sessionId, target);
            send({
              method: "Target.attachedToTarget",
              params: { sessionId, targetInfo: { targetId: target } },
            });
            reply(msg.id, { sessionId });
            return;
          }
          case "Page.enable":
            // The bug under test: a frozen renderer never answers.
            if (cfg.frozenTargetIds?.has(tid)) return;
            reply(msg.id, {}, msg.sessionId);
            return;
          case "Page.navigate": {
            const url = String(params.url);
            navigated.push({ targetId: tid, url });
            urlByTarget.set(tid, url);
            const errorText = cfg.navigateErrorByUrl?.[url];
            if (errorText) {
              reply(msg.id, { frameId: `f-${tid}`, errorText }, msg.sessionId);
              return;
            }
            reply(msg.id, { frameId: `f-${tid}` }, msg.sessionId);
            if (!cfg.neverFireLoad?.has(tid)) {
              setTimeout(
                () =>
                  send({
                    method: "Page.loadEventFired",
                    params: { timestamp: 1 },
                    sessionId: msg.sessionId,
                  }),
                20,
              );
            }
            return;
          }
          case "Runtime.evaluate": {
            const url = urlByTarget.get(tid) ?? "";
            if (cfg.evaluateThrowsForUrl?.has(url)) {
              reply(
                msg.id,
                {
                  result: { type: "undefined" },
                  exceptionDetails: { text: "boom" },
                },
                msg.sessionId,
              );
              return;
            }
            const value = cfg.storageByUrl?.[url] ?? {
              origin: new URL(url).origin,
              href: url,
              localStorage: [],
              sessionStorage: [],
            };
            reply(
              msg.id,
              { result: { type: "object", value } },
              msg.sessionId,
            );
            return;
          }
          case "Target.closeTarget":
            closedTargets.push(String(params.targetId));
            reply(msg.id, { success: true });
            return;
          default:
            reply(msg.id, {}, msg.sessionId);
        }
      });
    };
  });
}

// ---------------------------------------------------------------------------
// Subprocess harness: fake $HOME whose DevToolsActivePort points at the mock
// ---------------------------------------------------------------------------

type RunOutcome = { code: number; stdout: string; stderr: string };

async function makeFakeHome(server?: MockServer): Promise<string> {
  const home = await mkdtemp(join(tmpdir(), "abr-test-"));
  if (server) {
    const dir = `${home}/Library/Application Support/Google/Chrome`;
    await mkdir(dir, { recursive: true });
    await writeFile(
      `${dir}/DevToolsActivePort`,
      `${server.port}\n${server.wsPath}\n`,
    );
  }
  return home;
}

async function runScript(
  home: string,
  args: string[],
  extraEnv: Record<string, string> = {},
): Promise<RunOutcome> {
  const out = await run(SCRIPT, args, {
    env: {
      HOME: home,
      PATH: process.env.PATH ?? "",
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: TRANSPILER_CACHE,
      AB_STATE_REFRESH_CONNECT_TIMEOUT_MS: "1500",
      AB_STATE_REFRESH_REQUEST_TIMEOUT_MS: "400",
      AB_STATE_REFRESH_LOAD_TIMEOUT_MS: "400",
      AB_STATE_REFRESH_SETTLE_MS: "0",
      AB_STATE_REFRESH_TARGET_DEADLINE_MS: "2000",
      ...extraEnv,
    },
    clearEnv: true,
  });
  return { code: out.code, stdout: out.stdout, stderr: out.stderr };
}

async function readState(home: string): Promise<Record<string, unknown>> {
  return JSON.parse(
    await readFile(`${home}/.agent-browser-state/main.json`, "utf8"),
  );
}

function cookie(over: Partial<Cookie> = {}): Cookie {
  return {
    domain: ".example.com",
    expires: -1,
    httpOnly: false,
    name: "sid",
    path: "/",
    sameSite: "Lax",
    secure: true,
    session: true,
    size: 10,
    value: "v",
    ...over,
  };
}

// ---------------------------------------------------------------------------
// Pure functions
// ---------------------------------------------------------------------------

test("projectCookie keeps exactly the on-disk key set", () => {
  const out = projectCookie({
    name: "sid",
    value: "v",
    domain: ".example.com",
    path: "/",
    expires: 1810800681.031688,
    size: 67,
    httpOnly: false,
    secure: true,
    session: false,
    sameSite: "None",
    // CDP superset that must not reach main.json
    priority: "Medium",
    sourceScheme: "Secure",
    sourcePort: 443,
    sameParty: false,
    partitionKey: { topLevelSite: "https://x.example" },
  });
  assertEquals(Object.keys(out), [...COOKIE_KEYS]);
  assertEquals(out.expires, 1810800681.031688);
  assertEquals(out.sameSite, "None");
});

test("projectCookie omits absent keys rather than emitting undefined", () => {
  const out = projectCookie({
    name: "sid",
    value: "v",
    domain: ".example.com",
    path: "/",
    size: 10,
    httpOnly: false,
    secure: true,
    session: true,
  });
  assert(!Object.keys(out).includes("expires"));
  assert(!Object.keys(out).includes("sameSite"));
});

test("mergeStates: seed alone round-trips", () => {
  const seed = { cookies: [cookie()], origins: [] };
  assertEquals(mergeStates([seed]), { cookies: [cookie()], origins: [] });
});

test("mergeStates: later input wins on [name, domain, path]", () => {
  const seed = { cookies: [cookie({ value: "old" })], origins: [] };
  const fresh = { cookies: [cookie({ value: "new" })], origins: [] };
  const out = mergeStates([seed, fresh]);
  assertEquals(out.cookies.length, 1);
  assertEquals(out.cookies[0].value, "new");
});

test("mergeStates: seed entries absent from later inputs survive", () => {
  const seed = { cookies: [cookie({ name: "a" }), cookie({ name: "b" })] };
  const fresh = { cookies: [cookie({ name: "b", value: "new" })] };
  const out = mergeStates([seed, fresh]);
  assertEquals(out.cookies.map((c) => [c.name, c.value]), [
    ["a", "v"],
    ["b", "new"],
  ]);
});

test("mergeStates: same name+domain but different path stay separate", () => {
  const out = mergeStates([{
    cookies: [cookie({ path: "/" }), cookie({ path: "/app" })],
  }]);
  assertEquals(out.cookies.length, 2);
});

test("mergeStates: origins dedupe by origin, later wins", () => {
  const seed = {
    origins: [{
      origin: "https://a.example",
      localStorage: [{ name: "k", value: "old" }],
      sessionStorage: [],
    }],
  };
  const fresh = {
    origins: [{
      origin: "https://a.example",
      localStorage: [{ name: "k", value: "new" }],
      sessionStorage: [],
    }],
  };
  const out = mergeStates([seed, fresh]);
  assertEquals(out.origins.length, 1);
  assertEquals(out.origins[0].localStorage[0].value, "new");
});

test("mergeStates ignores non-object inputs", () => {
  const out = mergeStates([null, "str", 42, { cookies: [cookie()] }]);
  assertEquals(out.cookies.length, 1);
  assertEquals(out.origins, []);
});

test("mergeStates output key order is cookies then origins", () => {
  assertEquals(Object.keys(mergeStates([])), ["cookies", "origins"]);
});

test("mergeOriginStorage: empty incoming storage never clobbers a non-empty value", () => {
  const prev = {
    origin: "https://a.example",
    localStorage: [{ name: "k", value: "v" }],
    sessionStorage: [{ name: "s", value: "1" }],
  };
  const next = {
    origin: "https://a.example",
    localStorage: [],
    sessionStorage: [],
  };
  assertEquals(mergeOriginStorage(prev, next), prev);
});

test("mergeOriginStorage: non-empty incoming storage replaces the stored value", () => {
  const prev = {
    origin: "https://a.example",
    localStorage: [{ name: "k", value: "old" }],
    sessionStorage: [{ name: "s", value: "1" }],
  };
  const next = {
    origin: "https://a.example",
    localStorage: [{ name: "k", value: "new" }],
    sessionStorage: [],
  };
  assertEquals(mergeOriginStorage(prev, next), {
    origin: "https://a.example",
    localStorage: [{ name: "k", value: "new" }],
    sessionStorage: [{ name: "s", value: "1" }],
  });
});

test("filterCookiesByOrigins keeps the host and its parent domains only", () => {
  const cookies = [
    cookie({ name: "exact", domain: "lightdash.kworkinc.com" }),
    cookie({ name: "parent", domain: ".kworkinc.com" }),
    cookie({ name: "sibling", domain: "api.kworkinc.com" }),
    cookie({ name: "other", domain: ".33across.com" }),
    cookie({ name: "suffix-trap", domain: "evilkworkinc.com" }),
  ];
  const kept = filterCookiesByOrigins(cookies, [
    "https://lightdash.kworkinc.com",
  ]);
  assertEquals(kept.map((c) => c.name), ["exact", "parent"]);
});

test("filterCookiesByOrigins with no tracked origins keeps nothing", () => {
  assertEquals(filterCookiesByOrigins([cookie()], []), []);
});

test("originOf", () => {
  assertEquals(originOf("https://h:3000/a?x=1"), "https://h:3000");
  assertEquals(originOf("https://h/"), "https://h");
  assertEquals(originOf("http://h:80/"), "http://h");
  assertEquals(originOf("chrome-error://chromewebdata/"), null);
  assertEquals(originOf("about:blank"), null);
  assertEquals(originOf("not a url"), null);
});

test("buildTabRows filters, dedupes by origin, pads and truncates", () => {
  const rows = buildTabRows([
    { targetId: "1", type: "page", url: "chrome://newtab/", title: "New Tab" },
    { targetId: "2", type: "page", url: "about:blank", title: "" },
    {
      targetId: "3",
      type: "page",
      url: "chrome-extension://abc/popup.html",
      title: "Ext",
    },
    { targetId: "4", type: "page", url: "devtools://devtools/x", title: "DT" },
    { targetId: "5", type: "page", url: "file:///tmp/x.html", title: "File" },
    {
      targetId: "6",
      type: "service_worker",
      url: "https://sw.example/sw.js",
      title: "SW",
    },
    { targetId: "7", type: "page", url: "https://b.example/one", title: "B1" },
    { targetId: "8", type: "page", url: "https://b.example/two", title: "B2" },
    {
      targetId: "9",
      type: "page",
      url: "https://a.example:3000/x",
      title: "A".repeat(120),
    },
  ]);

  assertEquals(rows.map((r) => r.origin), [
    "https://a.example:3000",
    "https://b.example",
  ]);
  // First tab of a deduped origin supplies the navigation URL.
  assertEquals(rows[1].url, "https://b.example/one");
  // Origin column padded to the widest origin, then two spaces.
  assertEquals(
    rows[1].display,
    "https://b.example       B1",
  );
  assertEquals(rows[0].display.endsWith("A".repeat(80)), true);
});

test("buildTabRows is order-independent", () => {
  const targets = [
    { targetId: "1", type: "page", url: "https://c.example/", title: "C" },
    { targetId: "2", type: "page", url: "https://a.example/", title: "A" },
    { targetId: "3", type: "page", url: "https://b.example/", title: "B" },
  ];
  const forward = buildTabRows(targets).map((r) => r.origin);
  const reversed = buildTabRows([...targets].reverse()).map((r) => r.origin);
  assertEquals(forward, reversed);
  assertEquals(forward, [
    "https://a.example",
    "https://b.example",
    "https://c.example",
  ]);
});

test("parseArgs modes and validation", () => {
  assertEquals(parseArgs([]), {
    mode: "active",
    urls: [],
    allCookies: false,
  });
  assertEquals(parseArgs(["https://a.example", "https://b.example/x"]), {
    mode: "urls",
    urls: ["https://a.example", "https://b.example/x"],
    allCookies: false,
  });
  assertEquals(parseArgs(["-i"]), {
    mode: "interactive",
    urls: [],
    allCookies: false,
  });
  assertEquals(parseArgs(["--all-cookies", "https://a.example"]), {
    mode: "urls",
    urls: ["https://a.example"],
    allCookies: true,
  });
  assertThrows(() => parseArgs(["-i", "https://a.example"]), UsageError);
  assertThrows(() => parseArgs(["--nope"]), UsageError);
  assertThrows(() => parseArgs(["ftp://x/"]), UsageError);
  assertThrows(() => parseArgs(["not-a-url"]), UsageError);
});

// ---------------------------------------------------------------------------
// CLI contract
// ---------------------------------------------------------------------------

test("CLI: -i combined with URLs is a usage error", async () => {
  const home = await makeFakeHome();
  try {
    const r = await runScript(home, ["-i", "https://a.example"]);
    assertEquals(r.code, 1);
    assert(r.stderr.includes("cannot combine -i"), r.stderr);
  } finally {
    await rm(home, { recursive: true });
  }
});

test("CLI: unknown flag and non-http URL are usage errors", async () => {
  const home = await makeFakeHome();
  try {
    assertEquals((await runScript(home, ["--nope"])).code, 1);
    assertEquals((await runScript(home, ["ftp://x/"])).code, 1);
  } finally {
    await rm(home, { recursive: true });
  }
});

test("CLI: missing DevToolsActivePort gives the actionable message", async () => {
  const home = await makeFakeHome();
  try {
    const r = await runScript(home, ["https://a.example"]);
    assertEquals(r.code, 1);
    assert(
      r.stderr.includes("--remote-debugging-port=9222"),
      r.stderr,
    );
  } finally {
    await rm(home, { recursive: true });
  }
});

// ---------------------------------------------------------------------------
// End-to-end against the mock CDP server
// ---------------------------------------------------------------------------

function frozenFixture(): MockConfig {
  const targets: TargetInfo[] = [];
  const frozen = new Set<string>();
  for (let i = 0; i < 42; i++) {
    const id = `pre-${i}`;
    targets.push({
      targetId: id,
      type: "page",
      title: `Tab ${i}`,
      url: `https://tab${i}.example/`,
    });
    if (i % 2 === 0 && frozen.size < 16) frozen.add(id);
  }
  return {
    targets,
    frozenTargetIds: frozen,
    cookies: [
      {
        name: "sid",
        value: "abc",
        domain: ".app.example",
        path: "/",
        expires: -1,
        size: 10,
        httpOnly: true,
        secure: true,
        session: true,
        sameSite: "Lax",
        priority: "Medium",
        sourcePort: 443,
      },
      {
        name: "ad",
        value: "xyz",
        domain: ".tracker.example",
        path: "/",
        expires: 111,
        size: 8,
        httpOnly: false,
        secure: true,
        session: false,
        sameSite: "None",
      },
    ],
    storageByUrl: {
      "https://app.example/dash": {
        origin: "https://app.example",
        href: "https://app.example/dash",
        localStorage: [{ name: "token", value: "t1" }],
        sessionStorage: [],
      },
    },
  };
}

test(
  "never attaches to a target it did not create, even with 16 frozen tabs",
  async () => {
    const server = await startMockCdp(frozenFixture());
    const home = await makeFakeHome(server);
    try {
      const started = Date.now();
      const r = await runScript(home, ["https://app.example/dash"]);
      const elapsed = Date.now() - started;
      assertEquals(r.code, 0, r.stderr);
      assert(elapsed < 15_000, `took ${elapsed}ms`);

      const created = new Set(server.createdTargets.map((t) => t.targetId));
      const attached = server.calls
        .filter((c) => c.method === "Target.attachToTarget")
        .map((c) => String(c.params.targetId));
      assert(attached.length > 0, "expected at least one attach");
      for (const id of attached) {
        assert(created.has(id), `attached to a pre-existing target: ${id}`);
      }
      assertEquals(
        server.calls.filter((c) => c.method === "Target.setDiscoverTargets")
          .length,
        0,
      );
      assertEquals(
        server.calls.filter((c) => c.method === "Target.setAutoAttach").length,
        0,
      );

      const state = await readState(home);
      assertEquals(
        (state.origins as { origin: string }[])[0].origin,
        "https://app.example",
      );
    } finally {
      await rm(home, { recursive: true });
      await server.shutdown();
    }
  },
  30_000,
);

test("a refused CDP handshake is retried rather than surfaced", async () => {
  const cfg = frozenFixture();
  cfg.rejectFirstUpgrades = 2;
  const server = await startMockCdp(cfg);
  const home = await makeFakeHome(server);
  try {
    const r = await runScript(home, ["https://app.example/dash"]);
    assertEquals(r.code, 0, r.stderr);
    const state = await readState(home);
    assertEquals(
      (state.origins as { origin: string }[])[0].origin,
      "https://app.example",
    );
  } finally {
    await rm(home, { recursive: true });
    await server.shutdown();
  }
});

test("an unreachable CDP endpoint fails without hanging", async () => {
  const home = await makeFakeHome();
  try {
    // Claim a port, then release it so nothing is listening on it.
    const deadPort = await new Promise<number>((resolve, reject) => {
      const probe = createTcpServer();
      probe.on("error", reject);
      probe.listen(0, "127.0.0.1", () => {
        const { port } = probe.address() as AddressInfo;
        probe.close(() => resolve(port));
      });
    });

    const dir = `${home}/Library/Application Support/Google/Chrome`;
    await mkdir(dir, { recursive: true });
    await writeFile(
      `${dir}/DevToolsActivePort`,
      `${deadPort}\n/devtools/browser/dead\n`,
    );

    const started = Date.now();
    const r = await runScript(home, ["https://app.example/dash"]);
    assertEquals(r.code, 1);
    assert(r.stderr.includes("failed to connect to"), r.stderr);
    assert(Date.now() - started < 20_000, "connect retries must be bounded");
  } finally {
    await rm(home, { recursive: true });
  }
}, 30_000);

test("createTarget opens about:blank in the background and is always closed", async () => {
  const server = await startMockCdp(frozenFixture());
  const home = await makeFakeHome(server);
  try {
    await runScript(home, ["https://app.example/dash"]);
    assertEquals(server.createdTargets.length, 1);
    assertEquals(server.createdTargets[0].params.background, true);
    assertEquals(server.createdTargets[0].params.newWindow, false);
    assertEquals(server.createdTargets[0].params.url, "about:blank");
    assertEquals(server.navigated[0].url, "https://app.example/dash");
    assertEquals(server.closedTargets, [server.createdTargets[0].targetId]);
  } finally {
    await rm(home, { recursive: true });
    await server.shutdown();
  }
});

test("a frozen freshly-created tab aborts that origin only, and still closes", async () => {
  const cfg = frozenFixture();
  cfg.frozenTargetIds = new Set([...cfg.frozenTargetIds!, "mock-1"]);
  const server = await startMockCdp(cfg);
  const home = await makeFakeHome(server);
  try {
    const r = await runScript(home, [
      "https://app.example/dash",
      "--all-cookies",
    ]);
    assert(
      r.stderr.includes("selected origins not saved: https://app.example"),
      r.stderr,
    );
    assertEquals(r.code, 0, r.stderr);
    assertEquals(server.closedTargets, ["mock-1"]);
    const state = await readState(home);
    assertEquals((state.cookies as unknown[]).length, 2);
    assertEquals((state.origins as unknown[]).length, 0);
  } finally {
    await rm(home, { recursive: true });
    await server.shutdown();
  }
});

test("missing loadEventFired still evaluates after the fallback timeout", async () => {
  const cfg = frozenFixture();
  cfg.neverFireLoad = new Set(["mock-1"]);
  const server = await startMockCdp(cfg);
  const home = await makeFakeHome(server);
  try {
    const r = await runScript(home, ["https://app.example/dash"]);
    assertEquals(r.code, 0, r.stderr);
    assert(
      server.calls.some((c) => c.method === "Runtime.evaluate"),
      "expected Runtime.evaluate despite the missing load event",
    );
    const state = await readState(home);
    assertEquals(
      (state.origins as { origin: string }[])[0].origin,
      "https://app.example",
    );
  } finally {
    await rm(home, { recursive: true });
    await server.shutdown();
  }
});

test("socket closing mid-run fails cleanly instead of hanging", async () => {
  const cfg = frozenFixture();
  cfg.closeAfterMethod = "Target.createTarget";
  const server = await startMockCdp(cfg);
  const home = await makeFakeHome(server);
  try {
    const r = await runScript(home, ["https://app.example/dash"]);
    assertEquals(r.code, 1, r.stdout + r.stderr);
    assert(!r.stderr.includes("Unhandled"), r.stderr);
  } finally {
    await rm(home, { recursive: true });
    await server.shutdown();
  }
});

test("Runtime.evaluate throwing drops that origin but keeps the run alive", async () => {
  const cfg = frozenFixture();
  cfg.evaluateThrowsForUrl = new Set(["https://app.example/dash"]);
  const server = await startMockCdp(cfg);
  const home = await makeFakeHome(server);
  try {
    const r = await runScript(home, [
      "https://app.example/dash",
      "--all-cookies",
    ]);
    assertEquals(r.code, 0, r.stderr);
    assert(r.stderr.includes("selected origins not saved"), r.stderr);
    assertEquals(server.closedTargets, ["mock-1"]);
  } finally {
    await rm(home, { recursive: true });
    await server.shutdown();
  }
});

test("an SSO redirect is recorded under the actual origin and reported", async () => {
  const cfg = frozenFixture();
  cfg.storageByUrl = {
    "https://app.example/dash": {
      origin: "https://idp.example",
      href: "https://idp.example/login",
      localStorage: [{ name: "idp", value: "1" }],
      sessionStorage: [],
    },
  };
  const server = await startMockCdp(cfg);
  const home = await makeFakeHome(server);
  try {
    const r = await runScript(home, ["https://app.example/dash"]);
    assertEquals(r.code, 0, r.stderr);
    assert(
      r.stderr.includes("selected origins not saved: https://app.example"),
      r.stderr,
    );
    const state = await readState(home);
    assertEquals(
      (state.origins as { origin: string }[]).map((o) => o.origin),
      ["https://idp.example"],
    );
  } finally {
    await rm(home, { recursive: true });
    await server.shutdown();
  }
});

test("cookies are narrowed to tracked origins unless --all-cookies", async () => {
  const server = await startMockCdp(frozenFixture());
  const home = await makeFakeHome(server);
  try {
    const r = await runScript(home, ["https://app.example/dash"]);
    assertEquals(r.code, 0, r.stderr);
    const state = await readState(home);
    assertEquals(
      (state.cookies as Cookie[]).map((c) => c.name),
      ["sid"],
    );
    assert(r.stderr.includes("dropped 1 cookie"), r.stderr);
    // The CDP superset must not have leaked through.
    assertEquals(Object.keys((state.cookies as Cookie[])[0]), [...COOKIE_KEYS]);
  } finally {
    await rm(home, { recursive: true });
    await server.shutdown();
  }
});

test("--all-cookies keeps every cookie", async () => {
  const server = await startMockCdp(frozenFixture());
  const home = await makeFakeHome(server);
  try {
    await runScript(home, ["https://app.example/dash", "--all-cookies"]);
    const state = await readState(home);
    assertEquals((state.cookies as Cookie[]).length, 2);
  } finally {
    await rm(home, { recursive: true });
    await server.shutdown();
  }
});

test("state file and directory are written with tight modes and no residue", async () => {
  const server = await startMockCdp(frozenFixture());
  const home = await makeFakeHome(server);
  try {
    await runScript(home, ["https://app.example/dash"]);
    const dir = `${home}/.agent-browser-state`;
    assertEquals((await stat(dir)).mode! & 0o777, 0o700);
    assertEquals((await stat(`${dir}/main.json`)).mode! & 0o777, 0o600);
    assertEquals(await readdir(dir), ["main.json"]);
  } finally {
    await rm(home, { recursive: true });
    await server.shutdown();
  }
});

test("a run that captures nothing leaves main.json byte-identical", async () => {
  const cfg = frozenFixture();
  cfg.cookies = [];
  cfg.navigateErrorByUrl = { "https://app.example/dash": "net::ERR_FAILED" };
  const server = await startMockCdp(cfg);
  const home = await makeFakeHome(server);
  try {
    const dir = `${home}/.agent-browser-state`;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    const seed = JSON.stringify({ cookies: [], origins: [] }, null, 2) + "\n";
    await writeFile(`${dir}/main.json`, seed, { mode: 0o600 });

    const r = await runScript(home, ["https://app.example/dash"]);
    assertEquals(r.code, 1, r.stdout + r.stderr);
    assert(r.stderr.includes("no new state captured"), r.stderr);
    assertEquals(await readFile(`${dir}/main.json`, "utf8"), seed);
  } finally {
    await rm(home, { recursive: true });
    await server.shutdown();
  }
});

test("an unparseable seed is reported and rebuilt", async () => {
  const server = await startMockCdp(frozenFixture());
  const home = await makeFakeHome(server);
  try {
    const dir = `${home}/.agent-browser-state`;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(`${dir}/main.json`, "{{garbage", { mode: 0o600 });

    const r = await runScript(home, ["https://app.example/dash"]);
    assertEquals(r.code, 0, r.stderr);
    assert(r.stderr.includes("not valid JSON"), r.stderr);
    const state = await readState(home);
    assertEquals((state.origins as unknown[]).length, 1);
  } finally {
    await rm(home, { recursive: true });
    await server.shutdown();
  }
});

test("seed origins keep their cookies across a narrowed run", async () => {
  const server = await startMockCdp(frozenFixture());
  const home = await makeFakeHome(server);
  try {
    const dir = `${home}/.agent-browser-state`;
    await mkdir(dir, { recursive: true, mode: 0o700 });
    await writeFile(
      `${dir}/main.json`,
      JSON.stringify({
        cookies: [cookie({ name: "old", domain: ".tracker.example" })],
        origins: [{
          origin: "https://tracker.example",
          localStorage: [{ name: "k", value: "v" }],
          sessionStorage: [],
        }],
      }),
      { mode: 0o600 },
    );

    const r = await runScript(home, ["https://app.example/dash"]);
    assertEquals(r.code, 0, r.stderr);
    const state = await readState(home);
    // tracker.example stays tracked via the seed origin, so its cookie survives.
    assertEquals(
      (state.cookies as Cookie[]).map((c) => c.name).sort(),
      ["ad", "old", "sid"],
    );
    assertEquals(
      (state.origins as { origin: string }[]).map((o) => o.origin).sort(),
      ["https://app.example", "https://tracker.example"],
    );
  } finally {
    await rm(home, { recursive: true });
    await server.shutdown();
  }
});
