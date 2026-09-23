// Minimal Slack Web API client for the feed digest.
//
// The bot token is read from the same secrets file Hermes loads, because
// Hermes scrubs its own secrets from the environment of cron scripts and MCP
// servers, and a token in the Nix store would be world-readable.

import { home } from "./feed-store.ts";

async function botToken(): Promise<string> {
  const text = await Deno.readTextFile(`${home()}/.config/hermes/secrets.env`);
  const line = text.split("\n").find((l) => l.startsWith("SLACK_BOT_TOKEN="));
  const token = line?.slice("SLACK_BOT_TOKEN=".length).trim().replace(
    /^["']|["']$/g,
    "",
  );
  if (!token) throw new Error("SLACK_BOT_TOKEN is missing from secrets.env");
  return token;
}

async function call(
  method: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await botToken()}`,
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.error}`);
  return json;
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
