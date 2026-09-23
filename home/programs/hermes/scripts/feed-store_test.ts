import { assertEquals } from "jsr:@std/assert@1";
import { readJson, withStateLock, writeJson } from "./feed-store.ts";

Deno.test("withStateLock serializes concurrent read-modify-write cycles", async () => {
  const home = await Deno.makeTempDir();
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  try {
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
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(home, { recursive: true });
  }
});
