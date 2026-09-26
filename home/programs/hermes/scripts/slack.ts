// Minimal Slack Web API client for the feed digest.

import { readSecret } from "./feed-store.ts";

const MAX_RETRIES = 5;
// Retry-After can run to minutes; waiting that long would push a digest past
// the MCP tool-call timeout.
const MAX_WAIT_MS = 30_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function call(
  method: string,
  body: Record<string, unknown>,
  wait: (ms: number) => Promise<unknown> = sleep,
): Promise<Record<string, unknown>> {
  const token = await readSecret("SLACK_BOT_TOKEN");
  for (let attempt = 0;; attempt++) {
    const res = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json; charset=utf-8",
      },
      body: JSON.stringify(body),
    });
    // A 429 may carry no JSON body, so its status is read before parsing.
    let json: Record<string, unknown> | undefined;
    if (res.status === 429) await res.body?.cancel();
    else json = await res.json();
    if (json?.ok) return json;
    const limited = res.status === 429 || json?.error === "ratelimited";
    if (!limited || attempt >= MAX_RETRIES) {
      throw new Error(`${method}: ${json?.error ?? `HTTP ${res.status}`}`);
    }
    const seconds = Number(res.headers.get("retry-after")) || 1;
    await wait(Math.min(seconds * 1000, MAX_WAIT_MS));
  }
}

export async function postMessage(
  channel: string,
  text: string,
  threadTs?: string,
): Promise<string> {
  const json = await call("chat.postMessage", {
    channel,
    text,
    thread_ts: threadTs,
    unfurl_links: true,
    unfurl_media: false,
  });
  return json.ts as string;
}

export async function updateMessage(
  channel: string,
  ts: string,
  text: string,
): Promise<void> {
  await call("chat.update", { channel, ts, text });
}
