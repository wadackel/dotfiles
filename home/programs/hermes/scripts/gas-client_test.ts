import { test } from "bun:test";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "@std/assert";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../agents/lib/proc.ts";
import { BridgeError, callBridge } from "./gas-client.ts";

// A node:http server on a free local port whose handler is written against
// the fetch Request and Response types.
async function serve(
  handler: (req: Request) => Response | Promise<Response>,
): Promise<{ port: number; close: () => Promise<void> }> {
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    const response = await handler(
      new Request(`http://${req.headers.host}${req.url}`, {
        method: req.method,
        headers: req.headers as Record<string, string>,
        body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
      }),
    );
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: (server.address() as AddressInfo).port,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
}

async function withBridge(
  handler: (req: Request, body: unknown) => Response,
  fn: (log: () => Promise<string>) => Promise<void>,
): Promise<void> {
  let posted: unknown;
  const server = await serve(async (req) => {
    const url = new URL(req.url);
    // Mimics Apps Script: the POST is answered with a redirect that the
    // client must follow as a GET to read the result. The query stands in
    // for user_content_key, which lets anyone holding it read the result.
    if (req.method === "POST" && url.pathname === "/exec") {
      posted = await req.json();
      return Response.redirect(
        new URL("/echo?user_content_key=SECRETKEY", url).href,
        302,
      );
    }
    return handler(req, posted);
  });
  const home = await mkdtemp(join(tmpdir(), "tmp-"));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  await mkdir(`${home}/.config/hermes-google`, { recursive: true });
  await mkdir(`${home}/Library/Logs`, { recursive: true });
  await writeFile(
    `${home}/.config/hermes-google/bridge.json`,
    JSON.stringify({
      url: `http://127.0.0.1:${server.port}/exec`,
      secret: "s3cret",
    }),
  );
  const log = () =>
    readFile(`${home}/Library/Logs/hermes-scripts.log`, "utf8").catch(() => "");
  try {
    await fn(log);
  } finally {
    if (prevHome) process.env.HOME = prevHome;
    await server.close();
    await rm(home, { recursive: true });
  }
}

test("callBridge sends the secret in the body and follows the redirect", async () => {
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

test("callBridge surfaces errors reported by the bridge", async () => {
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

// Trimmed from the page Google serves for an unknown path.
const GOOGLE_404 =
  `<!DOCTYPE html><html lang=en><meta charset=utf-8><meta name=viewport content="initial-scale=1, minimum-scale=1, width=device-width"><title>Error 404 (Not Found)!!1</title><style>*{margin:0;padding:0}html,code{font:15px/22px arial,sans-serif}</style><a href=//www.google.com/><span id=logo aria-label=Google></span></a><p><b>404.</b> <ins>That’s an error.</ins><p>The requested URL was not found on this server. <ins>That’s all we know.</ins>`;

test("callBridge logs what a failed response was, never what was sent", async () => {
  await withBridge(
    () =>
      new Response(GOOGLE_404, {
        status: 404,
        headers: { "content-type": "text/html; charset=UTF-8" },
      }),
    async (log) => {
      const err = await assertRejects(
        () => callBridge("createEvent", { event: { summary: "歯医者" } }),
        BridgeError,
        "createEvent: HTTP 404",
      );
      assertEquals(err.reported, false);
      assertEquals(err.name, "Error");
      const text = await log();
      assertStringIncludes(text, "bridge createEvent attempt 1/1 failed after");
      assertStringIncludes(text, "createEvent: HTTP 404");
      assertStringIncludes(text, "127.0.0.1");
      assertStringIncludes(text, "/echo");
      assertStringIncludes(text, "text/html");
      assertStringIncludes(text, "Error 404 (Not Found)!!1");
      for (const leaked of ["SECRETKEY", "s3cret", "歯医者"]) {
        assert(!text.includes(leaked), `log leaks ${leaked}`);
      }
    },
  );
});

test("callBridge summarizes a page without a title by its text", async () => {
  await withBridge(
    () =>
      new Response("<html><body><p>Sorry,   unable to\n open the file</p>", {
        headers: { "content-type": "text/html" },
      }),
    async (log) => {
      await assertRejects(
        () => callBridge("createEvent", {}),
        BridgeError,
        "non-JSON",
      );
      assertStringIncludes(await log(), "Sorry, unable to open the file");
    },
  );
});

test("callBridge marks an error the bridge itself reported", async () => {
  await withBridge(
    () => Response.json({ error: "Exception: invalid time" }),
    async () => {
      const err = await assertRejects(
        () => callBridge("createEvent", {}),
        BridgeError,
        "createEvent: Exception: invalid time",
      );
      assertEquals(err.reported, true);
    },
  );
});

test("an uncaught BridgeError keeps its detail off stderr", async () => {
  // Bun prints the source around the throwing line, so neither value may
  // appear literally in gas-client.ts or in the child script.
  const path = `/echo-${randomUUID()}`;
  const marker = `marker-${randomUUID()}`;
  const server = await serve((req) => {
    const url = new URL(req.url);
    if (req.method === "POST") {
      return Response.redirect(new URL(path, url).href, 302);
    }
    return Response.json({ error: "boom", note: marker });
  });
  const home = await mkdtemp(join(tmpdir(), "tmp-"));
  await mkdir(`${home}/.config/hermes-google`, { recursive: true });
  await mkdir(`${home}/Library/Logs`, { recursive: true });
  await writeFile(
    `${home}/.config/hermes-google/bridge.json`,
    JSON.stringify({
      url: `http://127.0.0.1:${server.port}/exec`,
      secret: "s",
    }),
  );
  const child = `${home}/child.ts`;
  await writeFile(
    child,
    `import { callBridge } from ${
      JSON.stringify(join(import.meta.dirname, "gas-client.ts"))
    };\nawait callBridge("createEvent", {});\n`,
  );
  try {
    const { code, stderr } = await run(process.execPath, [
      "--no-env-file",
      "--no-install",
      "--config=/dev/null",
      child,
    ], { env: { HOME: home, BUN_RUNTIME_TRANSPILER_CACHE_PATH: "0" } });
    assertEquals(code, 1, stderr);
    assertStringIncludes(stderr, "createEvent: boom");
    for (const leaked of [marker, path]) {
      assert(!stderr.includes(leaked), `stderr leaks ${leaked}:\n${stderr}`);
    }
    // The stub was reached and the detail was built: it is in the trace log.
    assertStringIncludes(
      await readFile(`${home}/Library/Logs/hermes-scripts.log`, "utf8"),
      marker,
    );
  } finally {
    await server.close();
    await rm(home, { recursive: true });
  }
});

test("callBridge logs each failed try and the one that succeeded", async () => {
  let gets = 0;
  await withBridge(
    () =>
      ++gets === 1
        ? new Response("<!DOCTYPE html>", {
          headers: { "content-type": "text/html" },
        })
        : Response.json({ result: "ok" }),
    async (log) => {
      assertEquals(
        await callBridge("listNewMail", {}, { retryDelaysMs: [0, 0] }),
        "ok",
      );
      const text = await log();
      assertStringIncludes(text, "bridge listNewMail attempt 1/3 failed");
      assertStringIncludes(text, "bridge listNewMail succeeded on attempt 2");
    },
  );
});

test("callBridge retries read actions but not createEvent", async () => {
  let posts = 0;
  let failFirst = true;
  const server = await serve((req) => {
    const url = new URL(req.url);
    if (req.method === "POST") {
      posts++;
      return Response.redirect(new URL("/echo", url).href, 302);
    }
    if (failFirst) {
      failFirst = false;
      return new Response("<!DOCTYPE html>", {
        headers: { "content-type": "text/html" },
      });
    }
    return Response.json({ result: "ok" });
  });
  const home = await mkdtemp(join(tmpdir(), "tmp-"));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  await mkdir(`${home}/.config/hermes-google`, { recursive: true });
  await writeFile(
    `${home}/.config/hermes-google/bridge.json`,
    JSON.stringify({
      url: `http://127.0.0.1:${server.port}/exec`,
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
    if (prevHome) process.env.HOME = prevHome;
    await server.close();
    await rm(home, { recursive: true });
  }
});

test("callBridge gives up on a bridge that stops answering", async () => {
  let posts = 0;
  const server = await serve(async (req) => {
    const url = new URL(req.url);
    if (req.method === "POST") {
      posts++;
      return Response.redirect(new URL("/echo", url).href, 302);
    }
    await new Promise((r) => setTimeout(r, 300));
    return Response.json({ result: "late" });
  });
  const home = await mkdtemp(join(tmpdir(), "tmp-"));
  const prevHome = process.env.HOME;
  process.env.HOME = home;
  await mkdir(`${home}/.config/hermes-google`, { recursive: true });
  await writeFile(
    `${home}/.config/hermes-google/bridge.json`,
    JSON.stringify({
      url: `http://127.0.0.1:${server.port}/exec`,
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
    if (prevHome) process.env.HOME = prevHome;
    await server.close();
    await rm(home, { recursive: true });
  }
});
