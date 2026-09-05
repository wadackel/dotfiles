#!/usr/bin/env -S deno run --allow-read --no-prompt

// comment-reviewer has no Bash, so this counts for it instead of letting it estimate.
// The file filter and marker set mirror comment-reviewer.md Scope; docstring markers
// are not distinguished because the reviewer applies its own scope filter to the
// listed blocks.

const EXTENSIONS = new Set([
  ".rs",
  ".go",
  ".ts",
  ".tsx",
  ".jsx",
  ".mts",
  ".cts",
  ".py",
  ".rb",
  ".lua",
  ".nix",
  ".sh",
  ".dart",
]);
const TEST_FILE = /(_test\.|\.test\.|\.spec\.)|(^|\/)(tests|__tests__)\//;
const COMMENT = /^(\/\/|#(?!!)|--|;|\/\*|\*\/|\*)/;

type Block = { file: string; line: number; size: number };
export type Metrics = { code: number; comment: number; blocks: Block[] };

function inScope(file: string): boolean {
  const ext = file.slice(file.lastIndexOf("."));
  return EXTENSIONS.has(ext) && !TEST_FILE.test(file);
}

export function measure(diff: string): Metrics {
  const m: Metrics = { code: 0, comment: 0, blocks: [] };
  let file = "";
  let scoped = false;
  let line = 0;
  let run: Block | null = null;
  let previousWasOldHeader = false;
  const flush = () => {
    if (run && run.size >= 2) m.blocks.push(run);
    run = null;
  };
  for (const raw of diff.split("\n")) {
    // An added line whose content starts with "++ " also begins with "+++ ", so a
    // new-file header counts only right after the old-file header.
    if (raw.startsWith("+++ ") && previousWasOldHeader) {
      flush();
      file = raw.slice(4).replace(/^b\//, "").trim();
      scoped = inScope(file);
      previousWasOldHeader = false;
      continue;
    }
    previousWasOldHeader = raw.startsWith("--- ");
    if (previousWasOldHeader) continue;
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      flush();
      line = Number(hunk[1]);
      continue;
    }
    if (!scoped) continue;
    if (raw.startsWith("-")) continue;
    if (raw.startsWith("+")) {
      const payload = raw.slice(1).trim();
      if (payload !== "" && COMMENT.test(payload)) {
        m.comment++;
        if (run) run.size++;
        else run = { file, line, size: 1 };
      } else {
        if (payload !== "") m.code++;
        flush();
      }
      line++;
      continue;
    }
    flush();
    line++;
  }
  flush();
  return m;
}

export function render(m: Metrics): string {
  const pct = m.code === 0
    ? "n/a"
    : `${Math.round((m.comment / m.code) * 100)}%`;
  const lines = [
    `added code lines: ${m.code}`,
    `added comment lines: ${m.comment} (${pct})`,
    "comment blocks:",
  ];
  if (m.blocks.length === 0) lines.push("  none");
  for (const b of m.blocks) {
    lines.push(`  ${b.file}:${b.line} (${b.size} lines)`);
  }
  return lines.join("\n");
}

if (import.meta.main) {
  const path = Deno.args[0];
  if (!path) {
    console.error("usage: comment-metrics.ts <diff-file>");
    Deno.exit(2);
  }
  let diff: string;
  try {
    diff = await Deno.readTextFile(path);
  } catch (e) {
    console.error(
      `comment-metrics: cannot read ${path}: ${(e as Error).message}`,
    );
    Deno.exit(2);
  }
  console.log(render(measure(diff)));
}
