// Pure helpers for the Hermes feed digest: parsing feeds and OPML, narrowing
// the day's candidates, and rendering the Slack messages.

import { XMLParser } from "npm:fast-xml-parser@5.11.1";

export type Feed = {
  url: string;
  title: string;
  site: string;
  muted?: boolean;
  addedAt: string;
};

export type Entry = {
  id: string;
  url: string;
  title: string;
  published?: number;
  summary: string;
  feedUrl: string;
  feedTitle: string;
};

export type ParsedFeed = { title: string; siteUrl?: string; entries: Entry[] };

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  textNodeName: "#text",
  isArray: (name) => ["item", "entry", "link", "outline"].includes(name),
});

type Node = Record<string, unknown>;

function text(v: unknown): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "string" || typeof v === "number") return String(v).trim();
  if (Array.isArray(v)) return text(v[0]);
  if (typeof v === "object") return text((v as Node)["#text"]);
  return "";
}

export function stripHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(
      /&#x([0-9a-f]+);/gi,
      (_, h) => String.fromCodePoint(parseInt(h, 16)),
    )
    .replace(/\s+/g, " ")
    .trim();
}

function atomLink(links: unknown): string {
  const list = (Array.isArray(links) ? links : [links]) as Node[];
  const pick = list.find((l) => !l?.["@_rel"] || l["@_rel"] === "alternate") ??
    list[0];
  if (!pick) return "";
  return typeof pick === "string" ? pick : text(pick["@_href"]) || text(pick);
}

function parseDate(v: string): number | undefined {
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : t;
}

const SUMMARY_LIMIT = 200;

export function parseFeed(xml: string, feedUrl: string): ParsedFeed {
  const doc = parser.parse(xml) as Node;
  const clip = (
    s: string,
  ) => (s.length > SUMMARY_LIMIT ? `${s.slice(0, SUMMARY_LIMIT)}…` : s);

  const atom = doc.feed as Node | undefined;
  if (atom) {
    const feedTitle = stripHtml(text(atom.title));
    const entries = ((atom.entry as Node[]) ?? []).map((e): Entry => {
      const url = atomLink(e.link);
      return {
        id: text(e.id) || url,
        url,
        title: stripHtml(text(e.title)),
        published: parseDate(text(e.published) || text(e.updated)),
        summary: clip(stripHtml(text(e.summary) || text(e.content))),
        feedUrl,
        feedTitle,
      };
    });
    return {
      title: feedTitle,
      siteUrl: atomLink(atom.link) || undefined,
      entries,
    };
  }

  const channel =
    ((doc.rss as Node)?.channel ?? (doc["rdf:RDF"] as Node)?.channel) as
      | Node
      | undefined;
  if (!channel) throw new Error(`not an RSS or Atom feed: ${feedUrl}`);
  const feedTitle = stripHtml(text(channel.title));
  const items = ((channel.item ?? (doc["rdf:RDF"] as Node)?.item) as Node[]) ??
    [];
  const entries = items.map((i): Entry => {
    const url = text(i.link);
    return {
      id: text(i.guid) || url,
      url,
      title: stripHtml(text(i.title)),
      published: parseDate(text(i.pubDate) || text(i["dc:date"])),
      summary: clip(
        stripHtml(text(i.description) || text(i["content:encoded"])),
      ),
      feedUrl,
      feedTitle,
    };
  });
  return {
    title: feedTitle,
    siteUrl: text(channel.link) || undefined,
    entries,
  };
}

export type OpmlFeed = { url: string; title: string; htmlUrl?: string };

export function parseOpml(xml: string): OpmlFeed[] {
  const doc = parser.parse(xml) as Node;
  const out: OpmlFeed[] = [];
  const walk = (outlines: Node[] | undefined) => {
    for (const o of outlines ?? []) {
      const url = text(o["@_xmlUrl"]);
      if (url) {
        out.push({
          url,
          title: text(o["@_title"]) || text(o["@_text"]),
          htmlUrl: text(o["@_htmlUrl"]) || undefined,
        });
      }
      walk(o.outline as Node[] | undefined);
    }
  };
  walk(((doc.opml as Node)?.body as Node)?.outline as Node[]);
  return out;
}

// Blog platforms host many unrelated authors under one hostname, so a site
// there is the author (the first path segment), not the whole host.
const PLATFORM_HOSTS = new Set([
  "zenn.dev",
  "qiita.com",
  "note.com",
  "medium.com",
  "dev.to",
]);

export function siteKey(url: string): string {
  const u = new URL(url);
  const host = u.hostname.replace(/^www\./, "");
  if (!PLATFORM_HOSTS.has(host)) return host;
  const first = u.pathname.split("/").filter(Boolean)[0];
  return first ? `${host}/${first}` : host;
}

export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const k of [...u.searchParams.keys()]) {
      if (k.startsWith("utm_")) u.searchParams.delete(k);
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return url;
  }
}

export type Filter = {
  since: number;
  seenIds: Set<string>;
  clippedUrls: Set<string>;
};

export function selectCandidates(entries: Entry[], f: Filter): Entry[] {
  const unique = new Map<string, Entry>();
  for (const e of entries) {
    if (!e.url || e.published === undefined || e.published <= f.since) continue;
    if (f.seenIds.has(e.id) || f.clippedUrls.has(normalizeUrl(e.url))) continue;
    unique.set(normalizeUrl(e.url), e);
  }
  return [...unique.values()].sort((a, b) => b.published! - a.published!);
}

export const BUNDLE_MIN = 3;

export function groupByFeed<T extends Entry>(entries: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const e of entries) {
    groups.set(e.feedUrl, [...(groups.get(e.feedUrl) ?? []), e]);
  }
  return groups;
}

export type Clip = {
  date: string;
  genres: string[];
  title: string;
  url?: string;
};

// Reads what the digest needs from the head of a 04_Literature note: the
// `date`, its `clip/*` genres, and the `[title](url)` on the first body line.
export function parseClipHead(
  fileName: string,
  head: string,
): Clip | undefined {
  const m = head.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) return undefined;
  const fm = m[1];
  if (!/^\s+- memo\/web\s*$/m.test(fm)) return undefined;
  const date = fm.match(/^date:\s*(\d{4}-\d{2}-\d{2})/m)?.[1];
  if (!date) return undefined;
  const genres = [...fm.matchAll(/^\s+- clip\/(\S+)\s*$/gm)].map((g) => g[1]);
  const firstLine = head.slice(m[0].length).split("\n").find((l) =>
    l.trim() !== ""
  );
  const url = firstLine?.match(/^\[[^\]]*\]\((https?:\/\/[^)\s]+)\)/)?.[1];
  return { date, genres, title: fileName.replace(/\.md$/, ""), url };
}

export type Feedback = {
  at: string;
  reaction: "+1" | "-1";
  title: string;
  feedTitle: string;
  // Absent on reactions recorded before the digest log existed.
  url?: string;
};

export function interestProfile(
  clips: Clip[],
  feedback: Feedback[],
  today: string,
) {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - 60);
  const recent = clips
    .filter((c) => c.date >= cutoff.toISOString().slice(0, 10))
    .sort((a, b) => b.date.localeCompare(a.date));
  const genreCounts = new Map<string, number>();
  for (const c of recent) {
    for (const g of c.genres) genreCounts.set(g, (genreCounts.get(g) ?? 0) + 1);
  }
  return {
    genres: [...genreCounts.entries()].sort((a, b) => b[1] - a[1]),
    titles: recent.slice(0, 30).map((c) => c.title),
    feedback: feedback.slice(-20),
  };
}

export function slackEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function shortDate(ms: number | undefined): string {
  if (ms === undefined) return "";
  const d = new Date(ms + 9 * 3600_000);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function link(e: Entry): string {
  return `<${e.url}|${slackEscape(e.title || e.url)}>`;
}

export type Pick = { entry: Entry; reason: string; explore: boolean };
export type Bundle = {
  feedTitle: string;
  items: { entry: Entry; reason: string }[];
};

export function parentMessage(
  date: string,
  picks: Pick[],
  bundles: Bundle[],
): string {
  const explore = picks.filter((p) => p.explore).length;
  const total = picks.length + bundles.length;
  const [, m, d] = date.split("-").map(Number);
  const head = `📰 ${m}/${d} のフィード（${total} 件${
    explore ? `・🧭 ${explore}` : ""
  }）`;
  const lines = [
    ...picks.map((p) =>
      `・${p.explore ? "🧭 " : ""}${slackEscape(p.entry.title)}`
    ),
    ...bundles.map((b) =>
      `・${slackEscape(b.feedTitle)}：注目 ${b.items.length} 件`
    ),
  ];
  const legend = [
    "",
    "スレッドの記事に 📎 でクリップ、👍 / 👎 で好みを記録、🔇 でそのフィードを今後出さない",
    ...(explore ? ["🧭 は関心の外から選んだ記事"] : []),
  ];
  return [head, ...lines, ...legend].join("\n");
}

export function articleMessage(p: Pick): string {
  return [
    `${p.explore ? "🧭 " : ""}${link(p.entry)}`,
    `${slackEscape(p.entry.feedTitle)} · ${shortDate(p.entry.published)}`,
    `理由：${slackEscape(p.reason)}`,
  ].join("\n");
}

export type Suggestion = {
  site: string;
  feedUrl: string;
  feedTitle: string;
  clips: string[];
};

export function suggestionMessage(s: Suggestion): string {
  return [
    `*${slackEscape(s.feedTitle || s.site)}*（${slackEscape(s.site)}）`,
    `直近 90 日に ${s.clips.length} 回クリップ：${
      s.clips.slice(0, 3).map(slackEscape).join(" / ")
    }`,
    `フィード：${s.feedUrl}`,
    "➕ で購読に追加、🔇 で今後出さない",
  ].join("\n");
}
