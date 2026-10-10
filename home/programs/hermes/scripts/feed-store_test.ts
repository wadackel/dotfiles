import { test } from "bun:test";
import { assertEquals, assertRejects } from "@std/assert";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendDigestLog,
  fetchText,
  readJson,
  readSecret,
  withStateLock,
  writeJson,
} from "./feed-store.ts";

async function withHome<T>(fn: (home: string) => Promise<T>): Promise<T> {
  const home = await mkdtemp(join(tmpdir(), "tmp-"));
  const prev = process.env.HOME;
  process.env.HOME = home;
  try {
    return await fn(home);
  } finally {
    if (prev) process.env.HOME = prev;
    await rm(home, { recursive: true });
  }
}

test("withStateLock serializes concurrent read-modify-write cycles", () =>
  withHome(async () => {
    await writeJson("counter.json", { n: 0 });
    await Promise.all(
      Array.from({ length: 10 }, () =>
        withStateLock(async () => {
          const { n } = await readJson("counter.json", { n: 0 });
          await new Promise((r) => setTimeout(r, 5));
          await writeJson("counter.json", { n: n + 1 });
        })),
    );
    assertEquals(await readJson("counter.json", { n: 0 }), { n: 10 });
  }));

test("readSecret strips quotes and rejects a missing name", () =>
  withHome(async (home) => {
    await mkdir(`${home}/.config/hermes`, { recursive: true });
    await writeFile(
      `${home}/.config/hermes/secrets.env`,
      "SLACK_BOT_TOKEN='xoxb-1'\nJEV_API_KEY=\"jev-2\"\nOTHER=3\n",
    );
    assertEquals(await readSecret("SLACK_BOT_TOKEN"), "xoxb-1");
    assertEquals(await readSecret("JEV_API_KEY"), "jev-2");
    await assertRejects(() => readSecret("MISSING"), Error, "MISSING");
  }));

test("appendDigestLog appends one JSON line per row", () =>
  withHome(async (home) => {
    const at = "2026-09-26T09:30:00.000Z";
    await appendDigestLog([
      {
        kind: "candidate",
        at,
        date: "2026-09-26",
        key: "c1",
        url: "https://a.test/1",
        title: "t",
        feedTitle: "A",
        interest: 0.8,
      },
    ]);
    await appendDigestLog([]);
    await appendDigestLog([
      {
        kind: "pick",
        at,
        date: "2026-09-26",
        url: "https://a.test/1",
        explore: false,
        bundle: false,
      },
    ]);
    const lines = (await readFile(
      `${home}/.config/hermes-feeds/digest-log.jsonl`,
      "utf8",
    )).trim().split("\n").map((l) => JSON.parse(l));
    assertEquals(lines.map((l) => l.kind), ["candidate", "pick"]);
    assertEquals(lines[0].interest, 0.8);
  }));

test("fetchText refuses a URL that is not http or https before fetching", async () => {
  const original = globalThis.fetch;
  let fetched = 0;
  globalThis.fetch = (() => {
    fetched++;
    return Promise.resolve(new Response("leaked"));
  }) as unknown as typeof fetch;
  try {
    for (const url of ["file:///etc/hosts", "data:text/plain,x"]) {
      await assertRejects(() => fetchText(url), Error, "unsupported protocol");
    }
    assertEquals(fetched, 0);
  } finally {
    globalThis.fetch = original;
  }
});
