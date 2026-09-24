// Client for the Apps Script bridge in ../gas/Code.gs, shared by the Hermes
// cron scripts and the gcal and agenda MCP servers.
//
// bridge.json lives outside HERMES_HOME on purpose: Hermes mounts parts of
// its home into the Docker terminal, and colima only exposes HERMES_HOME to
// the VM, so nothing inside a container can read the secret.

import { trace } from "./trace.ts";

type Bridge = { url: string; secret: string };

export function configDir(): string {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME is not set");
  return `${home}/.config/hermes-google`;
}

type Action = "listNewMail" | "createEvent" | "listHolidays" | "listEvents";

// Apps Script now and then answers with a Google error page (HTTP 404, or an
// HTML page with status 200) and succeeds a moment later. Only read actions
// are retried: a createEvent that failed after the event was saved would be
// created twice.
const RETRY_DELAYS_MS = [2_000, 5_000];
// fetch waits forever on a connection that stops answering, which once held
// the daily-note pre-run script until Hermes killed it an hour later. A call
// normally takes about a second.
const TIMEOUT_MS = 30_000;
const READ_ONLY: ReadonlySet<Action> = new Set([
  "listNewMail",
  "listHolidays",
  "listEvents",
]);

// A failure that came back as a response. `reported` means the bridge itself
// answered with an error, so the script ran to its end and saved nothing;
// any other failure (a Google error page, a timeout, a dropped connection)
// may have come after the work was done. `name` stays "Error" so scripts that
// print the error keep their output.
export class BridgeError extends Error {
  constructor(
    message: string,
    readonly detail: string,
    readonly reported = false,
  ) {
    super(message);
  }
}

// The query of the final URL is left out: script.googleusercontent.com hands
// the result to anyone holding its user_content_key. The body is summarized
// only for failures, whose text is Google's error page or the bridge's error.
function describe(res: Response, text: string): string {
  const url = new URL(res.url);
  const title = text.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1];
  const summary = title ??
    text.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return `final ${url.host}${url.pathname}, ${
    res.headers.get("content-type") ?? "no content-type"
  }, ${title === undefined ? "body" : "title"} "${summary}"`;
}

async function callOnce(
  bridge: Bridge,
  action: Action,
  params: Record<string, unknown>,
  timeoutMs: number,
): Promise<unknown> {
  let res: Response;
  let text: string;
  try {
    // Apps Script answers a POST with a redirect to script.googleusercontent.com,
    // which fetch follows as a GET, as the web app expects.
    res = await fetch(bridge.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: bridge.secret, action, ...params }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    text = await res.text();
  } catch (e) {
    if (e instanceof DOMException && e.name === "TimeoutError") {
      throw new Error(`${action}: timed out after ${timeoutMs}ms`);
    }
    throw e;
  }
  if (!res.ok) {
    throw new BridgeError(`${action}: HTTP ${res.status}`, describe(res, text));
  }
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new BridgeError(
      `${action}: non-JSON response (${text.slice(0, 40)}…)`,
      describe(res, text),
    );
  }
  if (body.error) {
    throw new BridgeError(
      `${action}: ${body.error}`,
      describe(res, text),
      true,
    );
  }
  return body.result;
}

export async function callBridge(
  action: Action,
  params: Record<string, unknown>,
  { retryDelaysMs = RETRY_DELAYS_MS, timeoutMs = TIMEOUT_MS }: {
    retryDelaysMs?: number[];
    timeoutMs?: number;
  } = {},
): Promise<unknown> {
  const bridge: Bridge = JSON.parse(
    await Deno.readTextFile(`${configDir()}/bridge.json`),
  );
  const delays = READ_ONLY.has(action) ? retryDelaysMs : [];
  for (let attempt = 0;; attempt++) {
    const started = Date.now();
    try {
      const result = await callOnce(bridge, action, params, timeoutMs);
      if (attempt > 0) {
        trace(`bridge ${action} succeeded on attempt ${attempt + 1}`);
      }
      return result;
    } catch (e) {
      trace(
        `bridge ${action} attempt ${attempt + 1}/${
          delays.length + 1
        } failed after ${Date.now() - started}ms: ${
          e instanceof Error ? e.message : e
        }${e instanceof BridgeError ? ` (${e.detail})` : ""}`,
      );
      if (attempt >= delays.length) throw e;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}
