// Stdio MCP server that lets the daily-note cron job write exactly one thing:
// the `## 🌅 Today` briefing of today's note. The To-Do and Tasks lists are
// prepared by prepare-daily.ts and stay out of the model's reach.

import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.6.5";
import {
  dailyDir,
  tokyoDate,
  upsertBriefing,
  writeNoteAtomically,
} from "./daily-note.ts";

const MAX_BRIEFING = 3000;

export function validateBriefing(markdown: string): string {
  const text = markdown.trim();
  if (text === "") throw new Error("briefing is empty");
  if (text.length > MAX_BRIEFING) {
    throw new Error(`briefing exceeds ${MAX_BRIEFING} characters`);
  }
  // A heading would end the section early and could shadow the note's own
  // headings, which the carry-over and the memo hook look up by exact text.
  if (text.split("\n").some((l) => /^\s*#/.test(l))) {
    throw new Error("briefing must not contain headings");
  }
  return text;
}

if (import.meta.main) {
  const server = new McpServer({ name: "daily", version: "1.0.0" });
  server.registerTool(
    "set_briefing",
    {
      description:
        "Write the `## 🌅 Today` briefing of today's daily note (replacing an earlier one). Markdown bullets only, no headings.",
      inputSchema: { markdown: z.string() },
    },
    async ({ markdown }: { markdown: string }) => {
      const briefing = validateBriefing(markdown);
      const path = `${dailyDir()}/${tokyoDate(new Date())}.md`;
      // Read and write back immediately: the Stop hook edits the same file
      // without a lock, so the window between the two must stay short.
      const note = await Deno.readTextFile(path);
      await writeNoteAtomically(path, upsertBriefing(note, briefing));
      return {
        content: [{ type: "text", text: `Wrote the briefing to ${path}` }],
      };
    },
  );
  await server.connect(new StdioServerTransport());
}
