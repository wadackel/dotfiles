// State and I/O shared by the feed digest scripts, the feeds MCP server and
// the reaction handler.
//
// State lives in ~/.config/hermes-feeds rather than HERMES_HOME: Hermes mounts
// parts of its home into the Docker terminal, and nothing in a container
// should be able to rewrite the subscriptions or the reaction map.

import { parseHTML } from "npm:linkedom@0.18.13";
import {
  type Clip,
  type Entry,
  type Feed,
  type Feedback,
  parseClipHead,
  parseFeed,
} from "./feeds.ts";

export function home(): string {
  const h = Deno.env.get("HOME");
  if (!h) throw new Error("HOME is not set");
  return h;
}

export const stateDir = () => `${home()}/.config/hermes-feeds`;
export const literatureDir = () => `${home()}/Documents/Main/04_Literature`;

export type Seen = { lastRun?: number; ids: string[] };
export type Pool = { date: string; items: (Entry & { key: string })[] };
// `text` is kept so a reaction can append its result with chat.update, which
// replaces the whole message.
export type MessageRef =
  & { channel: string; text: string; done?: string[] }
  & (
    | {
      kind: "article";
      url: string;
      title: string;
      feedUrl: string;
      feedTitle: string;
    }
    | { kind: "suggestion"; site: string; feedUrl: string; feedTitle: string }
  );
export type Suggested = { sites: string[] };

export const SEEN_LIMIT = 5000;

export async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await Deno.readTextFile(`${stateDir()}/${name}`));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return fallback;
    throw e;
  }
}

export async function writeJson(name: string, value: unknown): Promise<void> {
  await Deno.mkdir(stateDir(), { recursive: true, mode: 0o700 });
  const path = `${stateDir()}/${name}`;
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(tmp, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  await Deno.rename(tmp, path);
}

export async function readFeedback(): Promise<Feedback[]> {
  try {
    const text = await Deno.readTextFile(`${stateDir()}/feedback.jsonl`);
    return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return [];
    throw e;
  }
}

export async function appendFeedback(f: Feedback): Promise<void> {
  await Deno.mkdir(stateDir(), { recursive: true, mode: 0o700 });
  await Deno.writeTextFile(
    `${stateDir()}/feedback.jsonl`,
    JSON.stringify(f) + "\n",
    {
      append: true,
      mode: 0o600,
    },
  );
}

const UA = "Mozilla/5.0 (Macintosh) hermes-feeds/1.0";

export async function fetchText(
  url: string,
  timeoutMs = 15_000,
): Promise<string> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { "user-agent": UA },
    redirect: "follow",
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

export async function fetchFeed(url: string) {
  return parseFeed(await fetchText(url), url);
}

const FEED_TYPES = ["application/rss+xml", "application/atom+xml"];
const COMMON_PATHS = [
  "/feed",
  "/rss.xml",
  "/atom.xml",
  "/feed.xml",
  "/index.xml",
  "/rss",
];

// Finds a working feed for a page: the page's own <link rel="alternate">
// first, then the usual paths. Returns undefined when nothing parses.
export async function discoverFeed(
  pageUrl: string,
): Promise<{ url: string; title: string } | undefined> {
  const candidates: string[] = [];
  try {
    // linkedom's typings assume the DOM lib, which Deno scripts do not load.
    const { document } = parseHTML(await fetchText(pageUrl)) as unknown as {
      document: {
        querySelectorAll(
          s: string,
        ): Iterable<{ getAttribute(n: string): string | null }>;
      };
    };
    for (const l of document.querySelectorAll("link[rel~=alternate]")) {
      const href = l.getAttribute("href");
      if (href && FEED_TYPES.includes(l.getAttribute("type") ?? "")) {
        candidates.push(new URL(href, pageUrl).toString());
      }
    }
  } catch {
    // The page may be unreachable while a common feed path still works.
  }
  const origin = new URL(pageUrl).origin;
  candidates.push(...COMMON_PATHS.map((p) => origin + p));
  for (const url of candidates) {
    try {
      const f = await fetchFeed(url);
      if (f.entries.length > 0) return { url, title: f.title };
    } catch {
      continue;
    }
  }
  return undefined;
}

const HEAD_BYTES = 4096;

// Reads only the head of each note: the vault has thousands of clips and the
// digest needs just their frontmatter and first body line.
export async function loadClips(dir = literatureDir()): Promise<Clip[]> {
  const clips: Clip[] = [];
  const buf = new Uint8Array(HEAD_BYTES);
  for await (const e of Deno.readDir(dir)) {
    if (!e.isFile || !e.name.endsWith(".md")) continue;
    const f = await Deno.open(`${dir}/${e.name}`);
    try {
      const n = (await f.read(buf)) ?? 0;
      const clip = parseClipHead(
        e.name,
        new TextDecoder().decode(buf.subarray(0, n)),
      );
      if (clip) clips.push(clip);
    } finally {
      f.close();
    }
  }
  return clips;
}

export async function loadFeeds(): Promise<Feed[]> {
  return await readJson<Feed[]>("feeds.json", []);
}

// Reactions can arrive in bursts, each starting its own feed-action process.
// They all rewrite messages.json and feeds.json, so updates are serialized
// with an exclusive lock file to keep one from clobbering another.
export async function withStateLock<T>(fn: () => Promise<T>): Promise<T> {
  await Deno.mkdir(stateDir(), { recursive: true, mode: 0o700 });
  const lock = `${stateDir()}/.lock`;
  for (let i = 0;; i++) {
    try {
      (await Deno.open(lock, { createNew: true, write: true })).close();
      break;
    } catch (e) {
      if (!(e instanceof Deno.errors.AlreadyExists)) throw e;
      const age = Date.now() -
        ((await Deno.stat(lock).catch(() => null))?.mtime?.getTime() ?? 0);
      // A crashed holder never removes its lock; one this old is abandoned.
      if (age > 60_000) await Deno.remove(lock).catch(() => {});
      if (i > 300) throw new Error("state lock timed out");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    await Deno.remove(lock).catch(() => {});
  }
}
