#!/usr/bin/env -S deno run --allow-read --allow-env=HOME --allow-write=/tmp

// --- Types ---

interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  content?: unknown;
  is_error?: boolean;
}

interface TranscriptEntry {
  type: string;
  subtype?: string;
  message?: {
    content: string | ContentBlock[];
  };
  summary?: string;
  compactMetadata?: {
    trigger?: string;
    preTokens?: number;
  };
  timestamp?: string;
}

// --- Helpers ---

function truncate(s: string, max: number): string {
  const cleaned = s.replaceAll("\n", " ");
  if (cleaned.length <= max) return cleaned;
  return `${cleaned.slice(0, max)}... [${cleaned.length} chars]`;
}

function formatSize(bytes: number): string {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)}M`
    : `${(bytes / 1024).toFixed(0)}K`;
}

// --- Transcript Discovery ---

function findTranscript(projectDir: string): string {
  const encoded = projectDir.replace(/^\//, "").replaceAll("/", "-");
  const dir = `${Deno.env.get("HOME")}/.claude/projects/-${encoded}`;

  let entries: { path: string; mtime: number }[];
  try {
    entries = [...Deno.readDirSync(dir)]
      .filter((e) => e.name.endsWith(".jsonl"))
      .map((e) => {
        const path = `${dir}/${e.name}`;
        return { path, mtime: Deno.statSync(path).mtime?.getTime() ?? 0 };
      })
      .sort((a, b) => b.mtime - a.mtime);
  } catch {
    throw new Error(`Transcript directory not found: ${dir}`);
  }

  if (entries.length === 0) throw new Error("No transcript files found");
  return entries[0].path;
}

// --- Parsing ---

function parseTranscript(path: string): TranscriptEntry[] {
  const raw = Deno.readTextFileSync(path);
  return raw
    .split("\n")
    .filter((line) => line.trim())
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as TranscriptEntry];
      } catch {
        return [];
      }
    });
}

// --- Extraction ---

function extractTimeline(
  entries: TranscriptEntry[],
  maxUser: number,
  maxAsst: number,
): string {
  const lines: string[] = [];

  for (const entry of entries) {
    if (entry.type === "system" && entry.subtype === "compact_boundary") {
      const m = entry.compactMetadata;
      lines.push(
        `\n---\n**[COMPACT BOUNDARY]** (${m?.trigger ?? "?"}, ${m?.preTokens ?? "?"} tokens) — ${entry.timestamp ?? ""}\n---`,
      );
      continue;
    }

    if (entry.type === "summary") {
      lines.push(`**[SESSION SUMMARY]** ${entry.summary}`);
      continue;
    }

    if (entry.type === "user") {
      const content = entry.message?.content;
      if (typeof content === "string") {
        lines.push(`### User\n${truncate(content, maxUser)}\n`);
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text) {
            lines.push(`### User\n${truncate(block.text, maxUser)}\n`);
          } else if (block.type === "tool_result" && block.is_error) {
            lines.push(
              `**[TOOL ERROR]** ${truncate(String(block.content), 200)}\n`,
            );
          }
        }
      }
      continue;
    }

    if (entry.type === "assistant") {
      const content = entry.message?.content;
      if (!Array.isArray(content)) continue;

      const parts: string[] = [];
      for (const block of content) {
        if (block.type === "text" && block.text) {
          parts.push(`### Assistant\n${truncate(block.text, maxAsst)}\n`);
        } else if (block.type === "tool_use" && block.name) {
          parts.push(`\`[Tool: ${block.name}]\``);
        }
      }
      if (parts.length > 0) lines.push(parts.join(" "));
    }
  }

  return lines.join("\n");
}

function collectToolSummary(entries: TranscriptEntry[]): string {
  const counts = new Map<string, number>();
  for (const e of entries) {
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    for (const block of e.message!.content as ContentBlock[]) {
      if (block.type === "tool_use" && block.name) {
        counts.set(block.name, (counts.get(block.name) ?? 0) + 1);
      }
    }
  }
  return (
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([name, count]) => `- **${name}**: ${count} calls`)
      .join("\n") || "None"
  );
}

function collectErrorSummary(entries: TranscriptEntry[]): string {
  const errors: string[] = [];
  for (const e of entries) {
    if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
    for (const block of e.message!.content as ContentBlock[]) {
      if (block.type === "tool_result" && block.is_error) {
        errors.push(`- ${String(block.content).slice(0, 100)}`);
      }
    }
  }
  return errors.slice(0, 10).join("\n") || "None";
}

// --- Main ---

const MAX_OUTPUT_BYTES = 100 * 1024;

const projectDir = Deno.args[0] ?? Deno.cwd();
const transcriptPath = findTranscript(projectDir);
const sessionId = transcriptPath.split("/").pop()!.replace(".jsonl", "");
const fileSize = Deno.statSync(transcriptPath).size;
const entries = parseTranscript(transcriptPath);

const toolSummary = collectToolSummary(entries);
const errorSummary = collectErrorSummary(entries);
const sizeStr = formatSize(fileSize);

// Tier 1
let timeline = extractTimeline(entries, 300, 200);
let output = `# Session History Extract
- **Session ID**: ${sessionId}
- **Transcript size**: ${sizeStr}

## Tool Usage Summary
${toolSummary}

## Error Summary
${errorSummary}

---
## Conversation Timeline
${timeline}`;

// Tier 2: condense if too large
if (new TextEncoder().encode(output).length > MAX_OUTPUT_BYTES) {
  timeline = extractTimeline(entries, 150, 100);
  output = `# Session History Extract (Condensed)
- **Session ID**: ${sessionId}
- **Transcript size**: ${sizeStr}

> Large session — output condensed for readability.

## Tool Usage Summary
${toolSummary}

## Error Summary
${errorSummary}

---
## Conversation Timeline
${timeline}`;
}

// Write to temp file, print path
const outputPath = `/tmp/claude-session-history-${Deno.pid}.md`;
Deno.writeTextFileSync(outputPath, output);
console.log(outputPath);
