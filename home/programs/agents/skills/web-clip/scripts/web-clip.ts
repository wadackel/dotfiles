#!/usr/bin/env -S deno run --allow-run=obsidian
// 起動中の Obsidian の Web Clip プラグインに URL を渡し、終わるまで待って結果を出す。使い方と終了コードは SKILL.md。
// 秘密は SecretStorage に置いたまま、取得も要約もプラグインが行う。
// `obsidian eval` は Promise を 200ms ほどしか待たないので、clip は run の id だけを受け取り、status を繰り返し読む。

export type EvalOutput =
  | { kind: "value"; value: string }
  | { kind: "error"; message: string }
  | { kind: "empty" };

/** `obsidian eval` の出力は成功も例外も exit 0 なので、接頭辞で見分ける */
export const parseEval = (raw: string): EvalOutput => {
  const text = raw.trim();
  if (text.startsWith("=> ")) return { kind: "value", value: text.slice(3) };
  if (text.startsWith("Error: ")) {
    return { kind: "error", message: text.slice(7) };
  }
  if (text === "" || text === "(no output)") return { kind: "empty" };
  return { kind: "error", message: text };
};

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
};

export type Item = {
  url: string;
  status: string;
  path: string | null;
  reason: string | null;
};

export type Status = { phase: string; items: Item[] };

const TERMINAL = new Set(["created", "skipped", "failed", "cancelled"]);
const SUCCESS = new Set(["created", "skipped"]);

export const formatItem = (item: Item): string =>
  [
    item.status,
    item.url,
    item.path ?? "-",
    (item.reason ?? "").replace(/\s+/g, " "),
  ].join("\t");

export type Args = {
  vault: string;
  timeoutSec: number;
  run: string | null;
  urls: string[];
};

export const parseArgs = (argv: string[]): Args | string => {
  const args: Args = { vault: "Main", timeoutSec: 600, run: null, urls: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === "--vault" || arg === "--timeout" || arg === "--run") {
      if (value == null || value.startsWith("--")) return `${arg} に値がない`;
      if (arg === "--vault") args.vault = value;
      if (arg === "--run") args.run = value;
      if (arg === "--timeout") {
        const sec = Number(value);
        if (!Number.isFinite(sec) || sec <= 0) {
          return `--timeout は正の秒数: ${value}`;
        }
        args.timeoutSec = sec;
      }
      i++;
    } else if (arg.startsWith("--")) {
      return `不明なオプション: ${arg}`;
    } else {
      args.urls.push(arg);
    }
  }

  args.urls = [...new Set(args.urls)];
  if (args.run != null && args.urls.length > 0) {
    return "--run と URL は同時に渡せない";
  }
  if (args.run == null && args.urls.length === 0) return "URL がない";
  if (args.run != null && !/^[0-9a-z]+-[0-9]+$/.test(args.run)) {
    return `run id の形ではない: ${args.run}`;
  }
  const invalid = args.urls.filter((url) => {
    // URL パーサは改行や \ を黙って読み替えるので、ここで弾いて入力どおりの URL だけを送る
    if (!URL.canParse(url) || /[\s\\]/.test(url)) return true;
    const { protocol } = new URL(url);
    return protocol !== "http:" && protocol !== "https:";
  });
  if (invalid.length > 0) {
    return `http/https の URL ではない: ${invalid.join(" ")}`;
  }
  return args;
};

export type Io = {
  evaluate: (code: string) => Promise<string>;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  out: (line: string) => void;
  err: (line: string) => void;
};

const API = "app.plugins.plugins['web-clip']";

/**
 * 値を eval のコードへ埋め込む。JSON 文字列リテラルのままだと、CLI が値の中の `\n` や `\t` を
 * 読み替えるため、引用符とバックスラッシュを含まない形に符号化してから戻す
 */
export const literal = (value: unknown): string =>
  `JSON.parse(decodeURIComponent("${
    encodeURIComponent(JSON.stringify(value))
  }"))`;

const PROBE_ATTEMPTS = 5;

const probe = async (io: Io): Promise<string | null> => {
  for (let attempt = 1; attempt <= PROBE_ATTEMPTS; attempt++) {
    const result = parseEval(await io.evaluate(`typeof ${API}?.api?.clip`));
    if (result.kind === "value") {
      return result.value === "function"
        ? null
        : "Web Clip プラグインが読み込まれていないか古い。対象 vault で Reload app without saving を実行する";
    }
    if (result.kind === "error") {
      return `Obsidian が応答しない: ${result.message}`;
    }
    // 開いていない vault への最初の eval は窓を開くだけで空を返す。probe は副作用がないのでやり直せる
    if (attempt < PROBE_ATTEMPTS) await io.sleep(1000);
  }
  return "Obsidian が起動していないか、vault が開いていない";
};

type Started = { id: string } | { exit: number };

const start = async (
  io: Io,
  urls: string[],
  deadline: number,
): Promise<Started> => {
  while (true) {
    // clip は副作用があるので、空の出力でもやり直さない。やり直すと run が 2 つ走りうる
    const result = parseEval(
      await io.evaluate(`${API}.api.clip(${literal(urls)})`),
    );
    if (result.kind === "empty") {
      io.err(
        "clip の応答が空で、開始したか分からない。Obsidian の進捗ペインを確認する",
      );
      return { exit: 2 };
    }
    if (result.kind === "error") {
      io.err(`clip が失敗した: ${result.message}`);
      return { exit: 2 };
    }
    const body = parseJson(result.value) as {
      id?: string;
      error?: string;
      missing?: string[];
    } | null;
    if (body == null) {
      io.err(
        `clip の応答を読めず、開始したか分からない。Obsidian の進捗ペインを確認する: ${result.value}`,
      );
      return { exit: 2 };
    }
    if (body.id != null) return { id: body.id };
    if (body.error !== "busy") {
      const detail = body.missing == null ? "" : `: ${body.missing.join(", ")}`;
      io.err(`clip を始められない (${body.error ?? "unknown"}${detail})`);
      return { exit: 2 };
    }
    if (io.now() >= deadline) {
      io.out(["busy", "-", "-", "not started"].join("\t"));
      return { exit: 1 };
    }
    await io.sleep(2000);
  }
};

const report = (io: Io, status: Status): number => {
  for (const item of status.items) io.out(formatItem(item));
  return status.items.every((item) => SUCCESS.has(item.status)) ? 0 : 1;
};

const POLL_ERROR_LIMIT = 5;

const poll = async (io: Io, id: string, deadline: number): Promise<number> => {
  let last: Status | null = null;
  let errors = 0;
  while (true) {
    const result = parseEval(
      await io.evaluate(`${API}.api.status(${literal(id)})`),
    );
    const body = result.kind === "value"
      ? (parseJson(result.value) as Status | { error: string } | null)
      : null;
    if (body != null && "error" in body) {
      if (last == null) {
        io.err(`run ${id} が見つからない`);
        return 2;
      }
      report(io, last);
      io.err(`run ${id} を見失った。Obsidian が再読込された可能性がある`);
      return 1;
    }
    if (body != null) {
      errors = 0;
      last = body;
      if (body.items.every((item) => TERMINAL.has(item.status))) {
        return report(io, body);
      }
    } else if (result.kind !== "empty" && ++errors >= POLL_ERROR_LIMIT) {
      // プラグインが無効化されたときなどは同じ失敗が続く。時間切れまで待つと still running と誤って案内する
      if (last != null) report(io, last);
      io.err(
        `status を読めない: ${
          result.kind === "error" ? result.message : result.value
        }`,
      );
      return 1;
    }
    if (io.now() >= deadline) {
      if (last != null) report(io, last);
      io.err(`still running in Obsidian (run ${id})`);
      return 1;
    }
    await io.sleep(1000);
  }
};

export const main = async (argv: string[], io: Io): Promise<number> => {
  const args = parseArgs(argv);
  if (typeof args === "string") {
    io.err(args);
    return 2;
  }
  const deadline = io.now() + args.timeoutSec * 1000;

  const notReady = await probe(io);
  if (notReady != null) {
    io.err(notReady);
    return 2;
  }

  let id = args.run;
  if (id == null) {
    const started = await start(io, args.urls, deadline);
    if ("exit" in started) return started.exit;
    id = started.id;
    // ツールのタイムアウトで殺されても、agent が --run で続きを追えるよう先に出す
    io.out(["started", id].join("\t"));
  }
  return await poll(io, id, deadline);
};

if (import.meta.main) {
  const args = parseArgs(Deno.args);
  const vault = typeof args === "string" ? "Main" : args.vault;
  const decoder = new TextDecoder();
  const io: Io = {
    evaluate: async (code) => {
      try {
        const result = await new Deno.Command("obsidian", {
          args: [`vault=${vault}`, "eval", `code=${code}`],
          stdout: "piped",
          stderr: "piped",
        }).output();
        // Electron が stderr に出す警告を値に混ぜない。stdout が空のときだけ診断に使う
        const stdout = decoder.decode(result.stdout);
        const stderr = decoder.decode(result.stderr).trim();
        return stdout.trim() === "" && stderr !== ""
          ? `Error: ${stderr}`
          : stdout;
      } catch (e) {
        if (e instanceof Deno.errors.NotFound) {
          return "Error: obsidian CLI が見つからない";
        }
        throw e;
      }
    },
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    now: () => Date.now(),
    out: (line) => console.log(line),
    err: (line) => console.error(line),
  };
  Deno.exit(await main(Deno.args, io));
}
