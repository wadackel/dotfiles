// One-off import of sites clipped at least twice into
// ~/.config/hermes-feeds/feeds.json. Usage: import-clip-sites.ts [--dry-run]
// Sites with no feed, a feed silent for a year, or a feed already subscribed
// under another URL are skipped; the report lists them, plus added feeds whose
// title matches a subscribed one, for a person to check.

import { normalizeUrl, siteKey } from "./feeds.ts";
import type { Feed } from "./feeds.ts";
import {
  discoverFeed,
  fetchFeed,
  loadClips,
  loadFeeds,
  readJson,
  withStateLock,
  writeJson,
} from "./feed-store.ts";
import { rankSites } from "./suggest-feeds.ts";

const MIN_CLIPS = 2;
const STALE_MS = 365 * 86_400_000;
const CONCURRENCY = 8;

async function mapLimit<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out = Array.from<R>({ length: items.length });
  let cursor = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < items.length) {
        const i = cursor++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

const dryRun = Deno.args.includes("--dry-run");
const existing = await loadFeeds();
const suggested = await readJson<{ sites: string[] }>("suggested.json", {
  sites: [],
});
const sites = rankSites(await loadClips(), {
  since: "",
  exclude: new Set([...existing.map((f) => f.site), ...suggested.sites]),
  minClips: MIN_CLIPS,
});

// feeds.json keys a feed by its feed URL's host, which for feedburner, GitHub
// raw files or medium.com/feed is not the blog's; the blog's own site only
// comes back in the fetched feed.
const subscribedSites = new Set<string>();
const unreachable: string[] = [];
await mapLimit(existing, async (f) => {
  try {
    const parsed = await fetchFeed(f.url);
    if (parsed.siteUrl) subscribedSites.add(siteKey(parsed.siteUrl));
  } catch {
    unreachable.push(`${f.title} — ${f.url}`);
  }
});
const subscribedUrls = new Set(existing.map((f) => normalizeUrl(f.url)));
const subscribedTitles = new Set(
  existing.map((f) => f.title.trim().toLowerCase()),
);

type Result =
  | { status: "added"; feed: Feed; clips: number }
  | { status: "no feed" | "stale" | "duplicate"; site: string; note: string };

const now = new Date().toISOString();
const results = await mapLimit(sites, async (s): Promise<Result> => {
  if (subscribedSites.has(s.site)) {
    return {
      status: "duplicate",
      site: s.site,
      note: "site of a subscribed feed",
    };
  }
  const found = await discoverFeed(s.origin);
  if (!found) return { status: "no feed", site: s.site, note: s.origin };
  // discoverFeed falls back to the host's common paths, which on a blog
  // platform is the whole platform's feed rather than the author's.
  const author = s.site.split("/")[1];
  if (author && !found.url.includes(author)) {
    return {
      status: "no feed",
      site: s.site,
      note: `platform feed ${found.url}`,
    };
  }
  if (subscribedUrls.has(normalizeUrl(found.url))) {
    return { status: "duplicate", site: s.site, note: found.url };
  }
  const parsed = await fetchFeed(found.url).catch(() => undefined);
  const newest = Math.max(
    0,
    ...(parsed?.entries ?? []).map((e) => e.published ?? 0),
  );
  if (newest > 0 && Date.now() - newest > STALE_MS) {
    return { status: "stale", site: s.site, note: found.url };
  }
  return {
    status: "added",
    clips: s.clips.length,
    feed: {
      url: found.url,
      title: found.title || s.site,
      site: s.site,
      addedAt: now,
    },
  };
});

const seenUrls = new Set<string>();
const added = results.flatMap((r) =>
  r.status === "added" && !seenUrls.has(normalizeUrl(r.feed.url)) &&
    seenUrls.add(normalizeUrl(r.feed.url))
    ? [r]
    : []
);

console.log(`added (${added.length})`);
for (const r of added) {
  console.log(
    `- ${r.feed.site} [${r.clips} clips] ${r.feed.title} — ${r.feed.url}`,
  );
}
for (const status of ["no feed", "stale", "duplicate"] as const) {
  const rows = results.filter((r) => r.status === status);
  console.log(`\n${status} (${rows.length})`);
  for (const r of rows) {
    if (r.status !== "added") console.log(`- ${r.site} — ${r.note}`);
  }
}
const suspected = [
  ...added
    .filter((r) => subscribedTitles.has(r.feed.title.trim().toLowerCase()))
    .map((r) =>
      `${r.feed.title} — ${r.feed.url} (same title as a subscribed feed)`
    ),
  ...unreachable.map((u) =>
    `${u} (subscribed, unreachable: its site is unknown)`
  ),
];
console.log(`\nsuspected duplicates (${suspected.length})`);
for (const s of suspected) console.log(`- ${s}`);

if (dryRun) {
  console.log(
    `\ndry run: ${added.length} feeds would be added to ${existing.length}`,
  );
} else {
  const total = await withStateLock(async () => {
    const fresh = await loadFeeds();
    const known = new Set(fresh.map((f) => normalizeUrl(f.url)));
    const next = [
      ...fresh,
      ...added.map((r) => r.feed).filter((f) =>
        !known.has(normalizeUrl(f.url))
      ),
    ];
    await writeJson("feeds.json", next);
    return next.length;
  });
  console.log(`\nimported: feeds.json now has ${total} feeds`);
}
