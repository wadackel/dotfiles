import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { test } from "bun:test";
import { readFile } from "node:fs/promises";

const ROOT = new URL("../../../../", import.meta.url);

async function readRepoFile(relativePath: string): Promise<string> {
  return await readFile(new URL(relativePath, ROOT), "utf8");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function section(markdown: string, heading: string): string {
  const level = heading.match(/^#+/)?.[0].length;
  assert(level, `invalid markdown heading: ${heading}`);

  const match = markdown.match(
    new RegExp(`^${escapeRegExp(heading)}(?:\\s|$).*?$`, "m"),
  );
  assert(match?.index !== undefined, `missing section: ${heading}`);

  const rest = markdown.slice(match.index);
  const nextHeading = new RegExp(`\\n#{1,${level}}\\s+\\S`, "m");
  const next = rest.slice(heading.length).search(nextHeading);
  return next < 0 ? rest : rest.slice(0, heading.length + next);
}

function assertIncludesAll(haystack: string, needles: string[]): void {
  for (const needle of needles) {
    assertStringIncludes(haystack, needle);
  }
}

function assertInOrder(haystack: string, needles: string[]): void {
  let previous = -1;
  for (const needle of needles) {
    const current = haystack.indexOf(needle);
    assert(current >= 0, `missing ordered marker: ${needle}`);
    assert(
      current > previous,
      `marker should appear after previous marker: ${needle}`,
    );
    previous = current;
  }
}

test("Codex delegation policy is deployed without model or size gates", async () => {
  const policy = await readRepoFile("home/programs/codex/subagent-policy.md");
  const nix = await readRepoFile("home/programs/codex/default.nix");
  assertStringIncludes(nix, "builtins.readFile ./subagent-policy.md");
  assertStringIncludes(
    nix,
    "builtins.readFile ../agents/shared/comment-conventions.md",
  );
  assertIncludesAll(policy, [
    "main session",
    "shared skills",
    "explicit",
    'fork_turns: "none"',
  ]);
  assert(!/gpt-\d|Astra|20 files|500 lines/i.test(policy));
});

test("Vault-first policy reaches both Codex and opencode", async () => {
  const policy = await readRepoFile(
    "home/programs/agents/shared/vault-policy.md",
  );
  assertInOrder(await readRepoFile("home/programs/codex/default.nix"), [
    "builtins.readFile ./subagent-policy.md",
    "builtins.readFile ../agents/shared/vault-policy.md",
  ]);
  assertStringIncludes(
    await readRepoFile("home/programs/agents/default.nix"),
    '".agents/vault-policy.md"',
  );
  assertStringIncludes(
    await readRepoFile("home/programs/opencode/opencode.json"),
    '"{env:HOME}/.agents/vault-policy.md"',
  );
  assertIncludesAll(policy, [
    "more than one defensible answer",
    "`llm-wiki` skill's `query` verb",
    "Skip it only for what the current repository settles",
  ]);
});

function communicationBullets(markdown: string): string[] {
  return section(markdown, "## Communication")
    .split("\n")
    .filter((line) => line.startsWith("- "));
}

// The Codex copy is concatenated into ~/.codex/AGENTS.md by Nix; a reader
// line added to one side only would leave the other agent writing blind.
test("the reader model is in Communication and its Codex mirror alike", async () => {
  const claude = communicationBullets(
    await readRepoFile("home/programs/claude/global-instructions.md"),
  );
  const codex = communicationBullets(
    await readRepoFile("home/programs/agents/shared/communication.md"),
  );
  assertEquals(codex, claude);
  assertIncludesAll(claude.join("\n"), [
    "decides with little attention",
    "data flow, module boundaries and their inputs and outputs",
    "say how that was established",
  ]);
});
