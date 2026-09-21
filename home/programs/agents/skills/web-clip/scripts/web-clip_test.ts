import { assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { type Io, literal, main, parseArgs, parseEval } from "./web-clip.ts";

type Harness = { io: Io; calls: string[]; out: string[]; err: string[] };

/** eval の応答を順に返す。clock は sleep した分だけ進む */
const harness = (
  responses: Array<string | ((code: string) => string)>,
): Harness => {
  const calls: string[] = [];
  const out: string[] = [];
  const err: string[] = [];
  let clock = 0;
  const io: Io = {
    evaluate: (code) => {
      calls.push(code);
      const next = responses.shift();
      if (next == null) throw new Error(`unexpected eval: ${code}`);
      return Promise.resolve(typeof next === "string" ? next : next(code));
    },
    sleep: (ms) => {
      clock += ms;
      return Promise.resolve();
    },
    now: () => clock,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
  };
  return { io, calls, out, err };
};

const item = (
  url: string,
  status: string,
  path: string | null = null,
  reason: string | null = null,
) => ({
  url,
  status,
  path,
  title: null,
  reason,
  failure: null,
});

const status = (phase: string, items: ReturnType<typeof item>[]) =>
  `=> ${JSON.stringify({ phase, counts: {}, items })}`;

const PROBE_OK = "=> function\n";

Deno.test("parseEval は接頭辞で値・例外・空を見分ける", () => {
  assertEquals(parseEval('=> {"a":"x\\"y"}\n'), {
    kind: "value",
    value: '{"a":"x\\"y"}',
  });
  assertEquals(parseEval("Error: boom\n"), { kind: "error", message: "boom" });
  assertEquals(parseEval("(no output)\n"), { kind: "empty" });
  assertEquals(parseEval(""), { kind: "empty" });
});

Deno.test("parseArgs は重複を除き、不正な URL と空を拒む", () => {
  const args = parseArgs([
    "https://a.test/p",
    "https://a.test/p",
    "--vault",
    "Dev",
  ]);
  assertEquals(args, {
    vault: "Dev",
    timeoutSec: 600,
    run: null,
    urls: ["https://a.test/p"],
  });
  assertStringIncludes(String(parseArgs(["ftp://a.test/p"])), "http/https");
  assertStringIncludes(String(parseArgs(["not a url"])), "http/https");
  assertEquals(parseArgs([]), "URL がない");
  assertEquals(
    parseArgs(["--run", "k-1", "https://a.test/p"]),
    "--run と URL は同時に渡せない",
  );
  assertStringIncludes(
    String(parseArgs(["https://a.test/x\\y"])),
    "http/https",
  );
  assertStringIncludes(
    String(parseArgs(["https://a.test/x\ny"])),
    "http/https",
  );
  assertStringIncludes(String(parseArgs(["--run", 'a"b'])), "run id");
});

Deno.test("全件 created なら TSV を出して exit 0", async () => {
  const h = harness([
    PROBE_OK,
    '=> {"id":"k-1"}',
    status("running", [item("https://a.test/p", "fetching")]),
    status("done", [item("https://a.test/p", "created", "04_Literature/p.md")]),
  ]);
  assertEquals(await main(["https://a.test/p"], h.io), 0);
  assertEquals(h.out, [
    "started\tk-1",
    "created\thttps://a.test/p\t04_Literature/p.md\t",
  ]);
  assertStringIncludes(
    h.calls[1],
    `api.clip(${literal(["https://a.test/p"])})`,
  );
  assertStringIncludes(h.calls[2], `api.status(${literal("k-1")})`);
});

Deno.test("failed を含めば exit 1 で、理由を出す", async () => {
  const h = harness([
    PROBE_OK,
    '=> {"id":"k-1"}',
    status("done", [
      item(
        "https://a.test/p",
        "skipped",
        "04_Literature/p.md",
        "既にクリップ済み",
      ),
      item("https://a.test/q", "failed", null, "Request failed, status 422"),
    ]),
  ]);
  assertEquals(await main(["https://a.test/p", "https://a.test/q"], h.io), 1);
  assertEquals(h.out.slice(1), [
    "skipped\thttps://a.test/p\t04_Literature/p.md\t既にクリップ済み",
    "failed\thttps://a.test/q\t-\tRequest failed, status 422",
  ]);
});

Deno.test("probe の空出力だけをやり直し、5 回とも空なら exit 2", async () => {
  const h = harness(["", "", "", "", ""]);
  assertEquals(await main(["https://a.test/p"], h.io), 2);
  assertEquals(h.calls.length, 5);
  assertStringIncludes(h.err[0], "起動していない");
});

Deno.test("probe が空のあと function を返せば続ける", async () => {
  const h = harness([
    "",
    PROBE_OK,
    '=> {"id":"k-1"}',
    status("done", [item("https://a.test/p", "created", "04_Literature/p.md")]),
  ]);
  assertEquals(await main(["https://a.test/p"], h.io), 0);
});

Deno.test("api が無ければ Reload を促して exit 2", async () => {
  const h = harness(["=> undefined"]);
  assertEquals(await main(["https://a.test/p"], h.io), 2);
  assertStringIncludes(h.err[0], "Reload");
});

Deno.test("clip の空出力はやり直さずに exit 2", async () => {
  const h = harness([PROBE_OK, ""]);
  assertEquals(await main(["https://a.test/p"], h.io), 2);
  assertEquals(h.calls.length, 2);
});

Deno.test("busy の間は待ってから始める", async () => {
  const h = harness([
    PROBE_OK,
    '=> {"error":"busy"}',
    '=> {"error":"busy"}',
    '=> {"id":"k-2"}',
    status("done", [item("https://a.test/p", "created", "04_Literature/p.md")]),
  ]);
  assertEquals(await main(["https://a.test/p"], h.io), 0);
  assertEquals(h.out[0], "started\tk-2");
});

Deno.test("始まる前に時間切れなら not started で exit 1", async () => {
  const h = harness([
    PROBE_OK,
    ...Array.from({ length: 10 }, () => '=> {"error":"busy"}'),
  ]);
  assertEquals(await main(["--timeout", "4", "https://a.test/p"], h.io), 1);
  assertEquals(h.out, ["busy\t-\t-\tnot started"]);
});

Deno.test("missing は理由を出して exit 2", async () => {
  const h = harness([
    PROBE_OK,
    '=> {"error":"missing","missing":["認証トークン"]}',
  ]);
  assertEquals(await main(["https://a.test/p"], h.io), 2);
  assertStringIncludes(h.err[0], "認証トークン");
});

Deno.test("時間切れなら最後の状態と run id を出して exit 1", async () => {
  const running = status("running", [
    item("https://a.test/p", "summarizing", "04_Literature/p.md"),
  ]);
  const h = harness([
    PROBE_OK,
    '=> {"id":"k-1"}',
    ...Array.from({ length: 10 }, () => running),
  ]);
  assertEquals(await main(["--timeout", "3", "https://a.test/p"], h.io), 1);
  assertEquals(
    h.out.at(-1),
    "summarizing\thttps://a.test/p\t04_Literature/p.md\t",
  );
  assertStringIncludes(h.err[0], "still running in Obsidian (run k-1)");
});

Deno.test("途中で unknown-id になったら最後の状態を出して exit 1", async () => {
  const h = harness([
    PROBE_OK,
    '=> {"id":"k-1"}',
    status("running", [item("https://a.test/p", "fetching")]),
    '=> {"error":"unknown-id"}',
  ]);
  assertEquals(await main(["https://a.test/p"], h.io), 1);
  assertEquals(h.out.at(-1), "fetching\thttps://a.test/p\t-\t");
  assertStringIncludes(h.err[0], "再読込");
});

Deno.test("--run は clip を呼ばずに既存の run を追う", async () => {
  const h = harness([
    PROBE_OK,
    status("done", [item("https://a.test/p", "created", "04_Literature/p.md")]),
  ]);
  assertEquals(await main(["--run", "k-9"], h.io), 0);
  assertEquals(h.calls.some((code) => code.includes("api.clip")), false);
  assertEquals(h.out, ["created\thttps://a.test/p\t04_Literature/p.md\t"]);
});

Deno.test("--run の id が最初から無ければ exit 2", async () => {
  const h = harness([PROBE_OK, '=> {"error":"unknown-id"}']);
  assertEquals(await main(["--run", "old-1"], h.io), 2);
});

Deno.test("埋め込むコードに引用符とバックスラッシュを残さず、元の値に戻せる", () => {
  const urls = ['https://a.test/?q="),alert(1)//'];
  const code = literal(urls);
  assertEquals(
    /[\\"]/.test(code.slice(code.indexOf('("') + 2, code.lastIndexOf('")'))),
    false,
  );
  assertEquals(new Function(`return ${code}`)(), urls);
});

Deno.test("clip の応答が JSON でなければ、開始したか不明として exit 2", async () => {
  const h = harness([PROBE_OK, "=> not json"]);
  assertEquals(await main(["https://a.test/p"], h.io), 2);
  assertStringIncludes(h.err[0], "開始したか分からない");
});

Deno.test("status の失敗が続けば時間切れを待たずに exit 1", async () => {
  const h = harness([
    PROBE_OK,
    '=> {"id":"k-1"}',
    ...Array.from({ length: 5 }, () => "Error: plugin disabled"),
  ]);
  assertEquals(await main(["https://a.test/p"], h.io), 1);
  assertStringIncludes(h.err[0], "plugin disabled");
});
