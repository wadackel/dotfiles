import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import { test } from "bun:test";
import { postDigest, resolveDigest } from "./feeds-mcp.ts";
import { type Pool, readJson, writeJson } from "./feed-store.ts";

const item = (key: string, feedUrl = "https://a.test/feed") => ({
  key,
  id: key,
  url: `https://a.test/${key}`,
  title: key,
  published: 1,
  summary: "",
  feedUrl,
  feedTitle: feedUrl === "https://a.test/feed" ? "A" : "GH",
});
const pool: Pool = {
  date: "2026-09-24",
  items: ["c1", "c2", "c3", "c4", "c5", "c6"].map((k) => item(k))
    .concat([
      item("g1", "https://gh.test/feed"),
      item("g2", "https://gh.test/feed"),
    ]),
};

test("resolveDigest maps ids to pool entries", () => {
  const got = resolveDigest(pool, {
    picks: [{ id: "c1", reason: "r", explore: true }],
    bundles: [{
      items: [{ id: "g1", reason: "x" }, { id: "g2", reason: "y" }],
    }],
  });
  assertEquals(got.picks[0].entry.url, "https://a.test/c1");
  assertEquals(got.picks[0].explore, true);
  assertEquals(got.bundles[0].feedTitle, "GH");
  assertEquals(got.bundles[0].items.length, 2);
});

test("resolveDigest accepts an empty digest", () => {
  assertEquals(resolveDigest(pool, { picks: [], bundles: [] }), {
    picks: [],
    bundles: [],
  });
});

test("resolveDigest rejects unknown ids, reuse, and bundle rule violations", () => {
  const pick = (id: string, explore = false) => ({ id, reason: "r", explore });
  assertThrows(
    () => resolveDigest(pool, { picks: [pick("zz")], bundles: [] }),
    Error,
    "unknown",
  );
  assertThrows(
    () => resolveDigest(pool, { picks: [pick("c1"), pick("c1")], bundles: [] }),
    Error,
    "twice",
  );
  assertThrows(
    () =>
      resolveDigest(pool, {
        picks: [],
        bundles: [{
          items: [{ id: "c1", reason: "a" }, { id: "g1", reason: "b" }],
        }],
      }),
    Error,
    "single feed",
  );
  assertThrows(
    () =>
      resolveDigest(pool, {
        picks: [],
        bundles: [{ items: [] }],
      }),
    Error,
    "at least one item",
  );
});

test("resolveDigest accepts any number of picks and explore picks", () => {
  const got = resolveDigest(pool, {
    picks: ["c1", "c2", "c3", "c4", "c5", "c6"].map((id) => ({
      id,
      reason: "r",
      explore: id === "c1" || id === "c2",
    })),
    bundles: [{
      items: [{ id: "g1", reason: "x" }, { id: "g2", reason: "y" }],
    }],
  });
  assertEquals(got.picks.length, 6);
  assertEquals(got.picks.filter((p) => p.explore).length, 2);
});

async function withPool<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "tmp-"));
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    await writeJson("pool.json", pool);
    await writeJson("seen.json", { ids: ["old"] });
    return await fn(home);
  } finally {
    if (prev) process.env.HOME = prev;
    else delete process.env.HOME;
    await rm(home, { recursive: true });
  }
}

const digestLog = async (home: string) => {
  try {
    return (await readFile(
      `${home}/.config/hermes-feeds/digest-log.jsonl`,
      "utf8",
    )).trim().split("\n").map((l) => JSON.parse(l));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw e;
  }
};

test("postDigest records what was posted when a later post fails", () =>
  withPool(async (home) => {
    let n = 0;
    const post = (_channel: string, _text: string, thread?: string) => {
      n++;
      if (n === 3) return Promise.reject(new Error("chat.postMessage: boom"));
      return Promise.resolve(thread ? `2000000000.00${n}` : "parent");
    };
    await assertRejects(
      () =>
        postDigest("D1", {
          picks: [{ id: "c1", reason: "r" }, { id: "c2", reason: "r" }],
          bundles: [{ items: [{ id: "g1", reason: "x" }] }],
        }, post),
      Error,
      "boom",
    );
    const messages = await readJson<Record<string, { url: string }>>(
      "messages.json",
      {},
    );
    assertEquals(Object.values(messages).map((m) => m.url), [
      "https://a.test/c1",
    ]);
    const seen = await readJson<{ lastRun?: number; ids: string[] }>(
      "seen.json",
      { ids: [] },
    );
    assertEquals(seen.ids.includes("c6") && seen.ids.includes("old"), true);
    assertEquals(typeof seen.lastRun, "number");
    const log = await digestLog(home);
    assertEquals(log.map((r) => [r.kind, r.url, r.bundle]), [
      ["pick", "https://a.test/c1", false],
    ]);
  }));

test("postDigest writes nothing when the parent post fails", () =>
  withPool(async (home) => {
    const post = () => Promise.reject(new Error("chat.postMessage: down"));
    await assertRejects(
      () =>
        postDigest(
          "D1",
          { picks: [{ id: "c1", reason: "r" }], bundles: [] },
          post,
        ),
      Error,
      "down",
    );
    assertEquals(await readJson("messages.json", {}), {});
    assertEquals(await readJson("seen.json", { ids: [] }), { ids: ["old"] });
    assertEquals((await readJson<Pool>("pool.json", pool)).postedAt, undefined);
    assertEquals(await digestLog(home), []);
  }));

test("postDigest logs bundle items and marks an empty digest seen", () =>
  withPool(async (home) => {
    let n = 0;
    const post = (_c: string, _t: string, thread?: string) =>
      Promise.resolve(thread ? `2000000000.00${++n}` : "parent");
    await postDigest("D1", {
      picks: [{ id: "c1", reason: "r", explore: true }],
      bundles: [{
        items: [{ id: "g1", reason: "x" }, { id: "g2", reason: "y" }],
      }],
    }, post);
    const log = await digestLog(home);
    assertEquals(log.map((r) => [r.url, r.explore, r.bundle]), [
      ["https://a.test/c1", true, false],
      ["https://a.test/g1", false, true],
      ["https://a.test/g2", false, true],
    ]);

    await writeJson("pool.json", pool);
    await writeJson("seen.json", { ids: [] });
    await postDigest("D1", { picks: [], bundles: [] }, post);
    const seen = await readJson<{ ids: string[] }>("seen.json", { ids: [] });
    assertEquals(seen.ids.length, pool.items.length);
  }));

test("postDigest answers a repeat call on a posted pool without posting", () =>
  withPool(async () => {
    let n = 0;
    const post = (_c: string, _t: string, thread?: string) =>
      Promise.resolve(thread ? `2000000000.00${++n}` : "parent");
    const input = { picks: [{ id: "c1", reason: "r" }], bundles: [] };
    await postDigest("D1", input, post);
    const posts = n;
    assertStringIncludes(
      await postDigest("D1", input, post),
      "Already posted",
    );
    assertEquals(n, posts);
  }));

test("postDigest keeps message refs written by a reaction meanwhile", () =>
  withPool(async () => {
    let n = 0;
    const post = async (_c: string, _t: string, thread?: string) => {
      if (thread && n === 0) {
        // A reaction handler writing its own ref while the digest posts.
        await writeJson("messages.json", {
          "2000000000.999": { kind: "article", channel: "D1", text: "old" },
        });
      }
      return thread ? `2000000000.00${++n}` : "parent";
    };
    await postDigest("D1", {
      picks: [{ id: "c1", reason: "r" }, { id: "c2", reason: "r" }],
      bundles: [],
    }, post);
    const messages = await readJson<Record<string, unknown>>(
      "messages.json",
      {},
    );
    assertEquals(Object.keys(messages).sort(), [
      "2000000000.001",
      "2000000000.002",
      "2000000000.999",
    ]);
  }));
