import { assertEquals, assertThrows } from "jsr:@std/assert@1";
import { resolveDigest } from "./feeds-mcp.ts";
import type { Pool } from "./feed-store.ts";

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

Deno.test("resolveDigest maps ids to pool entries", () => {
  const got = resolveDigest(pool, {
    picks: [{ id: "c1", reason: "r", explore: true }],
    bundles: [{ ids: ["g1", "g2"], reason: ["x", "y"] }],
  });
  assertEquals(got.picks[0].entry.url, "https://a.test/c1");
  assertEquals(got.picks[0].explore, true);
  assertEquals(got.bundles[0].feedTitle, "GH");
  assertEquals(got.bundles[0].items.length, 2);
});

Deno.test("resolveDigest accepts an empty digest", () => {
  assertEquals(resolveDigest(pool, { picks: [], bundles: [] }), {
    picks: [],
    bundles: [],
  });
});

Deno.test("resolveDigest rejects unknown ids, reuse, and rule violations", () => {
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
        picks: ["c1", "c2", "c3", "c4", "c5", "c6"].map((c) => pick(c)),
        bundles: [],
      }),
    Error,
    "at most 5",
  );
  assertThrows(
    () =>
      resolveDigest(pool, {
        picks: [pick("c1", true), pick("c2", true)],
        bundles: [],
      }),
    Error,
    "explore",
  );
  assertThrows(
    () =>
      resolveDigest(pool, {
        picks: [],
        bundles: [{ ids: ["c1", "g1"], reason: ["a", "b"] }],
      }),
    Error,
    "single feed",
  );
  assertThrows(
    () =>
      resolveDigest(pool, {
        picks: [],
        bundles: [{ ids: ["g1"], reason: [] }],
      }),
    Error,
    "one reason",
  );
});
