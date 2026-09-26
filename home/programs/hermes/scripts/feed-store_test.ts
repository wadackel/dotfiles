import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import {
  appendDigestLog,
  readJson,
  readSecret,
  withStateLock,
  writeJson,
} from "./feed-store.ts";

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

Deno.test("withStateLock serializes concurrent read-modify-write cycles", () =>
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

Deno.test("readSecret strips quotes and rejects a missing name", () =>
  withHome(async (home) => {
    await Deno.mkdir(`${home}/.config/hermes`, { recursive: true });
    await Deno.writeTextFile(
      `${home}/.config/hermes/secrets.env`,
      "SLACK_BOT_TOKEN='xoxb-1'\nJEV_API_KEY=\"jev-2\"\nOTHER=3\n",
    );
    assertEquals(await readSecret("SLACK_BOT_TOKEN"), "xoxb-1");
    assertEquals(await readSecret("JEV_API_KEY"), "jev-2");
    await assertRejects(() => readSecret("MISSING"), Error, "MISSING");
  }));

Deno.test("appendDigestLog appends one JSON line per row", () =>
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
    const lines = (await Deno.readTextFile(
      `${home}/.config/hermes-feeds/digest-log.jsonl`,
    )).trim().split("\n").map((l) => JSON.parse(l));
    assertEquals(lines.map((l) => l.kind), ["candidate", "pick"]);
    assertEquals(lines[0].interest, 0.8);
  }));
