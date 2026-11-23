#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

// A fixture that already carries the identifier stays editable because several tests
// pin the real project path as an expected value; "write-policy: allow" in the new
// content is the explicit escape. Only node: built-ins are imported: the hook runs
// on every edit, and the shared yaml / glob helpers would add startup cost for two
// constant lists.

// The skill hint rides on this hook instead of a hook of its own, so editing a
// SKILL.md starts no extra process; a line in CLAUDE.md would be paid in every
// session for an edit that a few sessions make.

import { closeSync, mkdirSync, openSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { text } from "node:stream/consumers";

const IDENTIFIERS = [
  "wadackels-MacBook",
  "tsuyoshiwadas",
  "tsuyoshi.wada",
  "wadackel",
] as const;
const ALLOW_MARKER = "write-policy: allow";
const TOOLS = new Set(["Write", "Edit", "MultiEdit"]);
const FIXTURE_DIR =
  /(^|\/)(tests?|__tests__|fixtures?|__fixtures__|testdata)\//;
const FIXTURE_NAME = /(_test\.|\.test\.|\.spec\.)/;

export const SKILL_HINT = [
  "[skill-design] This edit touches a skill. Two points from skill-design matter at edit time:",
  "- The description is paid in every session's skill listing: in one or two sentences, most under 250 characters, say what the skill does and when to use it, front-loading the task and the domain's nouns, with no trigger-phrase list, list of what the body covers, workflow summary, or exclusion sentence.",
  "- The body states principles with their reasons; fixed steps, stage tables, and reply templates belong only where one order is safe (destructive operations, strings a script parses). A rule that must hold every time goes in a script or hook, not prose.",
  "When creating or restructuring a skill, load the skill-design skill: it holds the platform limits, the lessons behind these points, and how to compare a skill against a baseline.",
].join("\n");

type HookInput = {
  session_id?: string;
  agent_id?: string;
  tool_name?: string;
  tool_input?: {
    file_path?: string;
    content?: string;
    new_string?: string;
    edits?: Array<{ new_string?: string }>;
  };
};

export function isFixturePath(path: string): boolean {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return FIXTURE_DIR.test(path) || FIXTURE_NAME.test(base);
}

// A package or import line names the code's own namespace (dev.wadackel.app, @wadackel/pkg),
// which ships with the code rather than being a value a test pins; without this every new test
// file in such a repository is refused. A home path or hostname on any other line still counts.
const DECLARATION_LINE = /^[ \t]*(package|import)\b.*$/gm;

export function findIdentifiers(text: string): string[] {
  const body = text.replace(DECLARATION_LINE, "");
  return IDENTIFIERS.filter((id) => body.includes(id));
}

export function isSkillFile(path: string): boolean {
  return path === "SKILL.md" || path.endsWith("/SKILL.md");
}

// A subagent's hook input carries its parent's session_id, so the marker is keyed on
// agent_id too, or a subagent editing after the main session would never see the hint.
export function hintKey(input: HookInput): string | undefined {
  if (!input.session_id) return undefined;
  return `${input.session_id}-${input.agent_id ?? "main"}`;
}

// "wx" creates the marker exclusively, so concurrent edits show the hint once.
export function takeSkillHint(
  path: string,
  key: string | undefined,
  markerDir = join(tmpdir(), "claude-skill-hint"),
): string | null {
  if (!isSkillFile(path)) return null;
  if (!key) return SKILL_HINT;
  try {
    mkdirSync(markerDir, { recursive: true });
    closeSync(
      openSync(join(markerDir, key.replace(/[^\w-]/g, "_")), "wx"),
    );
    return SKILL_HINT;
  } catch {
    return null;
  }
}

export function newContent(input: HookInput): string {
  const t = input.tool_input ?? {};
  switch (input.tool_name) {
    case "Write":
      return t.content ?? "";
    case "Edit":
      return t.new_string ?? "";
    case "MultiEdit":
      return (t.edits ?? []).map((e) => e.new_string ?? "").join("\n");
    default:
      return "";
  }
}

if (import.meta.main) {
  let input: HookInput;
  try {
    input = JSON.parse(await text(process.stdin));
  } catch {
    process.exit(0);
  }
  if (!input.tool_name || !TOOLS.has(input.tool_name)) process.exit(0);
  const filePath = input.tool_input?.file_path ?? "";
  const allow = (): never => {
    // A replay that compares skill-design itself sets this, or its no-skill arm
    // would receive the guidance it is meant to run without.
    const hint = process.env.CLAUDE_SKILL_HINT_SKIP === "1"
      ? null
      : takeSkillHint(filePath, hintKey(input));
    if (hint) {
      console.log(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          additionalContext: hint,
        },
      }));
    }
    process.exit(0);
  };
  if (!isFixturePath(filePath)) allow();
  const content = newContent(input);
  if (content.includes(ALLOW_MARKER)) allow();
  const found = findIdentifiers(content);
  if (found.length === 0) allow();
  // The path comes straight from the tool call; only a regular file of sane size is
  // read, so a FIFO or a device cannot stall the hook.
  let existing = "";
  try {
    const info = await stat(filePath);
    if (info.isFile() && info.size <= 1_000_000) {
      existing = await readFile(filePath, "utf8");
    }
  } catch {
    existing = "";
  }
  const missing = found.filter((id) => !existing.includes(id));
  if (missing.length === 0) allow();
  console.error(
    [
      `[write-policy] Personal identifier "${missing[0]}" in a test fixture`,
      `Use a placeholder (alice, /Users/me, example-host), or add "${ALLOW_MARKER}" to the content if the real value is the point of the test`,
      `Blocked: ${filePath}`,
    ].join("\n"),
  );
  process.exit(2);
}
