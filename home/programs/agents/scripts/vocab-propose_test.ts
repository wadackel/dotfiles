import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";
import { init, loadProposals, vaultPaths, writeProposal } from "./vocab-lib.ts";
import {
  AUTO_PENDING_LIMIT,
  extractCandidates,
  proposeFromSession,
  type SessionInput,
  shortUtterances,
  type Turn,
  weeklyProposals,
} from "./vocab-propose.ts";

interface Fixture {
  home: string;
  tmp: string;
  base: (turns: Turn[]) => SessionInput;
  excerpts: () => Promise<Record<string, string>[]>;
  candidates: () => Promise<Record<string, string>[]>;
}

async function jsonl(path: string) {
  try {
    return (await Deno.readTextFile(path)).trim().split("\n").filter(Boolean)
      .map((l) => JSON.parse(l));
  } catch {
    return [];
  }
}

async function fixture(test: (f: Fixture) => Promise<void>) {
  const home = await Deno.makeTempDir({ prefix: "vocab-propose-" });
  const tmp = await Deno.makeTempDir({ prefix: "vocab-propose-tmp-" });
  try {
    const p = vaultPaths(home);
    await Deno.mkdir(p.root, { recursive: true });
    await init(p);
    await Deno.writeTextFile(
      `${p.vocabDir}/gate.md`,
      "---\ntype: vocab\nkind: term\nstatus: approved\n---\n最後の監査。\n",
    );
    await test({
      home,
      tmp,
      base: (turns) => ({
        agent: "claude",
        sessionId: "6ec2303f-aaaa",
        cwd: `${home}/dotfiles`,
        repo: "dotfiles",
        turns,
        home,
        tmpdir: tmp,
        now: new Date("2026-09-27T10:00:00Z"),
      }),
      excerpts: () => jsonl(`${home}/.local/state/vocab/excerpts.jsonl`),
      candidates: () => jsonl(`${home}/.local/state/vocab/candidates.jsonl`),
    });
  } finally {
    await Deno.remove(home, { recursive: true });
    await Deno.remove(tmp, { recursive: true });
  }
}

const u = (text: string): Turn => ({ role: "user", text });
const a = (text: string): Turn => ({ role: "assistant", text });

Deno.test("a correction is recorded with the assistant turn it corrects", async () => {
  await fixture(async (f) => {
    const r = await proposeFromSession(f.base([
      u("wip を戻して"),
      a("直前のコミットを revert しました。"),
      u("ちがう、wip は作業途中の一時コミットのことで、reset で消してほしい"),
    ]));
    assertEquals(r.recorded, 2, JSON.stringify(r));
    const [e] = await f.excerpts();
    assertEquals(e.signal, "correction");
    assertEquals(e.session, "6ec2303f-aaaa");
    assertEquals(e.repo, "dotfiles");
    assertEquals(e.assistant, "直前のコミットを revert しました。");
    assertStringIncludes(e.user, "作業途中の一時コミット");
    assertEquals((await f.candidates()).map((c) => c.term), ["wip"]);
    assertEquals(
      await loadProposals(vaultPaths(f.home)),
      [],
      "nothing reaches the vault",
    );
  });
});

Deno.test("an answer to a clarifying question is recorded", async () => {
  await fixture(async (f) => {
    await proposeFromSession(f.base([
      u("タワーを開いて"),
      a("タワーとはどのツールのことですか？"),
      u("Agentower のこと。prefix+w のポップアップ"),
    ]));
    assertEquals((await f.excerpts()).map((e) => e.signal), ["clarification"]);
  });
});

Deno.test("an ordinary session records nothing", async () => {
  await fixture(async (f) => {
    const r = await proposeFromSession(
      f.base([u("README を直して"), a("直しました。")]),
    );
    assertEquals(r.recorded, 0);
    assertEquals(await f.excerpts(), []);
    assertEquals(await f.candidates(), []);
  });
});

Deno.test("the same utterances are processed only once per session", async () => {
  await fixture(async (f) => {
    const turns = [u("x を戻して"), a("戻しました。"), u("ちがう、reset で")];
    await proposeFromSession(f.base(turns));
    await proposeFromSession(f.base(turns));
    assertEquals((await f.excerpts()).length, 1);
    await proposeFromSession(
      f.base([...turns, a("reset しました。"), u("ちがう、soft で")]),
    );
    assertEquals((await f.excerpts()).map((e) => e.user), [
      "ちがう、reset で",
      "ちがう、soft で",
    ]);
  });
});

Deno.test("excerpts with private names, links, or URLs are dropped", async () => {
  await fixture(async (f) => {
    const p = vaultPaths(f.home);
    await Deno.mkdir(p.privateDir, { recursive: true });
    await Deno.writeTextFile(`${p.privateDir}/家の暗証番号メモ.md`, "x");
    for (
      const [i, text] of [
        "ちがう、家の暗証番号メモ のこと",
        "ちがう、[[リンク]] のこと",
        "ちがう、https://example.com のこと",
      ].entries()
    ) {
      await proposeFromSession({
        ...f.base([u("開いて"), a("どれ？"), u(text)]),
        sessionId: `s${i}`,
      });
    }
    assertEquals(await f.excerpts(), []);
  });
});

Deno.test("sessions inside the vault are not mined", async () => {
  await fixture(async (f) => {
    const r = await proposeFromSession({
      ...f.base([u("x"), a("y？"), u("ちがう、z のこと")]),
      cwd: `${vaultPaths(f.home).root}/02_Notes`,
    });
    assertStringIncludes(r.note, "vault");
    assertEquals(await f.excerpts(), []);
  });
});

Deno.test("registered terms are not candidates", async () => {
  await fixture(async (f) => {
    await proposeFromSession(
      f.base([u("gate して"), a("しました。"), u("gate をもう一度")]),
    );
    assertEquals(await f.candidates(), []);
    assertEquals(
      extractCandidates(["hermes を hermes して the the"], new Set()),
      ["hermes"],
    );
  });
});

Deno.test("weekly writes deterministic proposals and packs the week's material", async () => {
  await fixture(async (f) => {
    const p = vaultPaths(f.home);
    const repo = `${f.home}/repo`;
    await Deno.mkdir(repo, { recursive: true });
    await Deno.writeTextFile(`${repo}/kept.md`, "x");
    await Deno.writeTextFile(
      `${p.vocabDir}/dotfiles.md`,
      `---\ntype: vocab\nkind: repo\nstatus: approved\npath: ${repo}\n---\nrepo\n`,
    );
    await Deno.writeTextFile(
      `${p.vocabDir}/tower.md`,
      '---\ntype: vocab\nkind: term\nstatus: approved\napplies_in: ["[[dotfiles]]"]\nrefers_to: [kept.md, gone.md]\n---\nポップアップ。\n',
    );
    const state = `${f.home}/.local/state/vocab`;
    await Deno.mkdir(state, { recursive: true });
    const at = "2026-09-26T10:00:00Z";
    const old = "2026-08-01T00:00:00Z";
    await Deno.writeTextFile(
      `${state}/candidates.jsonl`,
      [
        {
          term: "hermes",
          session: "s1",
          agent: "claude",
          repo: "dotfiles",
          at,
        },
        { term: "hermes", session: "s2", agent: "codex", repo: "dotfiles", at },
        { term: "once", session: "s1", agent: "claude", repo: "dotfiles", at },
        { term: "stale", session: "s1", agent: "claude", repo: "x", at: old },
        { term: "stale", session: "s2", agent: "claude", repo: "x", at: old },
      ].map((l) => JSON.stringify(l)).join("\n") + "\n",
    );
    await Deno.writeTextFile(
      `${state}/excerpts.jsonl`,
      JSON.stringify({
        signal: "correction",
        session: "s1",
        agent: "claude",
        repo: "dotfiles",
        at,
        assistant: "revert しました。",
        user: "ちがう、wip は一時コミット",
      }) + "\n",
    );
    const skills = `${f.home}/.claude/skills`;
    await Deno.mkdir(`${skills}/weekly-review`, { recursive: true });
    await Deno.writeTextFile(
      `${skills}/weekly-review/SKILL.md`,
      "---\nname: weekly-review\ndescription: >-\n  Generates weekly review content in Obsidian. Use when asked.\ndisable-model-invocation: true\n---\n",
    );
    await Deno.mkdir(`${skills}/auto-skill`, { recursive: true });
    await Deno.writeTextFile(
      `${skills}/auto-skill/SKILL.md`,
      "---\nname: auto-skill\ndescription: Model invoked.\n---\n",
    );
    const plans = `${f.home}/.claude/plans`;
    await Deno.mkdir(plans, { recursive: true });
    await Deno.writeTextFile(
      `${plans}/20260925T1000-sample.md`,
      "# Plan\n\n### Alternatives Considered\n\n- キャッシュを挟む案は遅延が 200ms を超えたときだけ足す\n\n## NOT Building\n",
    );

    const { report, packet } = await weeklyProposals({
      home: f.home,
      now: new Date("2026-09-27T12:00:00Z"),
      today: "2026-09-27",
    });
    const byTerm = new Map((await loadProposals(p)).map((x) => [x.term, x]));
    assertEquals(byTerm.get("tower")?.kind, "vocab-definition");
    assertEquals(byTerm.get("tower")?.refersTo, ["kept.md"]);
    assertEquals(
      byTerm.get("weekly-review")?.definition,
      "Generates weekly review content in Obsidian.",
    );
    assert(!byTerm.has("auto-skill") && !byTerm.has("hermes"));
    assertStringIncludes(report[0], "2 件");
    assertStringIncludes(packet, "あと 3 件");
    assertStringIncludes(packet, "- ユーザー: ちがう、wip は一時コミット");
    assertStringIncludes(
      packet,
      "- hermes: 2 セッション（claude, codex / dotfiles）",
    );
    assert(!packet.includes("once") && !packet.includes("stale"), packet);
    assertStringIncludes(packet, "### 20260925T1000-sample.md");
    assertStringIncludes(packet, "遅延が 200ms を超えたときだけ足す");
    assert(
      !(await Deno.readTextFile(`${state}/candidates.jsonl`)).includes("stale"),
      "records older than 30 days are pruned",
    );
  });
});

Deno.test("weekly proposals stop at the pending cap", async () => {
  await fixture(async (f) => {
    const p = vaultPaths(f.home);
    for (let i = 0; i < AUTO_PENDING_LIMIT; i++) {
      await writeProposal(
        p,
        { origin: "session", kind: "vocab-new", term: `t${i}` },
        [],
        "2026-09-27",
      );
    }
    const skills = `${f.home}/.claude/skills/plan`;
    await Deno.mkdir(skills, { recursive: true });
    await Deno.writeTextFile(
      `${skills}/SKILL.md`,
      "---\nname: plan\ndescription: Plans.\ndisable-model-invocation: true\n---\n",
    );
    const { report, packet } = await weeklyProposals({
      home: f.home,
      now: new Date(),
      today: "2026-09-27",
    });
    assertEquals((await loadProposals(p)).length, AUTO_PENDING_LIMIT);
    assert(report.some((l) => l.includes("承認待ち")), report.join("\n"));
    assertStringIncludes(packet, "あと 0 件");
  });
});

Deno.test("short utterances keep the next skill and skip long or command lines", async () => {
  await fixture(async (f) => {
    const dir = `${f.home}/.claude/projects/-repo`;
    await Deno.mkdir(dir, { recursive: true });
    const ts = new Date().toISOString();
    const user = (text: string) =>
      JSON.stringify({
        type: "user",
        cwd: `${f.home}/repo`,
        sessionId: "abcd1234-x",
        timestamp: ts,
        message: { role: "user", content: text },
      });
    await Deno.writeTextFile(
      `${dir}/s.jsonl`,
      [
        user("hermes 再起動して"),
        JSON.stringify({
          type: "assistant",
          message: {
            role: "assistant",
            content: [{
              type: "tool_use",
              name: "Skill",
              input: { skill: "hermes-ops" },
            }],
          },
        }),
        user("これは二十字をはるかに超える長い指示なので短い発話には入らない"),
        user("<command-name>/plan</command-name>"),
      ].join("\n") + "\n",
    );
    const us = await shortUtterances(f.home, Date.now() - 60_000, 20);
    assertEquals(us.map((x) => x.text), ["hermes 再起動して"]);
    assertEquals(us[0].skill, "hermes-ops");
  });
});

Deno.test("sessions sharing a time-based id prefix keep separate state", async () => {
  await fixture(async (f) => {
    const turns = [u("x を戻して"), a("戻しました。"), u("ちがう、reset で")];
    await proposeFromSession({ ...f.base(turns), sessionId: "01a0e1ba-0001" });
    await proposeFromSession({ ...f.base(turns), sessionId: "01a0e1ba-0002" });
    assertEquals(
      (await f.excerpts()).map((e) => e.session),
      ["01a0e1ba-0001", "01a0e1ba-0002"],
    );
  });
});

Deno.test("weekly does not repeat a rejected skill or a pending reference fix", async () => {
  await fixture(async (f) => {
    const p = vaultPaths(f.home);
    const repo = `${f.home}/repo`;
    await Deno.mkdir(repo, { recursive: true });
    await Deno.writeTextFile(
      `${p.vocabDir}/dotfiles.md`,
      `---\ntype: vocab\nkind: repo\nstatus: approved\npath: ${repo}\n---\nrepo\n`,
    );
    await Deno.writeTextFile(
      `${p.vocabDir}/tower.md`,
      '---\ntype: vocab\nkind: term\nstatus: approved\napplies_in: ["[[dotfiles]]"]\nrefers_to: [gone.md]\n---\nポップアップ。\n',
    );
    const skills = `${f.home}/.claude/skills/plan`;
    await Deno.mkdir(skills, { recursive: true });
    await Deno.writeTextFile(
      `${skills}/SKILL.md`,
      "---\nname: plan\ndescription: Plans.\ndisable-model-invocation: true\n---\n",
    );
    const run = () =>
      weeklyProposals({ home: f.home, now: new Date(), today: "2026-09-27" });
    await run();
    await run();
    const terms = (await loadProposals(p)).map((x) => x.term).sort();
    assertEquals(terms, ["plan", "tower"]);
    const planFile = (await loadProposals(p)).find((x) => x.term === "plan")!;
    await Deno.writeTextFile(
      planFile.path,
      (await Deno.readTextFile(planFile.path)).replace(
        "status: pending",
        "status: rejected",
      ),
    );
    const { apply } = await import("./vocab-lib.ts");
    await apply(p, "2026-09-28");
    await run();
    assertEquals(
      (await loadProposals(p)).map((x) => x.term).sort(),
      ["tower"],
    );
  });
});

Deno.test("an Alternatives Considered section at the end of a plan is still read", async () => {
  await fixture(async (f) => {
    const plans = `${f.home}/.claude/plans`;
    await Deno.mkdir(plans, { recursive: true });
    await Deno.writeTextFile(
      `${plans}/20260926T0900-last.md`,
      "# Plan\n\n### Alternatives Considered\n\n- 末尾の節にある案\n",
    );
    const { packet } = await weeklyProposals({
      home: f.home,
      now: new Date(),
      today: "2026-09-27",
    });
    assertStringIncludes(packet, "末尾の節にある案");
  });
});
