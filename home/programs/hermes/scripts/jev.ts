// The Jev request mirrors the backtest that measured it against clipped
// articles (AUC 0.775 for interest - promo over 4,020 entries): one article per
// request, the same three questions, and the same profile sentence. The
// questions name `profile` and `article`, so the state keys are part of that
// shape too; changing any of it invalidates the measurement.

import type { Clip, Entry } from "./feeds.ts";
import { readSecret } from "./feed-store.ts";

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
const MODEL = "jev-latest";
const CONCURRENCY = 8;
const TIMEOUT_MS = 20_000;
const MAX_RETRIES = 5;
const PROFILE_DAYS = 365;
const PROFILE_GENRES = 20;

export const QUESTIONS = {
  interest: {
    type: "noul",
    instructions:
      "The reader described in `profile` would choose to read the article in `article` and save it for later reference.",
  },
  practical: {
    type: "noul",
    instructions:
      "The article in `article` gives substantive insight or know-how for software engineers, designers, or engineering leaders.",
  },
  promo: {
    type: "noul",
    instructions:
      "The article in `article` is mainly a press release, product sale, campaign, event or webinar announcement, or other marketing.",
  },
} as const;

export type Score = Record<keyof typeof QUESTIONS, number>;

// Every failure means "run without Jev": before darwin-rebuild grants the
// secrets file, reading it throws NotCapable rather than NotFound.
export async function jevKey(): Promise<{ key: string } | { reason: string }> {
  try {
    return { key: await readSecret("JEV_API_KEY") };
  } catch (e) {
    return { reason: e instanceof Error ? e.message : String(e) };
  }
}

// Shares are of genre tags, not of clips, as in the backtest.
export function profileText(clips: Clip[], today: string): string {
  const cutoff = new Date(`${today}T00:00:00Z`);
  cutoff.setUTCDate(cutoff.getUTCDate() - PROFILE_DAYS);
  const since = cutoff.toISOString().slice(0, 10);
  const counts = new Map<string, number>();
  let total = 0;
  for (const c of clips) {
    if (c.date < since) continue;
    for (const g of c.genres) {
      counts.set(g, (counts.get(g) ?? 0) + 1);
      total++;
    }
  }
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, PROFILE_GENRES);
  return "A Japanese software professional who saves web articles for later reference. Share of saved articles by topic over the last year: " +
    top.map(([g, n]) => `${g} ${(n / total * 100).toFixed(0)}%`).join(", ") +
    ".";
}

function parseScore(json: unknown): Score {
  const answers = (json as { answers?: Record<string, { noul?: unknown }> })
    ?.answers;
  const score = {} as Score;
  for (const k of Object.keys(QUESTIONS) as (keyof Score)[]) {
    const v = answers?.[k]?.noul;
    if (typeof v !== "number" || !(v >= 0 && v <= 1)) {
      throw new Error(`answer ${k} is missing or invalid`);
    }
    score[k] = v;
  }
  return score;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function scoreOne(
  entry: Entry,
  opts: {
    key: string;
    profile: string;
    wait: (ms: number) => Promise<unknown>;
  },
): Promise<Score> {
  for (let attempt = 0;; attempt++) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        authorization: `Bearer ${opts.key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        state: {
          profile: opts.profile,
          article: { title: entry.title, summary: entry.summary },
        },
        model: MODEL,
        questions: QUESTIONS,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.ok) return parseScore(await res.json());
    const text = (await res.text()).slice(0, 120);
    if ((res.status === 429 || res.status >= 500) && attempt < MAX_RETRIES) {
      await opts.wait(1000 * 2 ** attempt);
      continue;
    }
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
}

// An article whose request fails keeps no score rather than failing the run:
// the digest still goes out, only less well ordered.
export async function scoreEntries(
  entries: Entry[],
  opts: {
    key: string;
    profile: string;
    wait?: (ms: number) => Promise<unknown>;
  },
): Promise<{ scores: (Score | undefined)[]; errors: string[] }> {
  const scores = Array.from<Score | undefined>({ length: entries.length });
  const errors: string[] = [];
  const wait = opts.wait ?? sleep;
  let cursor = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (cursor < entries.length) {
        const i = cursor++;
        try {
          scores[i] = await scoreOne(entries[i], { ...opts, wait });
        } catch (e) {
          errors.push(e instanceof Error ? e.message : String(e));
        }
      }
    }),
  );
  return { scores, errors };
}

export function byScore(
  a: { published?: number; score?: Score },
  b: { published?: number; score?: Score },
): number {
  if (a.score && b.score) {
    return (b.score.interest - b.score.promo) -
      (a.score.interest - a.score.promo);
  }
  if (a.score) return -1;
  if (b.score) return 1;
  return (b.published ?? 0) - (a.published ?? 0);
}
