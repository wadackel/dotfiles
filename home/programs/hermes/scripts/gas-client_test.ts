import { assertEquals, assertRejects } from "jsr:@std/assert@1";
import { callBridge } from "./gas-client.ts";

async function withBridge(
  handler: (req: Request, body: unknown) => Response,
  fn: () => Promise<void>,
): Promise<void> {
  let posted: unknown;
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen: () => {},
  }, async (req) => {
    const url = new URL(req.url);
    // Mimics Apps Script: the POST is answered with a redirect that the
    // client must follow as a GET to read the result.
    if (req.method === "POST" && url.pathname === "/exec") {
      posted = await req.json();
      return Response.redirect(new URL("/echo", url), 302);
    }
    return handler(req, posted);
  });
  const home = await Deno.makeTempDir();
  const prevHome = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  await Deno.mkdir(`${home}/.config/hermes-google`, { recursive: true });
  await Deno.writeTextFile(
    `${home}/.config/hermes-google/bridge.json`,
    JSON.stringify({
      url: `http://127.0.0.1:${server.addr.port}/exec`,
      secret: "s3cret",
    }),
  );
  try {
    await fn();
  } finally {
    if (prevHome) Deno.env.set("HOME", prevHome);
    await server.shutdown();
    await Deno.remove(home, { recursive: true });
  }
}

Deno.test("callBridge sends the secret in the body and follows the redirect", async () => {
  await withBridge(
    (req, body) => Response.json({ result: { method: req.method, body } }),
    async () => {
      const result = await callBridge("listNewMail", { after: 1 });
      assertEquals(result, {
        method: "GET",
        body: { secret: "s3cret", action: "listNewMail", after: 1 },
      });
    },
  );
});

Deno.test("callBridge surfaces errors reported by the bridge", async () => {
  await withBridge(
    () => Response.json({ error: "unauthorized" }),
    async () => {
      await assertRejects(
        () => callBridge("createEvent", {}),
        Error,
        "unauthorized",
      );
    },
  );
});

Deno.test("callBridge retries read actions but not createEvent", async () => {
  let posts = 0;
  let failFirst = true;
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen: () => {},
  }, (req) => {
    const url = new URL(req.url);
    if (req.method === "POST") {
      posts++;
      return Response.redirect(new URL("/echo", url), 302);
    }
    if (failFirst) {
      failFirst = false;
      return new Response("<!DOCTYPE html>", {
        headers: { "content-type": "text/html" },
      });
    }
    return Response.json({ result: "ok" });
  });
  const home = await Deno.makeTempDir();
  const prevHome = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  await Deno.mkdir(`${home}/.config/hermes-google`, { recursive: true });
  await Deno.writeTextFile(
    `${home}/.config/hermes-google/bridge.json`,
    JSON.stringify({
      url: `http://127.0.0.1:${server.addr.port}/exec`,
      secret: "s",
    }),
  );
  try {
    assertEquals(
      await callBridge("listNewMail", {}, { retryDelaysMs: [0, 0] }),
      "ok",
    );
    assertEquals(posts, 2);
    failFirst = true;
    posts = 0;
    await assertRejects(
      () => callBridge("createEvent", {}, { retryDelaysMs: [0, 0] }),
      Error,
      "non-JSON",
    );
    assertEquals(posts, 1);
  } finally {
    if (prevHome) Deno.env.set("HOME", prevHome);
    await server.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});

Deno.test("callBridge gives up on a bridge that stops answering", async () => {
  let posts = 0;
  const server = Deno.serve({
    hostname: "127.0.0.1",
    port: 0,
    onListen: () => {},
  }, async (req) => {
    const url = new URL(req.url);
    if (req.method === "POST") {
      posts++;
      return Response.redirect(new URL("/echo", url), 302);
    }
    await new Promise((r) => setTimeout(r, 300));
    return Response.json({ result: "late" });
  });
  const home = await Deno.makeTempDir();
  const prevHome = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  await Deno.mkdir(`${home}/.config/hermes-google`, { recursive: true });
  await Deno.writeTextFile(
    `${home}/.config/hermes-google/bridge.json`,
    JSON.stringify({
      url: `http://127.0.0.1:${server.addr.port}/exec`,
      secret: "s",
    }),
  );
  const options = { retryDelaysMs: [0, 0], timeoutMs: 50 };
  try {
    await assertRejects(
      () => callBridge("listHolidays", {}, options),
      Error,
      "listHolidays: timed out",
    );
    assertEquals(posts, 3);
    posts = 0;
    await assertRejects(
      () => callBridge("createEvent", {}, options),
      Error,
      "createEvent: timed out",
    );
    assertEquals(posts, 1);
  } finally {
    if (prevHome) Deno.env.set("HOME", prevHome);
    await server.shutdown();
    await Deno.remove(home, { recursive: true });
  }
});
