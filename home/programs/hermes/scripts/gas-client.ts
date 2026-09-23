// Client for the Apps Script bridge in ../gas/Code.gs, shared by the Hermes
// cron scripts and the Calendar MCP server.
//
// bridge.json lives outside HERMES_HOME on purpose: Hermes mounts parts of
// its home into the Docker terminal, and colima only exposes HERMES_HOME to
// the VM, so nothing inside a container can read the secret.

type Bridge = { url: string; secret: string };

export function configDir(): string {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME is not set");
  return `${home}/.config/hermes-google`;
}

type Action = "listNewMail" | "createEvent" | "listHolidays";

// Apps Script now and then answers with a Google error page (HTTP 404, or an
// HTML page with status 200) and succeeds a moment later. Only read actions
// are retried: a createEvent that failed after the event was saved would be
// created twice.
const RETRY_DELAYS_MS = [2_000, 5_000];
// fetch waits forever on a connection that stops answering, which once held
// the daily-note pre-run script until Hermes killed it an hour later. A call
// normally takes about a second.
const TIMEOUT_MS = 30_000;
const READ_ONLY: ReadonlySet<Action> = new Set(["listNewMail", "listHolidays"]);

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
  if (!res.ok) throw new Error(`${action}: HTTP ${res.status}`);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new Error(`${action}: non-JSON response (${text.slice(0, 40)}…)`);
  }
  if (body.error) throw new Error(`${action}: ${body.error}`);
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
    try {
      return await callOnce(bridge, action, params, timeoutMs);
    } catch (e) {
      if (attempt >= delays.length) throw e;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}
