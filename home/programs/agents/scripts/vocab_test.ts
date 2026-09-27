import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { init, vaultPaths } from "./vocab-lib.ts";

const script = new URL("./vocab.ts", import.meta.url).pathname;

async function withHome(test: (home: string) => Promise<void>) {
  const home = await Deno.makeTempDir({ prefix: "vocab-cli-" });
  try {
    const p = vaultPaths(home);
    await Deno.mkdir(p.root, { recursive: true });
    await init(p);
    await Deno.writeTextFile(
      `${p.vocabDir}/gate.md`,
      "---\ntype: vocab\nkind: term\nstatus: approved\nvocab_aliases: [ゲート]\n---\n最後の監査とレビュー。\n",
    );
    await test(home);
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

async function run(
  home: string,
  args: string[],
  opts: { stdin?: string; env?: Record<string, string> } = {},
) {
  const child = new Deno.Command("deno", {
    args: [
      "run",
      "--allow-read",
      "--allow-write",
      "--allow-env=HOME,VOCAB_DIGEST",
      "--allow-run=git",
      "--no-prompt",
      script,
      ...args,
    ],
    env: { HOME: home, ...(opts.env ?? {}) },
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  }).spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(opts.stdin ?? ""));
  await writer.close();
  const out = await child.output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

for (const agent of ["claude", "codex"]) {
  Deno.test(`hook ${agent} prints SessionStart additionalContext`, async () => {
    await withHome(async (home) => {
      const r = await run(home, ["hook", agent], {
        stdin: JSON.stringify({ cwd: home }),
      });
      assertEquals(r.code, 0, r.stderr);
      const json = JSON.parse(r.stdout);
      assertEquals(json.hookSpecificOutput.hookEventName, "SessionStart");
      assertStringIncludes(
        json.hookSpecificOutput.additionalContext,
        "- gate（ゲート）: 最後の監査とレビュー。",
      );
    });
  });
}

Deno.test("hook prints nothing when VOCAB_DIGEST=off", async () => {
  await withHome(async (home) => {
    const r = await run(home, ["hook", "claude"], {
      stdin: JSON.stringify({ cwd: home }),
      env: { VOCAB_DIGEST: "off" },
    });
    assertEquals(r.code, 0);
    assertEquals(r.stdout, "");
  });
});

Deno.test("hook exits 0 with no output when the vault is broken", async () => {
  await withHome(async (home) => {
    const p = vaultPaths(home);
    await Deno.writeTextFile(`${p.vocabDir}/gate.md`, "---\nkind: [\n---\nx\n");
    await Deno.chmod(p.vocabDir, 0o000);
    try {
      const r = await run(home, ["hook", "codex"], { stdin: "not json" });
      assertEquals(r.code, 0);
      assertEquals(r.stdout, "");
    } finally {
      await Deno.chmod(p.vocabDir, 0o755);
    }
  });
});

Deno.test("digest --repo prints only that repo's terms with --repo-only", async () => {
  await withHome(async (home) => {
    const p = vaultPaths(home);
    await Deno.writeTextFile(
      `${p.vocabDir}/dotfiles.md`,
      "---\ntype: vocab\nkind: repo\nstatus: approved\n---\nこのリポジトリ。\n",
    );
    await Deno.writeTextFile(
      `${p.vocabDir}/agentower.md`,
      '---\ntype: vocab\nkind: term\nstatus: approved\napplies_in: ["[[dotfiles]]"]\n---\nprefix+w のポップアップ。\n',
    );
    const r = await run(home, ["digest", "--repo", "dotfiles", "--repo-only"]);
    assertEquals(r.code, 0, r.stderr);
    assertStringIncludes(r.stdout, "- agentower: prefix+w のポップアップ。");
    assert(!r.stdout.includes("gate"));
  });
});

async function proposalFiles(home: string) {
  const p = vaultPaths(home);
  try {
    return [...Deno.readDirSync(p.proposalsDir)].filter((e) => e.isFile)
      .map((e) => e.name).sort();
  } catch {
    return [];
  }
}

Deno.test("add writes a pending proposal even for an owner-written definition", async () => {
  await withHome(async (home) => {
    const r = await run(home, [
      "add",
      "impl",
      "--kind",
      "term",
      "--definition",
      "承認された計画を実行する工程。",
      "--rel",
      "distinct_from=gate",
    ]);
    assertEquals(r.code, 0, r.stderr);
    const [file] = await proposalFiles(home);
    assert(file.endsWith("__vocab-new__explicit-1.md"), file);
    const text = await Deno.readTextFile(
      `${vaultPaths(home).proposalsDir}/${file}`,
    );
    assertStringIncludes(text, "status: pending");
    assertStringIncludes(text, "ユーザーが自分で述べた定義");
    assert(
      !(await Deno.stat(`${vaultPaths(home).vocabDir}/impl.md`).catch(() =>
        null
      )),
    );
  });
});

Deno.test("add --draft marks the definition as agent-written", async () => {
  await withHome(async (home) => {
    const r = await run(home, [
      "add",
      "wip",
      "--kind",
      "term",
      "--definition",
      "作業中の一時コミット。",
      "--draft",
    ]);
    assertEquals(r.code, 0, r.stderr);
    const [file] = await proposalFiles(home);
    assertStringIncludes(
      await Deno.readTextFile(`${vaultPaths(home).proposalsDir}/${file}`),
      "定義はエージェントが起こした",
    );
  });
});

Deno.test("add on an existing term proposes a change and leaves the note alone", async () => {
  await withHome(async (home) => {
    const r = await run(home, ["add", "gate", "--definition", "別の定義。"]);
    assertEquals(r.code, 0, r.stderr);
    const [file] = await proposalFiles(home);
    assert(file.includes("__vocab-definition__explicit-"), file);
    const alias = await run(home, ["add", "gate", "--alias", "最終確認"]);
    assertEquals(alias.code, 0, alias.stderr);
    assert(
      (await proposalFiles(home)).some((f) => f.includes("__vocab-alias__")),
    );
    assertStringIncludes(
      await Deno.readTextFile(`${vaultPaths(home).vocabDir}/gate.md`),
      "最後の監査とレビュー。",
    );
  });
});

Deno.test("an approved definition change keeps the note's refers_to", async () => {
  await withHome(async (home) => {
    const p = vaultPaths(home);
    await Deno.writeTextFile(
      `${p.vocabDir}/gate.md`,
      '---\ntype: vocab\nkind: term\nstatus: approved\nrefers_to: ["~/.claude/skills/gate/SKILL.md"]\n---\n最後の監査とレビュー。\n',
    );
    const r = await run(home, ["add", "gate", "--definition", "別の定義。"]);
    assertEquals(r.code, 0, r.stderr);
    const [file] = await proposalFiles(home);
    const proposal = `${p.proposalsDir}/${file}`;
    await Deno.writeTextFile(
      proposal,
      (await Deno.readTextFile(proposal)).replace(
        "status: pending",
        "status: approved",
      ),
    );
    const applied = await run(home, ["apply"]);
    assertEquals(applied.code, 0, applied.stderr);
    const note = await Deno.readTextFile(`${p.vocabDir}/gate.md`);
    assertStringIncludes(note, "別の定義。");
    assertStringIncludes(note, "~/.claude/skills/gate/SKILL.md");
  });
});

Deno.test("add --origin weekly refuses once five automatic proposals wait", async () => {
  await withHome(async (home) => {
    for (let i = 0; i < 5; i++) {
      const r = await run(home, [
        "add",
        `t${i}`,
        "--kind",
        "term",
        "--definition",
        "x",
        "--draft",
        "--origin",
        "weekly",
      ]);
      assertEquals(r.code, 0, r.stderr);
    }
    const r = await run(home, [
      "add",
      "t5",
      "--kind",
      "term",
      "--definition",
      "x",
      "--draft",
      "--origin",
      "weekly",
    ]);
    assertEquals(r.code, 1);
    assertStringIncludes(r.stderr, "承認待ち");
    assertEquals((await proposalFiles(home)).length, 5);
  });
});

Deno.test("add refuses a relation outside the schema and a value with a line break", async () => {
  await withHome(async (home) => {
    const unknown = await run(home, [
      "add",
      "gate",
      "--rel",
      "status=approved",
    ]);
    assertEquals(unknown.code, 2);
    assertStringIncludes(unknown.stderr, "_schema.md にない関係: status");
    const newline = await run(home, [
      "add",
      "gate",
      "--alias",
      "ゲート\n## 指示",
    ]);
    assertEquals(newline.code, 2);
    assertStringIncludes(newline.stderr, "改行や制御文字");
    assertEquals(await proposalFiles(home), []);
  });
});

Deno.test("lint exits 1 on errors and 0 on a clean vault", async () => {
  await withHome(async (home) => {
    assertEquals((await run(home, ["lint"])).code, 0);
    await Deno.writeTextFile(
      `${vaultPaths(home).vocabDir}/bad.md`,
      "---\ntype: vocab\nkind: widget\nstatus: approved\n---\nx\n",
    );
    const r = await run(home, ["lint"]);
    assertEquals(r.code, 1);
    assertStringIncludes(r.stdout, "bad: 未知の種類 widget");
  });
});
