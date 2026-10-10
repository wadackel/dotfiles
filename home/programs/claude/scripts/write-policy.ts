#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

// A fixture that already carries the identifier stays editable because several tests
// pin the real project path as an expected value; "write-policy: allow" in the new
// content is the explicit escape. Only node: built-ins are imported: the hook runs
// on every edit, and the shared yaml / glob helpers would add startup cost for two
// constant lists.

import { readFile, stat } from "node:fs/promises";
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

type HookInput = {
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

export function findIdentifiers(text: string): string[] {
  return IDENTIFIERS.filter((id) => text.includes(id));
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
  if (!isFixturePath(filePath)) process.exit(0);
  const content = newContent(input);
  if (content.includes(ALLOW_MARKER)) process.exit(0);
  const found = findIdentifiers(content);
  if (found.length === 0) process.exit(0);
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
  if (missing.length === 0) process.exit(0);
  console.error(
    [
      `[write-policy] Personal identifier "${missing[0]}" in a test fixture`,
      `Use a placeholder (alice, /Users/me, example-host), or add "${ALLOW_MARKER}" to the content if the real value is the point of the test`,
      `Blocked: ${filePath}`,
    ].join("\n"),
  );
  process.exit(2);
}
