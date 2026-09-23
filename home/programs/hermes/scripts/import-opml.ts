// One-off import of a Feedly OPML export into ~/.config/hermes-feeds/feeds.json.
//
// Usage: import-opml.ts <export.opml>
//
// Every feed is fetched once. A feed that no longer answers is looked up again
// from its site URL (most failures are moved blogs); one that still fails, or
// that has not published for a year, is left out. The report lists all three.

import { parseOpml, siteKey } from "./feeds.ts";
import { discoverFeed, fetchFeed, loadFeeds, writeJson } from "./feed-store.ts";
import type { Feed } from "./feeds.ts";

const STALE_MS = 365 * 86_400_000;

const file = Deno.args[0];
if (!file) {
  console.error("usage: import-opml.ts <export.opml>");
  Deno.exit(2);
}
const opml = parseOpml(await Deno.readTextFile(file));
const existing = await loadFeeds();
const known = new Set(existing.map((f) => f.url));
const now = new Date().toISOString();

type Result = {
  status: "ok" | "moved" | "stale" | "dropped";
  title: string;
  url: string;
  note?: string;
};

const results = await Promise.all(
  opml.map(async (o): Promise<Result & { feed?: Feed }> => {
    const tryFeed = async (url: string) => {
      const f = await fetchFeed(url);
      const newest = Math.max(...f.entries.map((e) => e.published ?? 0));
      return { f, stale: newest > 0 && Date.now() - newest > STALE_MS };
    };
    const make = (url: string, title: string): Feed => ({
      url,
      title,
      site: siteKey(url),
      addedAt: now,
    });
    try {
      const { f, stale } = await tryFeed(o.url);
      if (stale) return { status: "stale", title: o.title, url: o.url };
      return {
        status: "ok",
        title: o.title,
        url: o.url,
        feed: make(o.url, f.title || o.title),
      };
    } catch (e) {
      const found = o.htmlUrl ? await discoverFeed(o.htmlUrl) : undefined;
      if (found) {
        const { stale } = await tryFeed(found.url);
        if (!stale) {
          return {
            status: "moved",
            title: o.title,
            url: found.url,
            note: `was ${o.url}`,
            feed: make(found.url, found.title || o.title),
          };
        }
      }
      return { status: "dropped", title: o.title, url: o.url, note: String(e) };
    }
  }),
);

const seen = new Set<string>();
const added = results
  .flatMap((r) => (r.feed ? [r.feed] : []))
  .filter((f) => !known.has(f.url) && !seen.has(f.url) && seen.add(f.url));
await writeJson("feeds.json", [...existing, ...added]);

for (const status of ["moved", "stale", "dropped"] as const) {
  const rows = results.filter((r) => r.status === status);
  if (rows.length === 0) continue;
  console.log(`\n${status} (${rows.length})`);
  for (const r of rows) {
    console.log(`- ${r.title} — ${r.url}${r.note ? ` (${r.note})` : ""}`);
  }
}
console.log(
  `\nimported ${added.length} feeds (${existing.length} already present)`,
);
