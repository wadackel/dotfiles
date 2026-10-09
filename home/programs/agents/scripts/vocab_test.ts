import { test } from "bun:test";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { readdirSync } from "node:fs";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run as runCommand } from "../lib/proc.ts";
import { init, vaultPaths } from "./vocab-lib.ts";

const script = join(import.meta.dirname, "vocab.ts");
// The script runs with a throwaway HOME, where Bun would otherwise leave its
// transpiler cache.
const TRANSPILER_CACHE = `${process.env.HOME}/Library/Caches/bun/@t@`;

async function withHome(test: (home: string) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "vocab-cli-"));
  try {
    const p = vaultPaths(home);
    await mkdir(p.root, { recursive: true });
    await init(p);
    await writeFile(
      `${p.vocabDir}/gate.md`,
      "---\ntype: vocab\nkind: term\nstatus: approved\nvocab_aliases: [ゲート]\n---\n最後の監査とレビュー。\n",
    );
    await test(home);
  } finally {
    await rm(home, { recursive: true });
  }
}

async function run(
  home: string,
  args: string[],
  opts: { stdin?: string; env?: Record<string, string> } = {},
) {
  const out = await runCommand(script, args, {
    env: {
      HOME: home,
      BUN_RUNTIME_TRANSPILER_CACHE_PATH: TRANSPILER_CACHE,
      ...(opts.env ?? {}),
    },
    stdin: opts.stdin ?? "",
  });
  return { code: out.code, stdout: out.stdout, stderr: out.stderr };
}

for (const agent of ["claude", "codex"]) {
  test(`hook ${agent} prints SessionStart additionalContext`, async () => {
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

test("hook prints nothing when VOCAB_DIGEST=off", async () => {
  await withHome(async (home) => {
    const r = await run(home, ["hook", "claude"], {
      stdin: JSON.stringify({ cwd: home }),
      env: { VOCAB_DIGEST: "off" },
    });
    assertEquals(r.code, 0);
    assertEquals(r.stdout, "");
  });
});

test("hook exits 0 with no output when the vault is broken", async () => {
  await withHome(async (home) => {
    const p = vaultPaths(home);
    await writeFile(`${p.vocabDir}/gate.md`, "---\nkind: [\n---\nx\n");
    await chmod(p.vocabDir, 0o000);
    try {
      const r = await run(home, ["hook", "codex"], { stdin: "not json" });
      assertEquals(r.code, 0);
      assertEquals(r.stdout, "");
    } finally {
      await chmod(p.vocabDir, 0o755);
    }
  });
});

test("digest --repo prints only that repo's terms with --repo-only", async () => {
  await withHome(async (home) => {
    const p = vaultPaths(home);
    await writeFile(
      `${p.vocabDir}/dotfiles.md`,
      "---\ntype: vocab\nkind: repo\nstatus: approved\n---\nこのリポジトリ。\n",
    );
    await writeFile(
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
    return readdirSync(p.proposalsDir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name).sort();
  } catch {
    return [];
  }
}

test("add writes a pending proposal even for an owner-written definition", async () => {
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
    const text = await readFile(
      `${vaultPaths(home).proposalsDir}/${file}`,
      "utf8",
    );
    assertStringIncludes(text, "status: pending");
    assertStringIncludes(text, "ユーザーが自分で述べた定義");
    assert(
      !(await stat(`${vaultPaths(home).vocabDir}/impl.md`).catch(() => null)),
    );
  });
});

test("add --draft marks the definition as agent-written", async () => {
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
      await readFile(`${vaultPaths(home).proposalsDir}/${file}`, "utf8"),
      "定義はエージェントが起こした",
    );
  });
});

test("add on an existing term proposes a change and leaves the note alone", async () => {
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
      await readFile(`${vaultPaths(home).vocabDir}/gate.md`, "utf8"),
      "最後の監査とレビュー。",
    );
  });
});

test("an approved definition change keeps the note's refers_to", async () => {
  await withHome(async (home) => {
    const p = vaultPaths(home);
    await writeFile(
      `${p.vocabDir}/gate.md`,
      '---\ntype: vocab\nkind: term\nstatus: approved\nrefers_to: ["~/.claude/skills/gate/SKILL.md"]\n---\n最後の監査とレビュー。\n',
    );
    const r = await run(home, ["add", "gate", "--definition", "別の定義。"]);
    assertEquals(r.code, 0, r.stderr);
    const [file] = await proposalFiles(home);
    const proposal = `${p.proposalsDir}/${file}`;
    await writeFile(
      proposal,
      (await readFile(proposal, "utf8")).replace(
        "status: pending",
        "status: approved",
      ),
    );
    const applied = await run(home, ["apply"]);
    assertEquals(applied.code, 0, applied.stderr);
    const note = await readFile(`${p.vocabDir}/gate.md`, "utf8");
    assertStringIncludes(note, "別の定義。");
    assertStringIncludes(note, "~/.claude/skills/gate/SKILL.md");
  });
});

test("add --origin weekly refuses once five automatic proposals wait", async () => {
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

test("add refuses a relation outside the schema and a value with a line break", async () => {
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

test("lint exits 1 on errors and 0 on a clean vault", async () => {
  await withHome(async (home) => {
    assertEquals((await run(home, ["lint"])).code, 0);
    await writeFile(
      `${vaultPaths(home).vocabDir}/bad.md`,
      "---\ntype: vocab\nkind: widget\nstatus: approved\n---\nx\n",
    );
    const r = await run(home, ["lint"]);
    assertEquals(r.code, 1);
    assertStringIncludes(r.stdout, "bad: 未知の種類 widget");
  });
});
