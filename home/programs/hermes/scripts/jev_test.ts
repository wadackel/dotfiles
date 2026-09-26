import { assertEquals, assertMatch } from "jsr:@std/assert@1";
import {
  byScore,
  jevKey,
  profileText,
  QUESTIONS,
  scoreEntries,
} from "./jev.ts";
import type { Entry } from "./feeds.ts";

async function withHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await Deno.makeTempDir();
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
    return await fn(home);
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(home, { recursive: true });
  }
}

const entry = (n: number): Entry => ({
  id: `e${n}`,
  url: `https://a.test/${n}`,
  title: `title ${n}`,
  published: n,
  summary: `summary ${n}`,
  feedUrl: "https://a.test/feed",
  feedTitle: "A",
});

const answers = (interest: number, practical: number, promo: number) =>
  Response.json({
    answers: {
      interest: { noul: interest },
      practical: { noul: practical },
      promo: { noul: promo },
    },
  });

function stubFetch(respond: (body: unknown) => Response) {
  const original = globalThis.fetch;
  const requests: { url: string; headers: Headers; body: unknown }[] = [];
  globalThis.fetch = (input, init) => {
    const body = JSON.parse(String(init?.body));
    requests.push({
      url: String(input),
      headers: new Headers(init?.headers),
      body,
    });
    return Promise.resolve(respond(body));
  };
  return { requests, restore: () => (globalThis.fetch = original) };
}

Deno.test("jevKey reports why the key is unavailable instead of throwing", () =>
  withHome(async (home) => {
    const missingFile = await jevKey();
    assertEquals("reason" in missingFile, true);

    await Deno.mkdir(`${home}/.config/hermes`, { recursive: true });
    await Deno.writeTextFile(
      `${home}/.config/hermes/secrets.env`,
      "SLACK_BOT_TOKEN=x\n",
    );
    const missingName = await jevKey();
    assertMatch(
      "reason" in missingName ? missingName.reason : "",
      /JEV_API_KEY/,
    );

    await Deno.writeTextFile(
      `${home}/.config/hermes/secrets.env`,
      "JEV_API_KEY=jev-1\n",
    );
    assertEquals(await jevKey(), { key: "jev-1" });
  }));

Deno.test("profileText matches the backtested sentence over the last year", () => {
  const clip = (date: string, genres: string[]) => ({
    date,
    genres,
    title: "t",
  });
  const text = profileText([
    clip("2026-09-01", ["AI", "LLM"]),
    clip("2026-08-01", ["AI"]),
    clip("2026-01-01", ["Team"]),
    clip("2025-01-01", ["Old"]),
  ], "2026-09-26");
  assertEquals(
    text,
    "A Japanese software professional who saves web articles for later reference. Share of saved articles by topic over the last year: AI 50%, LLM 25%, Team 25%.",
  );
});

Deno.test("scoreEntries sends the backtested request shape", async () => {
  const f = stubFetch(() => answers(0.9, 0.5, 0.1));
  try {
    const { scores, errors } = await scoreEntries([entry(1)], {
      key: "k",
      profile: "P",
    });
    assertEquals(errors, []);
    assertEquals(scores, [{ interest: 0.9, practical: 0.5, promo: 0.1 }]);
    const [req] = f.requests;
    assertEquals(req.url, "https://api.typesafe.ai/v1/systemone");
    assertEquals(req.headers.get("authorization"), "Bearer k");
    assertEquals(req.body, {
      state: {
        profile: "P",
        article: { title: "title 1", summary: "summary 1" },
      },
      model: "jev-latest",
      questions: QUESTIONS,
    });
  } finally {
    f.restore();
  }
});

Deno.test("scoreEntries retries 429 and leaves a failed article unscored", async () => {
  let calls = 0;
  const f = stubFetch((body) => {
    const title = (body as { state: { article: { title: string } } }).state
      .article.title;
    if (title === "title 1") {
      return ++calls === 1
        ? new Response("slow down", { status: 429 })
        : answers(0.8, 0.5, 0.2);
    }
    return new Response("bad", { status: 400 });
  });
  const waits: number[] = [];
  try {
    const { scores, errors } = await scoreEntries([entry(1), entry(2)], {
      key: "k",
      profile: "P",
      wait: (ms) => Promise.resolve(waits.push(ms)),
    });
    assertEquals(scores[0], { interest: 0.8, practical: 0.5, promo: 0.2 });
    assertEquals(scores[1], undefined);
    assertEquals(waits, [1000]);
    assertEquals(errors.length, 1);
    assertMatch(errors[0], /HTTP 400/);
  } finally {
    f.restore();
  }
});

Deno.test("scoreEntries rejects an answer outside 0..1", async () => {
  const f = stubFetch(() => answers(1.5, 0.5, 0.1));
  try {
    const { scores, errors } = await scoreEntries([entry(1)], {
      key: "k",
      profile: "P",
    });
    assertEquals(scores, [undefined]);
    assertMatch(errors[0], /interest/);
  } finally {
    f.restore();
  }
});

Deno.test("byScore orders by interest - promo, then unscored by date", () => {
  const s = (interest: number, promo: number) => ({
    interest,
    practical: 0,
    promo,
  });
  const items = [
    { id: "old-unscored", published: 1 },
    { id: "mid", published: 2, score: s(0.6, 0.3) },
    { id: "new-unscored", published: 3 },
    { id: "top", published: 0, score: s(0.9, 0.1) },
  ];
  assertEquals(
    [...items].sort(byScore).map((i) => i.id),
    ["top", "mid", "new-unscored", "old-unscored"],
  );
});
