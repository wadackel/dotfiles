# Session Text Extraction

Deno script pattern for extracting text from Claude Code JSONL session files.

## Why Deno (not jq)

`message.content` has mixed types:
- User messages: sometimes `string`, sometimes `Array<{type: "text", text: string}>`
- Assistant messages: always `Array<{type: "text"|"tool_use"|"tool_result", ...}>`

jq filters expecting only one format silently produce empty output. Deno handles both naturally.

## Extraction Script Pattern

Use `deno eval` with `set +H &&` prefix (to avoid `!` history expansion):

```typescript
// Core extraction logic — adapt as needed
const projectsDir = Deno.env.get("HOME") + "/.claude/projects";

interface Message {
  type: string;
  message?: {
    role?: string;
    content?: string | Array<{ type: string; text?: string; name?: string }>;
  };
}

function extractText(content: string | Array<{ type: string; text?: string; name?: string }>): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b) => b.type === "text" && b.text)
    .map((b) => b.text!)
    .join("\n");
}

function extractToolNames(content: Array<{ type: string; name?: string }>): string[] {
  return content
    .filter((b) => b.type === "tool_use" && b.name)
    .map((b) => b.name!);
}

// For each JSONL file, read line by line:
for (const line of text.split("\n")) {
  if (!line.trim()) continue;
  const entry: Message = JSON.parse(line);
  if (!entry.message) continue;

  const role = entry.message.role;
  const content = entry.message.content;
  if (!content) continue;

  if (role === "user") {
    const text = extractText(content);
    if (text.length > 20) lines.push(`[USER] ${text}`);
  } else if (role === "assistant") {
    if (Array.isArray(content)) {
      const text = extractText(content);
      if (text.length > 20) lines.push(`[ASSISTANT] ${text}`);
      const tools = extractToolNames(content);
      if (tools.length > 0) lines.push(`[TOOLS] ${tools.join(", ")}`);
    }
  }
}
```

## Session Boundary Preservation

Output format must include session markers:

```
=== SESSION: abc123 ===
[USER] セッションの最初のメッセージ
[ASSISTANT] 応答テキスト
[TOOLS] Read, Edit, Bash
...
=== SESSION: def456 ===
...
```

## Session-Aware Batch Splitting

Do NOT use `split -C` — it splits at arbitrary byte boundaries, breaking sessions.

Instead, accumulate sessions into batches:

```typescript
let currentBatch = "";
let batchIndex = 0;
const MAX_BYTES = 800 * 1024;

for (const session of sessions) {
  const sessionText = `=== SESSION: ${session.id} ===\n${session.content}\n`;
  if (currentBatch.length + sessionText.length > MAX_BYTES && currentBatch.length > 0) {
    await Deno.writeTextFile(`/tmp/.../batch_${batchIndex}.txt`, currentBatch);
    batchIndex++;
    currentBatch = "";
  }
  currentBatch += sessionText;
}
if (currentBatch) {
  await Deno.writeTextFile(`/tmp/.../batch_${batchIndex}.txt`, currentBatch);
}
```

## Output Size Reference

Typical compression ratios from raw JSONL to extracted text:
- Raw JSONL: ~230MB (all projects combined)
- Extracted text: ~4MB (tool content stripped, only human-readable text)
- Compression: ~50-60x
