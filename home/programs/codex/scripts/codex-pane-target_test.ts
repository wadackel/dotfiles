import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  CodexPaneResolver,
  parseTitleIdentity,
  type TargetCommand,
} from "./codex-pane-target.ts";

const MAIN = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";
const CHILD = "33333333-3333-4333-8333-333333333333";

Deno.test("title identity accepts configured ID segments and approval animations", () => {
  assertEquals(parseTitleIdentity(`codex | ${MAIN} | task`), MAIN);
  assertEquals(
    parseTitleIdentity(
      `[ ! ] Action Required | codex | ${MAIN.slice(0, 29)}... ⠋ | task`,
    ),
    MAIN.slice(0, 29),
  );
  assertEquals(
    parseTitleIdentity(`codex | ${MAIN.slice(0, 29)}... ⠋ ⠧ task | repo`),
    MAIN.slice(0, 29),
  );
  assertEquals(parseTitleIdentity(`a task mentions ${MAIN}`), null);
  assertEquals(parseTitleIdentity(`codex | task | ${MAIN}`), null);
  assertEquals(parseTitleIdentity("codex | 111... | task"), null);
});

function fixture(options: {
  duplicatePrefix?: boolean;
  databaseFailure?: boolean;
  nested?: boolean;
  title?: string;
  secondCopy?: boolean;
  noTitle?: boolean;
  callerPid?: number;
} = {}) {
  const calls: Array<{ cmd: string; args: string[] }> = [];
  const run: TargetCommand = (cmd, args) => {
    calls.push({ cmd, args });
    let stdout = "";
    if (cmd === "tmux") {
      stdout = [
        [
          "%1",
          "100",
          "codex",
          options.noTitle
            ? "old title"
            : options.title ?? `codex | ${MAIN.slice(0, 29)}... | task`,
        ].join("\x1f"),
        ["%2", "200", "codex", `codex | ${OTHER} | task`].join("\x1f"),
        ...(options.secondCopy
          ? [["%3", "300", "codex", `codex | ${MAIN} | task`].join("\x1f")]
          : []),
      ].join("\n");
    } else if (cmd === "ps") {
      stdout = [
        "100 1 zsh",
        "110 100 codex",
        "120 110 deno",
        "200 1 zsh",
        "210 200 codex",
        "300 1 zsh",
        "310 300 codex",
        "500 1 codex",
        "510 500 codex",
        "520 510 deno",
        ...(options.nested ? ["110 105 codex", "105 100 claude"] : []),
      ].join("\n");
    } else if (cmd === "/usr/bin/sqlite3") {
      if (options.databaseFailure) {
        return Promise.resolve({ code: 1, stdout: "", stderr: "locked" });
      }
      const sql = args.at(-1) ?? "";
      if (sql.includes("WITH RECURSIVE")) {
        stdout = JSON.stringify(
          (sql.includes(CHILD)
            ? [CHILD, MAIN]
            : sql.includes(OTHER)
            ? [OTHER]
            : [MAIN]).map((id) => ({ id })),
        );
      } else {
        stdout = JSON.stringify(
          (sql.includes(MAIN.slice(0, 29))
            ? [
              MAIN,
              ...(options.duplicatePrefix ? [MAIN.slice(0, -1) + "2"] : []),
            ]
            : [OTHER]).map((id) => ({ id })),
        );
      }
    }
    return Promise.resolve({ code: 0, stdout, stderr: "" });
  };
  return {
    calls,
    resolver: new CodexPaneResolver({
      codexHome: "/tmp/test-codex",
      run,
      callerPid: options.callerPid ?? 520,
    }),
  };
}

Deno.test("shared daemon ignores stale inherited pane and double codex ancestry", async () => {
  const { resolver, calls } = fixture();
  const result = await resolver.resolve(MAIN);
  assertEquals(result.targets.map((t) => [t.paneId, t.sessionId]), [[
    "%1",
    MAIN,
  ]]);
  assertEquals(
    calls.filter((c) => c.cmd === "tmux").every((c) =>
      c.args[0] === "-L" && c.args[1] === "default"
    ),
    true,
  );
});

Deno.test("same directory sessions and multiple views are isolated by identity", async () => {
  const { resolver } = fixture({ secondCopy: true });
  assertEquals((await resolver.resolve(MAIN)).targets.map((t) => t.paneId), [
    "%1",
    "%3",
  ]);
  assertEquals((await resolver.resolve(OTHER)).targets.map((t) => t.paneId), [
    "%2",
  ]);
});

Deno.test("subagent resolves through the recorded parent relationship", async () => {
  const { resolver } = fixture();
  assertEquals(
    (await resolver.resolve(CHILD)).targets.map((t) => t.sessionId),
    [MAIN],
  );
});

Deno.test("ambiguous IDs, database failures and nested agents never write", async () => {
  for (
    const options of [{ duplicatePrefix: true }, { databaseFailure: true }, {
      nested: true,
    }, { noTitle: true }]
  ) {
    assertEquals((await fixture(options).resolver.resolve(MAIN)).targets, []);
  }
});

Deno.test("a live TUI ancestry proves direct startup without a configured title", async () => {
  const { resolver } = fixture({ noTitle: true, callerPid: 120 });
  assertEquals(
    (await resolver.resolve(MAIN)).targets.map((t) => [t.paneId, t.source]),
    [["%1", "direct"]],
  );
});

Deno.test("revalidation rejects a switched or exited pane", async () => {
  const target = (await fixture().resolver.resolve(MAIN)).targets[0];
  assertEquals(
    await fixture({ title: `codex | ${OTHER} | task` }).resolver.isCurrent(
      target,
      MAIN,
    ),
    false,
  );
  assertEquals(
    await fixture({ nested: true }).resolver.isCurrent(target, MAIN),
    false,
  );
});

Deno.test("invalid IDs are rejected before invoking external commands", async () => {
  const { resolver, calls } = fixture();
  assertEquals(
    (await resolver.resolve("'; DELETE FROM threads; --")).reason,
    "invalid-session-id",
  );
  assertEquals(calls, []);
});
