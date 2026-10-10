import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { test } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run } from "../../agents/lib/proc.ts";

const MAIN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CHILD = "33333333-3333-4333-8333-333333333333";
const STATUS = new URL("./codex-pane-status.ts", import.meta.url).pathname;
const NOTIFY = new URL("./codex-notify.ts", import.meta.url).pathname;
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;

async function output(
  cmd: string,
  args: string[],
  env?: Record<string, string>,
) {
  const result = await run(cmd, args, { env });
  assertEquals(result.code, 0, `${cmd}: ${result.stderr.trim()}`);
  return result.stdout.trim();
}

async function sandbox() {
  const root = await mkdtemp(join(tmpdir(), "codex-pane-test-"));
  const socket = `${root}/tmux.sock`;
  const tmux = await output("/usr/bin/which", ["tmux"]);
  const call = (args: string[]) => output(tmux, ["-S", socket, ...args]);
  await mkdir(`${root}/.codex`);
  await mkdir(`${root}/bin`);
  const compiled = await run("cc", ["-x", "c", "-o", `${root}/codex`, "-"], {
    stdin: "#include <unistd.h>\nint main(void) { for (;;) pause(); }\n",
  });
  assertEquals(compiled.code, 0, compiled.stderr);
  await writeFile(
    `${root}/bin/tmux`,
    `#!/bin/sh\n[ "$1" = -L ] && [ "$2" = default ] || exit 90\nshift 2\n${
      quote(tmux)
    } -S ${quote(socket)} "$@"\nresult=$?\nif [ "$1" = list-panes ]; then : > ${
      quote(`${root}/panes-observed`)
    }; fi\nexit "$result"\n`,
  );
  await chmod(`${root}/bin/tmux`, 0o755);
  await writeFile(
    `${root}/bin/terminal-notifier`,
    `#!/bin/sh\nprintf '%s\\n' "$@" >> ${quote(`${root}/notification.txt`)}\n`,
  );
  await chmod(`${root}/bin/terminal-notifier`, 0o755);
  const env = {
    HOME: root,
    TMUX_PANE: "%99999",
    TMUX: "/nonexistent/stale,1,0",
    PATH: `${root}/bin:${process.env.PATH}`,
    // HOME is replaced above; without this the children's transpiler cache
    // would be written into the fixture directory.
    BUN_RUNTIME_TRANSPILER_CACHE_PATH:
      `${process.env.HOME}/Library/Caches/bun/@t@`,
  };
  const database = `${root}/.codex/state_5.sqlite`;
  const sql = (query: string) => output("/usr/bin/sqlite3", [database, query]);
  await sql(
    `CREATE TABLE threads(id TEXT PRIMARY KEY); CREATE TABLE thread_spawn_edges(child_thread_id TEXT PRIMARY KEY,parent_thread_id TEXT); INSERT INTO threads VALUES ('${MAIN}'),('${OTHER}'),('${CHILD}'); INSERT INTO thread_spawn_edges VALUES ('${CHILD}','${MAIN}');`,
  );
  const first = await call([
    "-f",
    "/dev/null",
    "new-session",
    "-d",
    "-s",
    "probe",
    "-P",
    "-F",
    "#{pane_id}",
    `exec ${quote(`${root}/codex`)} 600`,
  ]);
  const second = await call([
    "new-window",
    "-d",
    "-t",
    "probe",
    "-P",
    "-F",
    "#{pane_id}",
    `exec ${quote(`${root}/codex`)} 600`,
  ]);
  const title = (pane: string, id: string) =>
    call([
      "select-pane",
      "-t",
      pane,
      "-T",
      `codex | ${id.slice(0, 29)}... | test`,
    ]);
  await title(first, MAIN);
  await title(second, OTHER);
  const get = (pane: string, key: string) =>
    call(["display-message", "-p", "-t", pane, `#{${key}}`]);
  const hook = async (event: string, id = MAIN, extra = {}) => {
    const result = await run(STATUS, [event], {
      env,
      stdin: JSON.stringify({ session_id: id, cwd: root, ...extra }),
    });
    assertEquals(result.code, 0, result.stderr);
    assertEquals(result.stdout.length, 0);
  };
  return {
    root,
    first,
    second,
    call,
    get,
    title,
    hook,
    sql,
    env,
    async close() {
      await call(["kill-server"]);
      await rm(root, { recursive: true });
    },
  };
}

test(
  "isolated tmux: lifecycle, concurrent sessions, child completion and notification targets",
  async () => {
    const s = await sandbox();
    try {
      await s.hook("UserPromptSubmit", MAIN, { prompt: "first task" });
      assertEquals(await s.get(s.first, "@pane_session_id"), MAIN);
      assertEquals(await s.get(s.first, "@pane_status"), "running");
      assertEquals(await s.get(s.second, "@pane_agent"), "");
      await s.hook("SessionStart");
      assertEquals(await s.get(s.first, "@pane_status"), "running");
      await s.hook("UserPromptSubmit", OTHER, { prompt: "second task" });
      assertEquals(await s.get(s.second, "@pane_session_id"), OTHER);
      await s.hook("PermissionRequest");
      assertEquals(await s.get(s.first, "@pane_status"), "waiting");
      assertEquals(await s.get(s.second, "@pane_status"), "running");
      await s.hook("PreToolUse", MAIN, {
        tool_name: "Bash",
        tool_use_id: "tool-1",
      });
      assertEquals(await s.get(s.first, "@pane_status"), "running");
      await s.hook("PostToolUse", MAIN, {
        tool_name: "Bash",
        tool_use_id: "tool-1",
      });
      assertEquals(await s.get(s.first, "@pane_current_tool"), "");
      await s.hook("SessionStart", CHILD);
      assertStringIncludes(await s.get(s.first, "@pane_subagents"), CHILD);
      await s.hook("Stop", MAIN);
      assertEquals(await s.get(s.first, "@pane_main_stopped"), "1");
      await s.hook("Stop", CHILD);
      assertEquals(await s.get(s.first, "@pane_status"), "idle");
      assertEquals(await s.get(s.first, "@pane_session_id"), MAIN);
      await output(NOTIFY, [
        "send",
        JSON.stringify({ "thread-id": MAIN, "last-assistant-message": "test" }),
      ], { ...s.env, CODEX_THREAD_ID: OTHER });
      const log = await readFile(
        `${s.root}/.codex/logs/codex-notify.log`,
        "utf8",
      );
      assertStringIncludes(log, "tmux_context session=probe window=0 pane=0");
      assertStringIncludes(
        await readFile(`${s.root}/notification.txt`, "utf8"),
        "-execute",
      );
      const before = await readFile(`${s.root}/notification.txt`, "utf8");
      await output(NOTIFY, [
        "send",
        JSON.stringify({ "thread-id": CHILD }),
      ], s.env);
      assertEquals(
        await readFile(`${s.root}/notification.txt`, "utf8"),
        before,
      );
    } finally {
      await s.close();
    }
  },
  30_000,
);

test(
  "isolated tmux: startup waits for title and rejects switched sessions, collisions and missing DB",
  async () => {
    const s = await sandbox();
    try {
      await s.call(["select-pane", "-t", s.first, "-T", "codex"]);
      const pending = s.hook("SessionStart");
      const deadline = Date.now() + 2000;
      while (
        !await stat(`${s.root}/panes-observed`).then(() => true, () => false)
      ) {
        assert(Date.now() < deadline, "startup never read the initial title");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      await s.title(s.first, MAIN);
      await pending;
      assertEquals(await s.get(s.first, "@pane_session_id"), MAIN);
      await s.title(s.first, OTHER);
      await s.hook("PermissionRequest", MAIN);
      assertEquals(await s.get(s.first, "@pane_status"), "idle");
      await s.hook("UserPromptSubmit", OTHER);
      assertEquals(await s.get(s.first, "@pane_session_id"), OTHER);
      assertEquals(await s.get(s.second, "@pane_session_id"), OTHER);
      await s.sql(`INSERT INTO threads VALUES ('${OTHER.slice(0, -1)}3')`);
      await s.hook("PermissionRequest", OTHER);
      assertEquals(await s.get(s.first, "@pane_status"), "running");
      const log = await readFile(
        `${s.root}/.codex/logs/codex-pane-status.log`,
        "utf8",
      );
      assertStringIncludes(log, "ambiguous-title-id");
      await rename(
        `${s.root}/.codex/state_5.sqlite`,
        `${s.root}/database-backup`,
      );
      await s.hook("Stop", OTHER);
      assertEquals(await s.get(s.first, "@pane_status"), "running");
      assert(
        (await readFile(`${s.root}/.codex/logs/codex-pane-status.log`, "utf8"))
          .includes("database-unavailable"),
      );
      await s.call(["kill-pane", "-t", s.first]);
      await s.hook("Stop", MAIN);
      assertEquals(await s.get(s.second, "@pane_status"), "running");
    } finally {
      await s.close();
    }
  },
  30_000,
);
