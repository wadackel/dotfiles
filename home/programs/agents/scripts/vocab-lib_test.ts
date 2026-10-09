import { test } from "bun:test";
import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  apply,
  buildDigest,
  DEFAULT_SCHEMA_YAML,
  effectiveEntries,
  init,
  isSafeText,
  lint,
  loadNotes,
  loadProposals,
  privateNames,
  type VaultPaths,
  vaultPaths,
  writeProposal,
} from "./vocab-lib.ts";

async function vault(test: (p: VaultPaths) => Promise<void>) {
  const home = await mkdtemp(join(tmpdir(), "vocab-lib-"));
  try {
    const p = vaultPaths(home);
    await mkdir(p.root, { recursive: true });
    await init(p);
    await test(p);
  } finally {
    await rm(home, { recursive: true });
  }
}

const note = (p: VaultPaths, name: string, fm: string, body = "定義。") =>
  writeFile(`${p.vocabDir}/${name}.md`, `---\n${fm}\n---\n${body}\n`);

const proposal = (p: VaultPaths, file: string, fm: string) =>
  mkdir(p.proposalsDir, { recursive: true }).then(() =>
    writeFile(
      `${p.proposalsDir}/${file}.md`,
      `---\n${fm}\n---\n## 根拠\n`,
    )
  );

const errors = async (p: VaultPaths) =>
  (await lint(p)).filter((f) => f.level === "error").map((f) => f.message);

test("init writes the schema and the review note once", async () => {
  await vault(async (p) => {
    assertStringIncludes(
      await readFile(`${p.vocabDir}/_schema.md`, "utf8"),
      DEFAULT_SCHEMA_YAML.trim(),
    );
    await writeFile(`${p.vocabDir}/_schema.md`, "edited");
    await init(p);
    assertEquals(await readFile(`${p.vocabDir}/_schema.md`, "utf8"), "edited");
    assertStringIncludes(
      await readFile(`${p.vocabDir}/語彙レビュー.md`, "utf8"),
      "98_Maintenance/proposals/Vocabulary",
    );
  });
});

test("lint accepts a well-formed vocabulary", async () => {
  await vault(async (p) => {
    await note(p, "dotfiles", "type: vocab\nkind: repo\nstatus: approved");
    await note(p, "impl", "type: vocab\nkind: term\nstatus: approved");
    await note(
      p,
      "gate",
      'type: vocab\nkind: term\nstatus: approved\ndistinct_from: ["[[impl]]"]\napplies_in: ["[[dotfiles]]"]',
    );
    assertEquals(await errors(p), []);
  });
});

test("lint reports each kind of violation", async () => {
  await vault(async (p) => {
    await note(p, "dotfiles", "type: vocab\nkind: repo\nstatus: approved");
    await note(p, "impl", "type: vocab\nkind: term\nstatus: approved");
    await note(
      p,
      "undeclared",
      "type: vocab\nkind: term\nstatus: approved\nmeans: [x]",
    );
    await note(p, "badkind", "type: vocab\nkind: widget\nstatus: approved");
    await note(p, "step", "type: vocab\nkind: workflow-step\nstatus: approved");
    await note(
      p,
      "wrongtarget",
      'type: vocab\nkind: term\nstatus: approved\napplies_in: ["[[impl]]"]',
    );
    await note(
      p,
      "selfref",
      'type: vocab\nkind: term\nstatus: approved\ndistinct_from: ["[[selfref]]"]',
    );
    await note(
      p,
      "missingref",
      'type: vocab\nkind: term\nstatus: approved\napplies_in: ["[[dotfiles]]"]\nrefers_to: [no/such/file.md]',
    );
    await note(
      p,
      "dotfiles-path",
      "type: vocab\nkind: repo\nstatus: approved\npath: /nonexistent-repo-root",
    );
    await mkdir(`${p.root}/02_Notes`, { recursive: true });
    await writeFile(`${p.root}/02_Notes/impl.md`, "user note");
    await proposal(
      p,
      "2026-09-28__vocab-new__session-1",
      "type: proposal\nstatus: approve\nterm: x\nkind: vocab-new",
    );
    const found = await errors(p);
    for (
      const expected of [
        "undeclared: 宣言されていない関係 means",
        "badkind: 未知の種類 widget",
        "step: 必須の関係 part_of がない",
        "wrongtarget: applies_in の相手 impl は repo ではない",
        "selfref: distinct_from が自分自身を指している",
        "impl: vault 内の別のファイルと名前が衝突",
        "2026-09-28__vocab-new__session-1: 未知の status approve",
      ]
    ) {
      assert(
        found.includes(expected),
        `missing "${expected}" in ${JSON.stringify(found)}`,
      );
    }
  });
});

test("lint reports a missing refers_to target under the repo path", async () => {
  await vault(async (p) => {
    const repo = await mkdtemp(join(tmpdir(), "vocab-repo-"));
    try {
      await note(
        p,
        "dotfiles",
        `type: vocab\nkind: repo\nstatus: approved\npath: ${repo}`,
      );
      await note(
        p,
        "gate",
        'type: vocab\nkind: term\nstatus: approved\napplies_in: ["[[dotfiles]]"]\nrefers_to: [skills/gate/SKILL.md]',
      );
      assert(
        (await errors(p)).includes(
          "gate: refers_to の参照切れ skills/gate/SKILL.md",
        ),
      );
      await mkdir(`${repo}/skills/gate`, { recursive: true });
      await writeFile(`${repo}/skills/gate/SKILL.md`, "x");
      assertEquals(await errors(p), []);
    } finally {
      await rm(repo, { recursive: true });
    }
  });
});

test("lint reports a broken schema and conflicting approved proposals", async () => {
  await vault(async (p) => {
    await writeFile(
      `${p.vocabDir}/_schema.md`,
      "```yaml\nkinds: [\n```\n",
    );
    await proposal(
      p,
      "2026-09-28__vocab-definition__session-1",
      "type: proposal\nstatus: approved\nkind: vocab-definition\nterm: gate\ndefinition: a\ncreated: 2026-09-28",
    );
    await proposal(
      p,
      "2026-09-28__vocab-definition__session-2",
      "type: proposal\nstatus: approved\nkind: vocab-definition\nterm: gate\ndefinition: b\ncreated: 2026-09-28",
    );
    const all = await lint(p);
    assert(
      all.some((f) =>
        f.level === "error" && f.message.startsWith("_schema.md: 解析できない")
      ),
    );
    assert(
      all.some((f) => f.message === "gate: 承認済みの提案が 2 件衝突している"),
    );
  });
});

test("digest merges approved notes and approved proposals, not pending ones", async () => {
  await vault(async (p) => {
    await note(p, "dotfiles", "type: vocab\nkind: repo\nstatus: approved");
    await note(
      p,
      "impl",
      "type: vocab\nkind: term\nstatus: approved",
      "計画を実行する工程。",
    );
    await note(
      p,
      "gate",
      'type: vocab\nkind: term\nstatus: approved\nvocab_aliases: [ゲート]\ndistinct_from: ["[[impl]]"]\napplies_in: ["[[dotfiles]]"]\nrefers_to: [home/programs/claude/skills/gate/SKILL.md]',
      "最後の監査とレビュー。",
    );
    await proposal(
      p,
      "2026-09-28__vocab-new__session-1",
      "type: proposal\nstatus: approved\nkind: vocab-new\nterm: wip\nvocab_kind: term\ndefinition: 作業中の一時コミット。\ncreated: 2026-09-28",
    );
    await proposal(
      p,
      "2026-09-28__vocab-new__session-2",
      "type: proposal\nstatus: pending\nkind: vocab-new\nterm: secretword\nvocab_kind: term\ndefinition: まだ承認されていない。\ncreated: 2026-09-28",
    );
    const entries = effectiveEntries(
      await loadNotes(p),
      await loadProposals(p),
    );
    const text = buildDigest(entries, {
      repo: "dotfiles",
      includeGlobal: true,
    });
    const lines = text.split("\n").filter((l) => l.startsWith("- "));
    assertEquals(
      lines[0].startsWith("- gate（ゲート）: 最後の監査とレビュー。"),
      true,
      text,
    );
    assertStringIncludes(lines[0], "≠ impl");
    assertStringIncludes(
      lines[0],
      "→ home/programs/claude/skills/gate/SKILL.md",
    );
    assert(text.includes("- impl: 計画を実行する工程。 ≠ gate"), text);
    assert(text.includes("- wip: 作業中の一時コミット。"));
    assert(!text.includes("secretword"));
    assert(!text.includes("- dotfiles"));
  });
});

test("digest puts repo terms first, skips other repos, and truncates by characters", async () => {
  await vault(async (p) => {
    await note(p, "dotfiles", "type: vocab\nkind: repo\nstatus: approved");
    await note(p, "other", "type: vocab\nkind: repo\nstatus: approved");
    await note(
      p,
      "aglobal",
      "type: vocab\nkind: term\nstatus: approved",
      "全体の語。",
    );
    await note(
      p,
      "zlocal",
      'type: vocab\nkind: term\nstatus: approved\napplies_in: ["[[dotfiles]]"]',
      "リポジトリの語。",
    );
    await note(
      p,
      "elsewhere",
      'type: vocab\nkind: term\nstatus: approved\napplies_in: ["[[other]]"]',
      "別の語。",
    );
    const entries = effectiveEntries(await loadNotes(p), []);
    const text = buildDigest(entries, {
      repo: "dotfiles",
      includeGlobal: true,
    });
    assert(text.indexOf("zlocal") < text.indexOf("aglobal"), text);
    assert(!text.includes("elsewhere"));
    const repoOnly = buildDigest(entries, {
      repo: "dotfiles",
      includeGlobal: false,
    });
    assert(!repoOnly.includes("aglobal"));
    for (let i = 0; i < 80; i++) {
      await note(
        p,
        `term${String(i).padStart(2, "0")}`,
        "type: vocab\nkind: term\nstatus: approved",
        "あ".repeat(60),
      );
    }
    const long = buildDigest(effectiveEntries(await loadNotes(p), []), {
      repo: "dotfiles",
      includeGlobal: true,
    });
    assert(long.length <= 4000, `${long.length}`);
    assert(/ほか \d+ 語は上限のため省略/.test(long), long.slice(-200));
    assertEquals(
      buildDigest(new Map(), { repo: "dotfiles", includeGlobal: true }),
      "",
    );
  });
});

test("digest works when the schema cannot be parsed", async () => {
  await vault(async (p) => {
    await writeFile(
      `${p.vocabDir}/_schema.md`,
      "```yaml\nkinds: [\n```\n",
    );
    await note(
      p,
      "gate",
      "type: vocab\nkind: term\nstatus: approved",
      "監査。",
    );
    const text = buildDigest(effectiveEntries(await loadNotes(p), []), {
      repo: "x",
      includeGlobal: true,
    });
    assertStringIncludes(text, "- gate: 監査。");
  });
});

test("apply creates notes, links only existing targets, and archives proposals", async () => {
  await vault(async (p) => {
    await note(p, "impl", "type: vocab\nkind: term\nstatus: approved");
    await proposal(
      p,
      "2026-09-28__vocab-new__seed-1",
      "type: proposal\norigin: seed\nstatus: approved\nkind: vocab-new\nterm: gate\nvocab_kind: term\ndefinition: 監査。\nvocab_aliases: [ゲート]\nrelations:\n  distinct_from: [impl, notyet]\ncreated: 2026-09-28",
    );
    await proposal(
      p,
      "2026-09-28__vocab-new__seed-2",
      "type: proposal\norigin: seed\nstatus: rejected\nkind: vocab-new\nterm: nope\nvocab_kind: term\ndefinition: x\ncreated: 2026-09-28",
    );
    await proposal(
      p,
      "2026-09-28__vocab-new__seed-3",
      "type: proposal\norigin: seed\nstatus: pending\nkind: vocab-new\nterm: later\nvocab_kind: term\ndefinition: x\ncreated: 2026-09-28",
    );
    await apply(p, "2026-09-29");
    const gate = await readFile(`${p.vocabDir}/gate.md`, "utf8");
    assertStringIncludes(gate, "[[impl]]");
    assertStringIncludes(gate, "notyet");
    assert(!gate.includes("[[notyet]]"));
    assertStringIncludes(gate, "approved: 2026-09-29");
    assertStringIncludes(
      gate,
      "approved_from: '[[2026-09-28__vocab-new__seed-1]]'",
    );
    assertStringIncludes(gate, "監査。");
    const applied = await readFile(
      `${p.proposalsDir}/applied/2026-09-28__vocab-new__seed-1.md`,
      "utf8",
    );
    assertStringIncludes(applied, "status: applied");
    assertStringIncludes(applied, "applied: 2026-09-29");
    await stat(
      `${p.proposalsDir}/rejected/2026-09-28__vocab-new__seed-2.md`,
    );
    await stat(`${p.proposalsDir}/2026-09-28__vocab-new__seed-3.md`);
    assert(!(await exists(`${p.vocabDir}/nope.md`)));
  });
});

test("apply never overwrites an existing note with a new-term proposal", async () => {
  await vault(async (p) => {
    await note(
      p,
      "gate",
      "type: vocab\nkind: term\nstatus: approved",
      "元の定義。",
    );
    await proposal(
      p,
      "2026-09-28__vocab-new__session-1",
      "type: proposal\nstatus: approved\nkind: vocab-new\nterm: gate\nvocab_kind: term\ndefinition: 上書き。\ncreated: 2026-09-28",
    );
    const report = await apply(p, "2026-09-29");
    assertStringIncludes(
      await readFile(`${p.vocabDir}/gate.md`, "utf8"),
      "元の定義。",
    );
    assert(report.some((l) => l.includes("既にある")), report.join("\n"));
    await stat(`${p.proposalsDir}/2026-09-28__vocab-new__session-1.md`);
  });
});

test("apply merges relation, alias, and definition proposals into existing notes", async () => {
  await vault(async (p) => {
    await note(p, "impl", "type: vocab\nkind: term\nstatus: approved");
    await note(
      p,
      "gate",
      "type: vocab\nkind: term\nstatus: approved",
      "古い。",
    );
    await proposal(
      p,
      "2026-09-28__vocab-relation__session-1",
      "type: proposal\nstatus: approved\nkind: vocab-relation\nterm: gate\nrelations:\n  distinct_from: [impl]\ncreated: 2026-09-28",
    );
    await proposal(
      p,
      "2026-09-28__vocab-alias__session-2",
      "type: proposal\nstatus: approved\nkind: vocab-alias\nterm: gate\nvocab_aliases: [ゲート]\ncreated: 2026-09-28",
    );
    await proposal(
      p,
      "2026-09-28__vocab-definition__session-3",
      "type: proposal\nstatus: approved\nkind: vocab-definition\nterm: gate\ndefinition: 新しい。\ncreated: 2026-09-28",
    );
    await apply(p, "2026-09-29");
    const gate = await readFile(`${p.vocabDir}/gate.md`, "utf8");
    assertStringIncludes(gate, "[[impl]]");
    assertStringIncludes(gate, "ゲート");
    assertStringIncludes(gate, "新しい。");
    assert(!gate.includes("古い。"));
  });
});

test("private names are read without contents and filter unsafe text", async () => {
  await vault(async (p) => {
    await mkdir(`${p.root}/05_Private/sub`, { recursive: true });
    await writeFile(
      `${p.root}/05_Private/sub/マイナンバー控え.md`,
      "secret",
    );
    await writeFile(`${p.root}/05_Private/abc.md`, "short");
    const names = await privateNames(p);
    assert(names.includes("マイナンバー控え"));
    assert(!isSafeText("マイナンバー控え を開いて", names));
    assert(
      isSafeText("abc を見て", names),
      "names shorter than 4 characters are ignored",
    );
    assert(!isSafeText("[[リンク]] を見て", names));
    assert(!isSafeText("https://example.com を見て", names));
    assert(!isSafeText("token sk-ant-abcdefghijklmnop", names));
    assert(isSafeText("gate して", names));
  });
});

test("writeProposal numbers per date and origin and never overwrites", async () => {
  await vault(async (p) => {
    const base = {
      origin: "session",
      kind: "vocab-new",
      term: "gate",
      vocab_kind: "term",
      definition: "監査。",
    } as const;
    const a = await writeProposal(
      p,
      base,
      ["セッション `abc`: `gate して`"],
      "2026-09-28",
    );
    const b = await writeProposal(
      p,
      { ...base, term: "impl" },
      [],
      "2026-09-28",
    );
    assertEquals(a?.split("/").pop(), "2026-09-28__vocab-new__session-1.md");
    assertEquals(b?.split("/").pop(), "2026-09-28__vocab-new__session-2.md");
    const body = await readFile(a!, "utf8");
    assertStringIncludes(body, "status: pending");
    assertStringIncludes(body, "created: 2026-09-28");
    assertStringIncludes(body, "- セッション `abc`: `gate して`");
    assert(!body.includes("[["));
  });
});

async function exists(path: string) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

test("a repo proposal carries its path into the note", async () => {
  await vault(async (p) => {
    await writeProposal(
      p,
      {
        origin: "seed",
        kind: "vocab-new",
        term: "dotfiles",
        vocab_kind: "repo",
        definition: "設定。",
        path: "~/dotfiles",
        status: "approved",
      },
      [],
      "2026-09-28",
    );
    await apply(p, "2026-09-29");
    assertStringIncludes(
      await readFile(`${p.vocabDir}/dotfiles.md`, "utf8"),
      "path: ~/dotfiles",
    );
  });
});

test("digest fills in the other side of any symmetric relation it is given", async () => {
  await vault(async (p) => {
    await note(
      p,
      "a",
      'type: vocab\nkind: term\nstatus: approved\npairs_with: ["[[b]]"]',
      "A。",
    );
    await note(p, "b", "type: vocab\nkind: term\nstatus: approved", "B。");
    const entries = effectiveEntries(await loadNotes(p), []);
    const text = buildDigest(entries, {
      repo: null,
      includeGlobal: true,
      symmetric: ["pairs_with"],
    });
    assertStringIncludes(text, "- b: B。 pairs_with: a。");
  });
});

test("the newest of two approved new-term proposals wins, and apply keeps the older one", async () => {
  await vault(async (p) => {
    await proposal(
      p,
      "2026-09-27__vocab-new__session-1",
      "type: proposal\nstatus: approved\nkind: vocab-new\nterm: wip\nvocab_kind: term\ndefinition: 古い。\nvocab_aliases: [古い別名]\ncreated: 2026-09-27",
    );
    await proposal(
      p,
      "2026-09-28__vocab-new__session-1",
      "type: proposal\nstatus: approved\nkind: vocab-new\nterm: wip\nvocab_kind: term\ndefinition: 新しい。\ncreated: 2026-09-28",
    );
    const text = buildDigest(effectiveEntries([], await loadProposals(p)), {
      repo: null,
      includeGlobal: true,
    });
    assertStringIncludes(text, "- wip: 新しい。");
    const report = await apply(p, "2026-09-29");
    assertStringIncludes(
      await readFile(`${p.vocabDir}/wip.md`, "utf8"),
      "新しい。",
    );
    assert(
      report.some((l) =>
        l.includes("2026-09-27__vocab-new__session-1") &&
        l.includes("新しい提案")
      ),
      report.join("\n"),
    );
    await stat(`${p.proposalsDir}/2026-09-27__vocab-new__session-1.md`);
    const after = buildDigest(
      effectiveEntries(await loadNotes(p), await loadProposals(p)),
      { repo: null, includeGlobal: true },
    );
    assertStringIncludes(after, "- wip: 新しい。");
    assert(!after.includes("古い別名"), after);
    assert(
      (await lint(p)).some((f) =>
        f.level === "warn" &&
        f.message.includes("2026-09-27__vocab-new__session-1") &&
        f.message.includes("既にあり")
      ),
    );
  });
});
