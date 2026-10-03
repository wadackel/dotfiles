import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.224.0/assert/mod.ts";

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
  const result = await new Deno.Command(cmd, {
    args,
    env,
    stdout: "piped",
    stderr: "piped",
  }).output();
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();
  assertEquals(result.code, 0, `${cmd}: ${stderr}`);
  return stdout;
}

async function sandbox() {
  const root = await Deno.makeTempDir({ prefix: "codex-pane-test-" });
  const socket = `${root}/tmux.sock`;
  const tmux = await output("/usr/bin/which", ["tmux"]);
  const call = (args: string[]) => output(tmux, ["-S", socket, ...args]);
  await Deno.mkdir(`${root}/.codex`);
  await Deno.mkdir(`${root}/bin`);
  const compiler = new Deno.Command("cc", {
    args: ["-x", "c", "-o", `${root}/codex`, "-"],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const source = compiler.stdin.getWriter();
  await source.write(
    new TextEncoder().encode(
      "#include <unistd.h>\nint main(void) { for (;;) pause(); }\n",
    ),
  );
  await source.close();
  const compiled = await compiler.output();
  assertEquals(compiled.code, 0, new TextDecoder().decode(compiled.stderr));
  await Deno.writeTextFile(
    `${root}/bin/tmux`,
    `#!/bin/sh\n[ "$1" = -L ] && [ "$2" = default ] || exit 90\nshift 2\n${
      quote(tmux)
    } -S ${quote(socket)} "$@"\nresult=$?\nif [ "$1" = list-panes ]; then : > ${
      quote(`${root}/panes-observed`)
    }; fi\nexit "$result"\n`,
  );
  await Deno.chmod(`${root}/bin/tmux`, 0o755);
  await Deno.writeTextFile(
    `${root}/bin/terminal-notifier`,
    `#!/bin/sh\nprintf '%s\\n' "$@" >> ${quote(`${root}/notification.txt`)}\n`,
  );
  await Deno.chmod(`${root}/bin/terminal-notifier`, 0o755);
  const env = {
    HOME: root,
    TMUX_PANE: "%99999",
    TMUX: "/nonexistent/stale,1,0",
    PATH: `${root}/bin:${Deno.env.get("PATH")}`,
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
    const child = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--allow-env=HOME,TMUX_PANE",
        "--allow-read",
        "--allow-write",
        "--allow-run=tmux,ps,/usr/bin/sqlite3",
        STATUS,
        event,
      ],
      env,
      stdin: "piped",
      stdout: "piped",
      stderr: "piped",
    }).spawn();
    const writer = child.stdin.getWriter();
    await writer.write(
      new TextEncoder().encode(
        JSON.stringify({ session_id: id, cwd: root, ...extra }),
      ),
    );
    await writer.close();
    const result = await child.output();
    assertEquals(result.code, 0, new TextDecoder().decode(result.stderr));
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
      await Deno.remove(root, { recursive: true });
    },
  };
}

Deno.test("isolated tmux: lifecycle, concurrent sessions, child completion and notification targets", async () => {
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
    await output(Deno.execPath(), [
      "run",
      "--allow-env=HOME,TMPDIR,TMUX_PANE,CODEX_THREAD_ID",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      NOTIFY,
      "send",
      JSON.stringify({ "thread-id": MAIN, "last-assistant-message": "test" }),
    ], { ...s.env, CODEX_THREAD_ID: OTHER });
    const log = await Deno.readTextFile(
      `${s.root}/.codex/logs/codex-notify.log`,
    );
    assertStringIncludes(log, "tmux_context session=probe window=0 pane=0");
    assertStringIncludes(
      await Deno.readTextFile(`${s.root}/notification.txt`),
      "-execute",
    );
    const before = await Deno.readTextFile(`${s.root}/notification.txt`);
    await output(Deno.execPath(), [
      "run",
      "--allow-env=HOME,TMPDIR,TMUX_PANE,CODEX_THREAD_ID",
      "--allow-read",
      "--allow-write",
      "--allow-run",
      NOTIFY,
      "send",
      JSON.stringify({ "thread-id": CHILD }),
    ], s.env);
    assertEquals(await Deno.readTextFile(`${s.root}/notification.txt`), before);
  } finally {
    await s.close();
  }
});

Deno.test("isolated tmux: startup waits for title and rejects switched sessions, collisions and missing DB", async () => {
  const s = await sandbox();
  try {
    await s.call(["select-pane", "-t", s.first, "-T", "codex"]);
    const pending = s.hook("SessionStart");
    const deadline = Date.now() + 2000;
    while (
      !await Deno.stat(`${s.root}/panes-observed`).then(() => true, () => false)
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
    const log = await Deno.readTextFile(
      `${s.root}/.codex/logs/codex-pane-status.log`,
    );
    assertStringIncludes(log, "ambiguous-title-id");
    await Deno.rename(
      `${s.root}/.codex/state_5.sqlite`,
      `${s.root}/database-backup`,
    );
    await s.hook("Stop", OTHER);
    assertEquals(await s.get(s.first, "@pane_status"), "running");
    assert(
      (await Deno.readTextFile(`${s.root}/.codex/logs/codex-pane-status.log`))
        .includes("database-unavailable"),
    );
    await s.call(["kill-pane", "-t", s.first]);
    await s.hook("Stop", MAIN);
    assertEquals(await s.get(s.second, "@pane_status"), "running");
  } finally {
    await s.close();
  }
});
