import { assert, assertEquals } from "jsr:@std/assert@1";
import {
  digestTerms,
  injected,
  parseProbes,
  type Probe,
  renderProbes,
  score,
  summarize,
} from "./vocab-probe.ts";

const probe: Probe = {
  id: "p01",
  cwd: "~/dotfiles",
  utterance: "gate して",
  expected: {
    skill: "gate",
    paths: ["home/programs/claude/skills/gate/SKILL.md"],
    needs_clarification: false,
  },
};

Deno.test("probes round-trip through the markdown file", () => {
  const md = renderProbes([probe, {
    ...probe,
    id: "p02",
    utterance: "wip 消して",
  }]);
  assertEquals(parseProbes(md), [probe, {
    ...probe,
    id: "p02",
    utterance: "wip 消して",
  }]);
});

Deno.test("score requires the skill, every expected path, and the clarification call", () => {
  const ok = {
    skill: "/gate",
    paths: ["/Users/x/dotfiles/home/programs/claude/skills/gate/SKILL.md"],
    needs_clarification: false,
  };
  assert(score(probe, ok));
  assert(!score(probe, { ...ok, skill: "impl" }));
  assert(!score(probe, { ...ok, paths: [] }));
  assert(!score(probe, { ...ok, needs_clarification: true }));
  const noSkill = {
    ...probe,
    expected: { skill: "", paths: [], needs_clarification: true },
  };
  assert(
    score(noSkill, {
      skill: "anything",
      paths: ["x"],
      needs_clarification: true,
    }),
  );
  assert(!score(noSkill, { skill: "", paths: [], needs_clarification: false }));
});

Deno.test("injected is true only when a term used in the utterance is in the digest", () => {
  const digest =
    "## ユーザーの語彙（承認済み）\n\n説明\n\n- gate（ゲート / 最終レビュー）: 監査。 ≠ impl。\n- wip: 一時コミット。\n（ほか 3 語は上限のため省略）";
  assertEquals(digestTerms(digest), ["gate", "ゲート", "最終レビュー", "wip"]);
  assert(injected(probe, digest));
  assert(injected({ ...probe, utterance: "最終レビューお願い" }, digest));
  assert(!injected({ ...probe, utterance: "plan を作って" }, digest));
  assert(!injected(probe, ""));
});

Deno.test("summarize counts correct and clarified answers per condition and run", () => {
  const rows = [
    {
      probe: "p01",
      condition: "without",
      rep: 1,
      correct: false,
      clarified: true,
    },
    {
      probe: "p02",
      condition: "without",
      rep: 1,
      correct: true,
      clarified: false,
    },
    {
      probe: "p01",
      condition: "with",
      rep: 1,
      correct: true,
      clarified: false,
    },
    {
      probe: "p02",
      condition: "with",
      rep: 1,
      correct: true,
      clarified: false,
    },
    {
      probe: "p01",
      condition: "with",
      rep: 2,
      correct: false,
      clarified: false,
      failed: true,
    },
  ] as const;
  assertEquals(summarize([...rows]), [
    {
      condition: "without",
      rep: 1,
      total: 2,
      correct: 1,
      clarified: 1,
      failed: 0,
    },
    {
      condition: "with",
      rep: 1,
      total: 2,
      correct: 2,
      clarified: 0,
      failed: 0,
    },
    {
      condition: "with",
      rep: 2,
      total: 1,
      correct: 0,
      clarified: 0,
      failed: 1,
    },
  ]);
});

Deno.test("mentions require one of the words in the interpretation", () => {
  const withMentions = {
    ...probe,
    expected: { ...probe.expected, mentions: ["main", "直接"] },
  };
  const base = {
    skill: "gate",
    paths: ["home/programs/claude/skills/gate/SKILL.md"],
    needs_clarification: false,
  };
  assert(
    score(withMentions, { ...base, interpretation: "Main に直接 commit する" }),
  );
  assert(
    !score(withMentions, {
      ...base,
      interpretation: "ブランチを切って PR を出す",
    }),
  );
  assert(!score(withMentions, base));
  assertEquals(
    parseProbes(renderProbes([withMentions]))[0].expected.mentions,
    ["main", "直接"],
  );
});
