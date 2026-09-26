import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { call } from "./slack.ts";

async function withSecrets<T>(fn: () => Promise<T>): Promise<T> {
  const home = await Deno.makeTempDir();
  const prev = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  await Deno.mkdir(`${home}/.config/hermes`, { recursive: true });
  await Deno.writeTextFile(
    `${home}/.config/hermes/secrets.env`,
    'SLACK_BOT_TOKEN="xoxb-test"\n',
  );
  try {
    return await fn();
  } finally {
    if (prev) Deno.env.set("HOME", prev);
    await Deno.remove(home, { recursive: true });
  }
}

function stubFetch(responses: (() => Response)[]) {
  const original = globalThis.fetch;
  let i = 0;
  globalThis.fetch = () => Promise.resolve(responses[i++]());
  return { calls: () => i, restore: () => (globalThis.fetch = original) };
}

const ok = () => Response.json({ ok: true, ts: "1.2" });
const limited = (retryAfter?: string) => () =>
  new Response("", {
    status: 429,
    headers: retryAfter ? { "retry-after": retryAfter } : {},
  });
const recordWaits = () => {
  const waits: number[] = [];
  return { waits, wait: (ms: number) => Promise.resolve(waits.push(ms)) };
};

Deno.test("call waits out Retry-After on 429 and then succeeds", async () => {
  const f = stubFetch([limited("3"), ok]);
  const { waits, wait } = recordWaits();
  try {
    const json = await withSecrets(() => call("chat.postMessage", {}, wait));
    assertEquals(json.ts, "1.2");
    assertEquals(waits, [3000]);
  } finally {
    f.restore();
  }
});

Deno.test("call treats ok:false ratelimited like a 429 and caps the wait", async () => {
  const f = stubFetch([
    () =>
      Response.json({ ok: false, error: "ratelimited" }, {
        headers: { "retry-after": "120" },
      }),
    ok,
  ]);
  const { waits, wait } = recordWaits();
  try {
    await withSecrets(() => call("chat.postMessage", {}, wait));
    assertEquals(waits, [30_000]);
  } finally {
    f.restore();
  }
});

Deno.test("call gives up after five retries", async () => {
  const f = stubFetch(Array.from({ length: 6 }, () => limited()));
  const { waits, wait } = recordWaits();
  try {
    await withSecrets(() =>
      assertRejects(
        () => call("chat.postMessage", {}, wait),
        Error,
        "HTTP 429",
      )
    );
    assertEquals(f.calls(), 6);
    assertEquals(waits, [1000, 1000, 1000, 1000, 1000]);
  } finally {
    f.restore();
  }
});

Deno.test("call does not retry other errors", async () => {
  const f = stubFetch([
    () => Response.json({ ok: false, error: "invalid_auth" }),
  ]);
  try {
    await withSecrets(() =>
      assertRejects(() => call("chat.postMessage", {}), Error, "invalid_auth")
    );
    assertEquals(f.calls(), 1);
  } finally {
    f.restore();
  }
});
