// State and I/O shared by the feed digest scripts, the feeds MCP server and
// the reaction handler.
//
// State lives in ~/.config/hermes-feeds rather than HERMES_HOME: Hermes mounts
// parts of its home into the Docker terminal, and nothing in a container
// should be able to rewrite the subscriptions or the reaction map.

import {
  mkdir,
  open,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { parseHTML } from "linkedom";
import {
  type Clip,
  type Entry,
  type Feed,
  type Feedback,
  parseClipHead,
  parseFeed,
} from "./feeds.ts";

export function home(): string {
  const h = process.env.HOME;
  if (!h) throw new Error("HOME is not set");
  return h;
}

// Read from the same file Hermes loads, because Hermes scrubs its own secrets
// from the environment of cron scripts and MCP servers, and a secret in the
// Nix store would be world-readable.
export async function readSecret(name: string): Promise<string> {
  const text = await readFile(`${home()}/.config/hermes/secrets.env`, "utf8");
  const line = text.split("\n").find((l) => l.startsWith(`${name}=`));
  const value = line?.slice(name.length + 1).trim().replace(/^["']|["']$/g, "");
  if (!value) throw new Error(`${name} is missing from secrets.env`);
  return value;
}

export const stateDir = () => `${home()}/.config/hermes-feeds`;
export const literatureDir = () => `${home()}/Documents/Main/04_Literature`;

export type Seen = { lastRun?: number; ids: string[] };
export type Pool = {
  date: string;
  items: (Entry & { key: string })[];
  postedAt?: string;
};
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
    return JSON.parse(await readFile(`${stateDir()}/${name}`, "utf8"));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw e;
  }
}

export async function writeJson(name: string, value: unknown): Promise<void> {
  await mkdir(stateDir(), { recursive: true, mode: 0o700 });
  const path = `${stateDir()}/${name}`;
  const tmp = `${path}.${crypto.randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2) + "\n", {
    mode: 0o600,
  });
  await rename(tmp, path);
}

export async function readFeedback(): Promise<Feedback[]> {
  try {
    const text = await readFile(`${stateDir()}/feedback.jsonl`, "utf8");
    return text.split("\n").filter(Boolean).map((l) => JSON.parse(l));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
}

// The mode given to open() only applies to a file it creates; the chmod
// brings a log that already exists with wider permissions back to 0600.
async function appendPrivate(path: string, text: string): Promise<void> {
  const file = await open(path, "a", 0o600);
  try {
    await file.chmod(0o600);
    await file.writeFile(text);
  } finally {
    await file.close();
  }
}

export async function appendFeedback(f: Feedback): Promise<void> {
  await mkdir(stateDir(), { recursive: true, mode: 0o700 });
  await appendPrivate(
    `${stateDir()}/feedback.jsonl`,
    JSON.stringify(f) + "\n",
  );
}

// One line per candidate the digest saw and per article it posted, so the Jev
// scores can later be compared with what was picked and reacted to.
export type DigestRow =
  & { at: string; date: string; url: string }
  & (
    | {
      kind: "candidate";
      key: string;
      title: string;
      feedTitle: string;
      interest?: number;
      practical?: number;
      promo?: number;
    }
    | { kind: "pick"; explore: boolean; bundle: boolean }
  );

export async function appendDigestLog(rows: DigestRow[]): Promise<void> {
  if (rows.length === 0) return;
  await mkdir(stateDir(), { recursive: true, mode: 0o700 });
  await appendPrivate(
    `${stateDir()}/digest-log.jsonl`,
    rows.map((r) => JSON.stringify(r) + "\n").join(""),
  );
}

const UA = "Mozilla/5.0 (Macintosh) hermes-feeds/1.0";

export async function fetchText(
  url: string,
  timeoutMs = 15_000,
): Promise<string> {
  // A feed URL can come from a clipped page's <link rel="alternate">, and
  // fetch would read a file: URL from disk.
  const { protocol } = new URL(url);
  if (protocol !== "http:" && protocol !== "https:") {
    throw new Error(`unsupported protocol ${protocol}`);
  }
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
    // linkedom's typings assume the DOM lib, which tsconfig.json leaves out.
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
  for (const e of await readdir(dir, { withFileTypes: true })) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    const f = await open(`${dir}/${e.name}`);
    try {
      const { bytesRead } = await f.read(buf, 0, HEAD_BYTES, null);
      const clip = parseClipHead(
        e.name,
        new TextDecoder().decode(buf.subarray(0, bytesRead)),
      );
      if (clip) clips.push(clip);
    } finally {
      await f.close();
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
  await mkdir(stateDir(), { recursive: true, mode: 0o700 });
  const lock = `${stateDir()}/.lock`;
  for (let i = 0;; i++) {
    try {
      await (await open(lock, "wx")).close();
      break;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
      const age = Date.now() -
        ((await stat(lock).catch(() => null))?.mtime?.getTime() ?? 0);
      // A crashed holder never removes its lock; one this old is abandoned.
      if (age > 60_000) await rm(lock).catch(() => {});
      if (i > 300) throw new Error("state lock timed out");
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  try {
    return await fn();
  } finally {
    await rm(lock).catch(() => {});
  }
}
