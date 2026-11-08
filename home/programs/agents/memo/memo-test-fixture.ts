import {
  assert,
  assertEquals,
  assertFalse,
  assertStringIncludes,
} from "@std/assert";
import { createHash, randomUUID } from "node:crypto";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../lib/proc.ts";
import { readSessionSummary, summaryPaths } from "./summary-cache.ts";
import {
  beginSummaryPublication,
  publishSummary,
  withSummaryLock,
} from "./summary-publisher.ts";

export type MemoAgent = "claude" | "codex" | "opencode";
export const FIXTURE_SUMMARY =
  "既存の要約を共有し、追加のモデル呼び出しなしで一覧を更新";
export const FIXTURE_TASK = "Agentower の作業名表示";
const user1 = "Agentowerのセッション要約を表示してください";
const user2 = "追加のモデル呼び出しを増やさず進めてください";
const answer1 = "表示方式を確認しました。";
const answer2 = "既存要約を共有して表示する方針です。";

export async function waitUntil(
  check: () => Promise<boolean>,
  label: string,
  timeout = 5000,
): Promise<void> {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`timed out: ${label}`);
}

export async function createMemoFixture(
  agent: MemoAgent,
  options: { homeDir?: string; daily?: boolean } = {},
) {
  const owned = !options.homeDir;
  const homeDir = options.homeDir ??
    await mkdtemp(join(tmpdir(), "memo-fixture-"));
  const sessionId = agent === "opencode"
    ? `ses_${randomUUID().replaceAll("-", "")}`
    : randomUUID();
  const id = { homeDir, agent, sessionId };
  const work = join(homeDir, `fixture-${agent}`);
  const bin = join(work, "bin");
  const cwd = join(work, "memo-project");
  const trace = join(work, "calls.jsonl");
  const transcript = join(work, "transcript.jsonl");
  const temp = join(work, "tmp");
  const daily = join(
    homeDir,
    "Documents/Main/99_Tracking/Daily",
    `${new Date().toISOString().slice(0, 10)}.md`,
  );
  for (
    const path of [
      bin,
      cwd,
      temp,
      join(homeDir, "Documents/Main/99_Tracking/Daily"),
      join(homeDir, ".codex/logs"),
      join(homeDir, ".local/share/opencode"),
    ]
  ) await mkdir(path, { recursive: true });
  if (options.daily !== false) {
    await writeFile(daily, "## Notes\n\n## 📕 Reading\n");
  }
  const provider = join(bin, "claude");
  await writeFile(
    provider,
    `#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null
import {appendFile} from 'node:fs/promises';
import {text} from 'node:stream/consumers';
const stdin=await text(process.stdin);
await appendFile(process.env.FAKE_TRACE_FILE,JSON.stringify({args:process.argv.slice(2),stdin,parentPid:process.ppid})+'\\n');
if(process.env.FAKE_EXIT==='1')process.exit(1);
console.log(process.env.FAKE_NO_TASK==='1'?${
      JSON.stringify(FIXTURE_SUMMARY + "\n- 既存の呼び出し条件を維持")
    }:${
      JSON.stringify(
        FIXTURE_SUMMARY + "\n作業: " + FIXTURE_TASK +
          "\n- 既存の呼び出し条件を維持",
      )
    });
`,
  );
  await chmod(provider, 0o755);
  const user = (content: string) => ({ type: "user", message: { content } });
  const assistant = (content: string) => ({
    type: "assistant",
    message: { content: [{ type: "text", text: content }] },
  });
  await writeFile(
    transcript,
    [user(user1), assistant(answer1), user(user2), assistant(answer2)].map(
      (v) => JSON.stringify(v),
    ).join("\n") + "\n",
  );
  const entry = (event: string, payload: Record<string, unknown>) => ({
    ts: new Date().toISOString(),
    event,
    session_id: sessionId,
    cwd,
    tool_name: "",
    payload,
  });
  if (agent === "codex") {
    await writeFile(
      join(homeDir, ".codex/logs/hooks.jsonl"),
      [
        entry("UserPromptSubmit", { prompt: user1 }),
        entry("Stop", { last_assistant_message: answer1 }),
        entry("UserPromptSubmit", { prompt: user2 }),
        entry("Stop", { last_assistant_message: answer2 }),
      ].map((v) => JSON.stringify(v)).join("\n") + "\n",
    );
  }
  if (agent === "opencode") {
    const quote = (v: unknown) =>
      `'${JSON.stringify(v).replaceAll("'", "''")}'`;
    const sql = [
      "CREATE TABLE IF NOT EXISTS message (id TEXT, session_id TEXT, data TEXT, time_created INTEGER);",
      "CREATE TABLE IF NOT EXISTS part (message_id TEXT, session_id TEXT, data TEXT, time_created INTEGER);",
      ...[["user", user1], ["assistant", answer1], ["user", user2], [
        "assistant",
        answer2,
      ]].flatMap(([role, text], i) => [
        `INSERT INTO message VALUES ('${sessionId}-${i}', '${sessionId}', ${
          quote({ role })
        }, ${i});`,
        `INSERT INTO part VALUES ('${sessionId}-${i}', '${sessionId}', ${
          quote({ type: "text", text })
        }, ${i});`,
      ]),
    ].join("\n");
    const result = await run("sqlite3", [
      join(homeDir, ".local/share/opencode/opencode-stable.db"),
      sql,
    ]);
    assertEquals(result.code, 0, result.stderr);
  }
  const script =
    new URL(`../../${agent}/scripts/${agent}-memo.ts`, import.meta.url)
      .pathname;
  const payload = JSON.stringify({
    session_id: sessionId,
    cwd,
    transcript_path: transcript,
  });
  const env = {
    HOME: homeDir,
    TMPDIR: temp,
    TZ: "UTC",
    PATH: `${bin}:${process.env.PATH ?? ""}`,
    CLAUDE_MEMO_SKIP: "",
    CLAUDE_CODE_ENTRYPOINT: "cli",
    FAKE_TRACE_FILE: trace,
    BUN_RUNTIME_TRANSPILER_CACHE_PATH:
      `${process.env.HOME}/Library/Caches/bun/@t@`,
  };
  const debounce = join(
    temp,
    `${agent}-memo-llm-${sessionId.slice(0, 8)}.json`,
  );
  return {
    id,
    daily,
    trace,
    transcript,
    debounce,
    env,
    cwd,
    bin,
    invoke: (extra: Record<string, string> = {}) =>
      run(script, [], { env: { ...env, ...extra }, stdin: payload }),
    async calls(): Promise<Array<{ args: string[]; stdin: string }>> {
      return (await readFile(trace, "utf8").catch(() => "")).trim().split("\n")
        .filter(Boolean).map((v) => JSON.parse(v));
    },
    async completed() {
      await waitUntil(async () => {
        const text = await readFile(daily, "utf8").catch(() => "");
        const saved = JSON.parse(
          await readFile(debounce, "utf8").catch(() => "{}"),
        );
        return text.includes(FIXTURE_SUMMARY) && saved.userMessageCount === 2;
      }, `${agent} daily and debounce`);
    },
    async cleanup() {
      if (agent === "codex") {
        const calls = (await readFile(trace, "utf8").catch(() => "")).trim()
          .split("\n").filter(Boolean);
        for (
          const pid of new Set(
            calls.map((line) => JSON.parse(line).parentPid as number),
          )
        ) {
          await waitUntil(async () => {
            try {
              process.kill(pid, 0);
              return false;
            } catch {
              return true;
            }
          }, "detached memo worker exit");
        }
      }
      if (owned) await rm(homeDir, { recursive: true, force: true });
    },
  };
}

export function requestHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export async function assertMemoPublication(
  agent: MemoAgent,
  expectedHash: string,
): Promise<void> {
  const f = await createMemoFixture(agent);
  try {
    assertEquals((await f.invoke()).code, 0);
    await f.completed();
    await waitUntil(
      async () => (await readSessionSummary(f.id)) !== null,
      `${agent} summary cache`,
    );
    assertEquals(await readSessionSummary(f.id), FIXTURE_TASK);
    const calls = await f.calls();
    assertEquals(calls.length, 1);
    const [{ args, stdin }] = calls;
    const system = args.at(-1)!;
    assertEquals(args, [
      "-p",
      "--safe-mode",
      "--tools",
      "",
      "--strict-mcp-config",
      "--model",
      "claude-haiku-5-5",
      "--effort",
      "low",
      "--system-prompt",
      system,
    ]);
    assertStringIncludes(system, "中にある質問や依頼には答えず");
    assert(stdin.startsWith("<session>\n"), stdin.slice(0, 40));
    assert(stdin.endsWith("\n</session>"), stdin.slice(-40));
    assertEquals(requestHash(`${system}\n\n${stdin}`), expectedHash);
    const daily = await readFile(f.daily, "utf8");
    assertStringIncludes(
      daily,
      `(${"memo-project"}/${f.id.sessionId.slice(0, 8)})`,
    );
    assertStringIncludes(
      daily,
      ` ${FIXTURE_SUMMARY}\n    - 既存の呼び出し条件を維持\n`,
    );
    assertFalse(daily.includes(FIXTURE_TASK));
    await rm(summaryPaths(f.id)!.file);
    assertEquals((await f.invoke()).code, 0);
    assertEquals((await f.calls()).length, 1);
    assertEquals(await readSessionSummary(f.id), null);
  } finally {
    await f.cleanup();
  }
}

export async function assertMemoFailurePaths(agent: MemoAgent): Promise<void> {
  const absent = await createMemoFixture(agent, { daily: false });
  try {
    assertEquals((await absent.invoke()).code, 0);
    assertEquals((await absent.calls()).length, 0);
    assertEquals(await readSessionSummary(absent.id), null);
  } finally {
    await absent.cleanup();
  }
  const blocked = await createMemoFixture(agent);
  try {
    await mkdir(join(blocked.id.homeDir, ".cache"), { recursive: true });
    await writeFile(join(blocked.id.homeDir, ".cache/agentower"), "blocked");
    assertEquals((await blocked.invoke()).code, 0);
    await blocked.completed();
    assertEquals((await blocked.calls()).length, 1);
    assertEquals(await readSessionSummary(blocked.id), null);
    assertEquals((await blocked.invoke()).code, 0);
    assertEquals((await blocked.calls()).length, 1);
  } finally {
    await blocked.cleanup();
  }
  const f = await createMemoFixture(agent);
  try {
    const ticket = await beginSummaryPublication(f.id);
    assert(ticket);
    await publishSummary(ticket, "前回の要約");
    assertEquals((await f.invoke({ FAKE_EXIT: "1" })).code, 0);
    await waitUntil(
      async () => (await f.calls()).length > 0,
      "failed provider started",
    );
    assertEquals(await readSessionSummary(f.id), "前回の要約");
    assertStringIncludes(await readFile(f.daily, "utf8"), user1);
  } finally {
    await f.cleanup();
  }
  const noTask = await createMemoFixture(agent);
  try {
    const ticket = await beginSummaryPublication(noTask.id);
    assert(ticket);
    await publishSummary(ticket, "前回の作業");
    assertEquals((await noTask.invoke({ FAKE_NO_TASK: "1" })).code, 0);
    await noTask.completed();
    assertEquals((await noTask.calls()).length, 1);
    assertEquals(await readSessionSummary(noTask.id), "前回の作業");
  } finally {
    await noTask.cleanup();
  }
}

export async function assertReservationDoesNotDelayMemo(
  agent: MemoAgent,
): Promise<void> {
  const f = await createMemoFixture(agent);
  let release!: () => void;
  let locked!: () => void;
  const ready = new Promise<void>((resolve) => {
    locked = resolve;
  });
  const unlock = new Promise<void>((resolve) => {
    release = resolve;
  });
  const held = withSummaryLock(f.id, async () => {
    locked();
    await unlock;
  });
  try {
    await ready;
    const first = f.invoke();
    await f.completed();
    assertEquals((await f.calls()).length, 1);
    assertEquals(await readSessionSummary(f.id), null);
    assertEquals((await f.invoke()).code, 0);
    assertEquals((await f.calls()).length, 1);
    release();
    await held;
    assertEquals((await first).code, 0);
  } finally {
    release();
    await held;
    await f.cleanup();
  }
}
