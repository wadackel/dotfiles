// Script for the weekly feed-suggest cron job (runs with --no-agent).
//
// Usage: suggest-feeds.ts --channel <slack channel id>
//
// Counts the sites the owner clipped in the last 90 days, keeps those clipped
// at least MIN_CLIPS times that are neither subscribed nor suggested before,
// finds their feeds, and posts up to MAX_SUGGESTIONS of them as a Slack thread
// that ➕ / 🔇 reactions act on. Prints nothing, so Hermes delivers nothing.

import {
  type Clip,
  siteKey,
  type Suggestion,
  suggestionMessage,
} from "./feeds.ts";
import {
  discoverFeed,
  loadClips,
  loadFeeds,
  type MessageRef,
  readJson,
  type Suggested,
  writeJson,
} from "./feed-store.ts";
import { postMessage } from "./slack.ts";
import { tokyoDate } from "./daily-note.ts";
import { startTrace } from "./trace.ts";

const WINDOW_DAYS = 90;
const MIN_CLIPS = 3;
const MAX_SUGGESTIONS = 5;
// Sites whose clips are one-off posts or media rather than a feed worth
// following, or whose feed is a firehose of press releases.
const IGNORED_SITES = new Set([
  "x.com",
  "twitter.com",
  "youtube.com",
  "github.com",
  "speakerdeck.com",
  "docs.google.com",
  "gist.github.com",
  "prtimes.jp",
]);

export function rankSites(
  clips: Clip[],
  { since, exclude, minClips = MIN_CLIPS }: {
    since: string;
    exclude: Set<string>;
    minClips?: number;
  },
): { site: string; origin: string; clips: string[] }[] {
  const bySite = new Map<string, { origin: string; clips: string[] }>();
  for (const c of clips) {
    if (!c.url || c.date < since) continue;
    let site: string;
    try {
      site = siteKey(c.url);
    } catch {
      continue;
    }
    if (exclude.has(site) || IGNORED_SITES.has(site)) continue;
    const u = new URL(c.url);
    const origin = site.includes("/")
      ? `${u.origin}/${site.split("/")[1]}`
      : u.origin;
    const cur = bySite.get(site) ?? { origin, clips: [] };
    cur.clips.push(c.title);
    bySite.set(site, cur);
  }
  return [...bySite.entries()]
    .filter(([, v]) => v.clips.length >= minClips)
    .sort((a, b) => b[1].clips.length - a[1].clips.length)
    .map(([site, v]) => ({ site, ...v }));
}

if (import.meta.main) {
  startTrace();
  const i = Deno.args.indexOf("--channel");
  const channel = i === -1 ? undefined : Deno.args[i + 1];
  if (!channel) throw new Error("usage: suggest-feeds.ts --channel <id>");

  const today = tokyoDate(new Date());
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000).toISOString()
    .slice(0, 10);
  const feeds = await loadFeeds();
  const suggested = await readJson<Suggested>("suggested.json", { sites: [] });
  const exclude = new Set([...feeds.map((f) => f.site), ...suggested.sites]);

  const found: Suggestion[] = [];
  const tried: string[] = [];
  for (const s of rankSites(await loadClips(), { since, exclude })) {
    if (found.length >= MAX_SUGGESTIONS) break;
    tried.push(s.site);
    const feed = await discoverFeed(s.origin);
    if (feed) {
      found.push({
        site: s.site,
        feedUrl: feed.url,
        feedTitle: feed.title,
        clips: s.clips,
      });
    }
  }
  // Sites without a feed are remembered too, so they are not probed every week.
  await writeJson("suggested.json", {
    sites: [...new Set([...suggested.sites, ...tried])],
  });
  if (found.length === 0) Deno.exit(0);

  const [, m, d] = today.split("-").map(Number);
  const parent = await postMessage(
    channel,
    `🔎 ${m}/${d} の購読候補（${found.length} 件）`,
  );
  const messages = await readJson<Record<string, MessageRef>>(
    "messages.json",
    {},
  );
  for (const s of found) {
    const text = suggestionMessage(s);
    const ts = await postMessage(channel, text, parent);
    messages[ts] = {
      kind: "suggestion",
      channel,
      text,
      site: s.site,
      feedUrl: s.feedUrl,
      feedTitle: s.feedTitle,
    };
  }
  await writeJson("messages.json", messages);
}
