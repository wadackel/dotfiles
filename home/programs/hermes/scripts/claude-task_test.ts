import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  claudeArgv,
  claudeSettings,
  decideAction,
  decodeSlack,
  isMergeWord,
  mergeReadiness,
  parseRequest,
  repoVocabulary,
  splitNul,
  touchesWorkflows,
} from "./claude-task.ts";

const owners = ["alice", "acme"];

Deno.test("parseRequest defaults the owner and keeps the task text", () => {
  assertEquals(parseRequest("!claude tool README の typo を直して", owners), {
    owner: "alice",
    repo: "tool",
    task: "README の typo を直して",
  });
  assertEquals(parseRequest("!claude acme/cli\n複数行の\n依頼", owners), {
    owner: "acme",
    repo: "cli",
    task: "複数行の\n依頼",
  });
});

Deno.test("parseRequest rejects other owners, bad names and empty tasks", () => {
  assert("error" in parseRequest("!claude work-org/app 直して", owners));
  assert("error" in parseRequest("!claude ../etc 直して", owners));
  assert("error" in parseRequest("!claude tool", owners));
  assert("error" in parseRequest("!claude", owners));
});

Deno.test("isMergeWord matches only the exact approval words", () => {
  for (
    const w of ["merge", " Merge ", "マージ", "マージして", "lgtm", "LGTM"]
  ) {
    assert(isMergeWord(w), w);
  }
  for (
    const w of [
      "マージしないで",
      "まだマージしない",
      "merge したら教えて",
      "LGTM?",
    ]
  ) {
    assert(!isMergeWord(w), w);
  }
});

Deno.test("mergeReadiness needs mergeable and no failing or pending checks", () => {
  const ok = { conclusion: "SUCCESS", status: "COMPLETED" };
  assertEquals(
    mergeReadiness({ mergeable: "MERGEABLE", statusCheckRollup: [] }),
    "ready",
  );
  assertEquals(
    mergeReadiness({ mergeable: "MERGEABLE", statusCheckRollup: [ok] }),
    "ready",
  );
  assertEquals(
    mergeReadiness({
      mergeable: "MERGEABLE",
      statusCheckRollup: [ok, { conclusion: "FAILURE", status: "COMPLETED" }],
    }),
    "failing",
  );
  assertEquals(
    mergeReadiness({
      mergeable: "MERGEABLE",
      statusCheckRollup: [{ conclusion: "", status: "IN_PROGRESS" }],
    }),
    "pending",
  );
  assertEquals(
    mergeReadiness({ mergeable: "UNKNOWN", statusCheckRollup: [] }),
    "unknown",
  );
  assertEquals(
    mergeReadiness({ mergeable: "CONFLICTING", statusCheckRollup: [] }),
    "conflicting",
  );
});

Deno.test("touchesWorkflows flags changes under .github/", () => {
  assert(touchesWorkflows([".github/workflows/ci.yml", "README.md"]));
  assert(!touchesWorkflows(["src/.github.ts", "README.md"]));
});

const paths = {
  home: "/Users/me",
  worktree: "/Users/me/.local/share/hermes-claude/worktrees/1.2",
  clone: "/Users/me/.local/share/hermes-claude/repos/alice/x",
  pnpm: "/Users/me/.local/share/hermes-claude/pnpm",
};

Deno.test("claudeSettings reads only the allowlist and fails closed", () => {
  const s = claudeSettings(paths);
  assertEquals(s.sandbox.enabled, true);
  assertEquals(s.sandbox.failIfUnavailable, true);
  assertEquals(s.sandbox.allowUnsandboxedCommands, false);
  assertEquals(s.sandbox.filesystem.denyRead, ["/Users/me/"]);
  assert(s.sandbox.filesystem.allowRead.includes(paths.worktree));
  assert(!s.sandbox.filesystem.allowRead.some((p) => p.includes(".ssh")));
  assertEquals(s.sandbox.filesystem.allowWrite, [paths.worktree, paths.pnpm]);
  assertEquals(s.sandbox.network.strictAllowlist, true);
  assertEquals(s.sandbox.network.allowedDomains, ["registry.npmjs.org"]);
  assert(s.permissions.deny.includes("WebFetch"));
});

Deno.test("claudeArgv keeps restricted mode and the sandbox when resuming", () => {
  const base = {
    settings: claudeSettings(paths),
    prompt: "続き",
  };
  for (
    const argv of [claudeArgv(base), claudeArgv({ ...base, resume: "sid" })]
  ) {
    for (
      const flag of [
        "--restricted",
        "--strict-mcp-config",
        "--settings",
        "--json-schema",
      ]
    ) {
      assert(argv.includes(flag), flag);
    }
    assertEquals(argv[argv.indexOf("--permission-prompts") + 1], "none");
    assertEquals(argv.at(-1), "続き");
  }
  const resumed = claudeArgv({ ...base, resume: "sid" });
  assertEquals(resumed[resumed.indexOf("--resume") + 1], "sid");
  assert(!claudeArgv(base).includes("--resume"));
});

Deno.test("mergeReadiness treats missing and expected checks safely", () => {
  assertEquals(
    mergeReadiness({ mergeable: "MERGEABLE", statusCheckRollup: null }),
    "ready",
  );
  assertEquals(
    mergeReadiness({
      mergeable: "MERGEABLE",
      statusCheckRollup: [{ state: "EXPECTED" }],
    }),
    "pending",
  );
  assertEquals(
    mergeReadiness({
      mergeable: "MERGEABLE",
      statusCheckRollup: [{ state: "ERROR" }],
    }),
    "failing",
  );
});

Deno.test("splitNul keeps paths that git status would quote", () => {
  assertEquals(splitNul(".github/workflows/\u00e9.yml\0README.md\0"), [
    ".github/workflows/\u00e9.yml",
    "README.md",
  ]);
});

Deno.test("decodeSlack restores the three escaped characters", () => {
  assertEquals(decodeSlack("a &lt;b&gt; &amp;amp;"), "a <b> &amp;");
});

Deno.test("decideAction commits only for a pr outcome with changes", () => {
  const base = { hasPr: false, pushed: false };
  assertEquals(
    decideAction({ ...base, outcome: "pr", files: ["a.ts"] }),
    "open-pr",
  );
  assertEquals(
    decideAction({ ...base, hasPr: true, outcome: "pr", files: ["a.ts"] }),
    "update-pr",
  );
  assertEquals(
    decideAction({ ...base, outcome: "pr", files: [".github/x.yml", "a.ts"] }),
    "refuse-workflow",
  );
  assertEquals(
    decideAction({ ...base, outcome: "answer", files: ["a.ts"] }),
    "answer",
  );
  assertEquals(
    decideAction({ ...base, outcome: "issue", files: ["a.ts"] }),
    "issue",
  );
  assertEquals(
    decideAction({ ...base, outcome: "nothing", files: [] }),
    "close",
  );
  assertEquals(decideAction({ ...base, outcome: "pr", files: [] }), "answer");
  assertEquals(
    decideAction({ hasPr: false, pushed: true, outcome: "answer", files: [] }),
    "open-pr",
  );
});

Deno.test("claudeArgv appends the repository vocabulary to the system prompt", () => {
  const base = { settings: claudeSettings(paths), prompt: "直して" };
  const plain = claudeArgv(base);
  const i = plain.indexOf("--append-system-prompt") + 1;
  assertEquals(claudeArgv({ ...base, vocabulary: "" }), plain);
  const withVocab = claudeArgv({ ...base, vocabulary: "- agentower: popup" });
  assertEquals(withVocab[i], `${plain[i]}\n\n- agentower: popup`);
  assertEquals(withVocab.length, plain.length);
});

Deno.test("repoVocabulary returns empty text when the module fails to load", async () => {
  assertEquals(
    await repoVocabulary(
      "dotfiles",
      "/nonexistent",
      () => Promise.reject(new Error("x")),
    ),
    "",
  );
});

Deno.test("repoVocabulary reads only the two vault folders and keeps the target repo's terms", async () => {
  const home = await Deno.makeTempDir({ prefix: "claude-task-vocab-" });
  try {
    const vocab = `${home}/Documents/Main/06_Vocabulary`;
    const proposals =
      `${home}/Documents/Main/98_Maintenance/proposals/Vocabulary`;
    await Deno.mkdir(vocab, { recursive: true });
    await Deno.mkdir(proposals, { recursive: true });
    await Deno.writeTextFile(
      `${vocab}/dotfiles.md`,
      "---\ntype: vocab\nkind: repo\nstatus: approved\n---\nrepo\n",
    );
    await Deno.writeTextFile(
      `${vocab}/agentower.md`,
      '---\ntype: vocab\nkind: term\nstatus: approved\napplies_in: ["[[dotfiles]]"]\n---\nprefix+w のポップアップ。\n',
    );
    await Deno.writeTextFile(
      `${vocab}/gate.md`,
      "---\ntype: vocab\nkind: term\nstatus: approved\n---\n個人のワークフローの語。\n",
    );
    const probe = `${home}/probe.ts`;
    await Deno.writeTextFile(
      probe,
      `import { repoVocabulary } from ${
        JSON.stringify(new URL("./claude-task.ts", import.meta.url).href)
      };\nconsole.log(await repoVocabulary("dotfiles", ${
        JSON.stringify(home)
      }));\n`,
    );
    const out = await new Deno.Command("deno", {
      args: [
        "run",
        "--no-prompt",
        "--allow-env=HOME,USER,TMPDIR",
        `--allow-read=${vocab},${proposals}`,
        probe,
      ],
      env: { HOME: home },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const text = new TextDecoder().decode(out.stdout);
    assertEquals(out.code, 0, new TextDecoder().decode(out.stderr));
    assert(text.includes("- agentower: prefix+w のポップアップ。"), text);
    assert(!text.includes("gate"), text);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
});
