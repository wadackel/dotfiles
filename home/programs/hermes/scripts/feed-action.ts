// Runs the action behind a reaction on a feed-digest message. Started, and
// immediately detached from, by the feed-reactions gateway hook.
//
// Usage: feed-action.ts <reaction> <channel> <message ts>
//
// Each action appends its result to the message with chat.update, because the
// Slack app has no reactions:write scope to answer with a reaction instead.

import { siteKey } from "./feeds.ts";
import {
  appendFeedback,
  loadFeeds,
  type MessageRef,
  readJson,
  type Suggested,
  withStateLock,
  writeJson,
} from "./feed-store.ts";
import { updateMessage } from "./slack.ts";

const WEB_CLIP = Deno.env.get("HERMES_WEB_CLIP");
const DENO = Deno.env.get("HERMES_DENO") ?? "deno";

const [reaction, channel, ts] = Deno.args;
const messages = await readJson<Record<string, MessageRef>>(
  "messages.json",
  {},
);
const ref = messages[ts];
if (!ref || ref.channel !== channel) Deno.exit(0);
if (ref.done?.includes(reaction)) Deno.exit(0);

async function finish(note: string) {
  await withStateLock(async () => {
    const fresh = await readJson<Record<string, MessageRef>>(
      "messages.json",
      {},
    );
    const cur = fresh[ts] ?? ref;
    cur.done = [...(cur.done ?? []), reaction];
    cur.text = `${cur.text}\n${note}`;
    fresh[ts] = cur;
    await writeJson("messages.json", fresh);
    await updateMessage(channel, ts, cur.text);
  });
}

async function setMuted(feedUrl: string) {
  await withStateLock(async () => {
    const feeds = await loadFeeds();
    const f = feeds.find((x) => x.url === feedUrl);
    if (f) f.muted = true;
    await writeJson("feeds.json", feeds);
  });
}

if (ref.kind === "article") {
  if (reaction === "paperclip") {
    if (!WEB_CLIP) throw new Error("HERMES_WEB_CLIP is not set");
    // The Web Clip plugin runs inside Obsidian and is driven by the
    // `obsidian` CLI, which Homebrew installs outside the launchd PATH.
    const out = await new Deno.Command(DENO, {
      args: ["run", "--allow-run=obsidian", WEB_CLIP, ref.url],
      env: { PATH: `/opt/homebrew/bin:${Deno.env.get("PATH") ?? ""}` },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const rows = new TextDecoder().decode(out.stdout).split("\n").filter((l) =>
      !l.startsWith("started")
    );
    const status = rows.find((l) => l.trim())?.split("\t")[0];
    await finish(
      status === "created"
        ? "📎 クリップしました"
        : status === "skipped"
        ? "📎 クリップ済みでした"
        : "📎 クリップに失敗しました",
    );
  } else if (reaction === "+1" || reaction === "-1") {
    await appendFeedback({
      at: new Date().toISOString(),
      reaction,
      title: ref.title,
      feedTitle: ref.feedTitle,
    });
    await finish(
      reaction === "+1"
        ? "👍 好みとして記録しました"
        : "👎 好みではないと記録しました",
    );
  } else if (reaction === "mute") {
    await setMuted(ref.feedUrl);
    await finish(`🔇 ${ref.feedTitle} を今後出しません`);
  }
} else if (ref.kind === "suggestion") {
  if (reaction === "heavy_plus_sign") {
    await withStateLock(async () => {
      const feeds = await loadFeeds();
      if (!feeds.some((f) => f.url === ref.feedUrl)) {
        feeds.push({
          url: ref.feedUrl,
          title: ref.feedTitle,
          site: siteKey(ref.feedUrl),
          addedAt: new Date().toISOString(),
        });
        await writeJson("feeds.json", feeds);
      }
    });
    await finish("➕ 購読に追加しました");
  } else if (reaction === "mute") {
    await withStateLock(async () => {
      const suggested = await readJson<Suggested>("suggested.json", {
        sites: [],
      });
      await writeJson("suggested.json", {
        sites: [...new Set([...suggested.sites, ref.site])],
      });
    });
    await finish("🔇 今後この候補は出しません");
  }
}
