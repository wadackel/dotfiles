// Stdio MCP server for the feed-digest cron job. Its one tool, post_digest,
// posts the model's picks to the owner's Slack DM as a parent message with a
// thread, and records what was posted so reactions can act on it.
//
// Usage: feeds-mcp.ts --channel <slack channel id>

import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.6.5";
import {
  articleMessage,
  type Bundle,
  parentMessage,
  type Pick,
} from "./feeds.ts";
import {
  type MessageRef,
  type Pool,
  readJson,
  type Seen,
  SEEN_LIMIT,
  writeJson,
} from "./feed-store.ts";
import { postMessage } from "./slack.ts";

export const MAX_SLOTS = 5;
export const MAX_EXPLORE = 1;

export type DigestInput = {
  picks: { id: string; reason: string; explore?: boolean }[];
  bundles: { ids: string[]; reason: string[] }[];
};

// Resolves the model's ids against today's pool and enforces the slot rules.
// Anything that does not come from the pool is rejected rather than posted.
export function resolveDigest(
  pool: Pool,
  input: DigestInput,
): { picks: Pick[]; bundles: Bundle[] } {
  const byKey = new Map(pool.items.map((e) => [e.key, e]));
  const used = new Set<string>();
  const take = (id: string) => {
    const e = byKey.get(id);
    if (!e) throw new Error(`unknown candidate id: ${id}`);
    if (used.has(id)) throw new Error(`candidate used twice: ${id}`);
    used.add(id);
    return e;
  };
  const picks = input.picks.map((p) => ({
    entry: take(p.id),
    reason: p.reason,
    explore: p.explore ?? false,
  }));
  const bundles = input.bundles.map((b) => {
    if (b.ids.length === 0) throw new Error("a bundle needs at least one id");
    if (b.reason.length !== b.ids.length) {
      throw new Error("a bundle needs one reason per id");
    }
    const items = b.ids.map((id, i) => ({
      entry: take(id),
      reason: b.reason[i],
    }));
    if (new Set(items.map((i) => i.entry.feedUrl)).size !== 1) {
      throw new Error("a bundle must come from a single feed");
    }
    return { feedTitle: items[0].entry.feedTitle, items };
  });
  if (picks.length + bundles.length > MAX_SLOTS) {
    throw new Error(`at most ${MAX_SLOTS} slots (a bundle counts as one)`);
  }
  if (picks.filter((p) => p.explore).length > MAX_EXPLORE) {
    throw new Error(`at most ${MAX_EXPLORE} explore pick`);
  }
  return { picks, bundles };
}

// Reactions only matter on recent posts; older refs are dropped so the map
// does not grow forever. Slack ts values are epoch seconds.
const MESSAGE_TTL_MS = 30 * 86_400_000;

export function pruneMessages<T>(
  messages: Record<string, T>,
  now: number,
): Record<string, T> {
  return Object.fromEntries(
    Object.entries(messages).filter(([ts]) =>
      Number(ts) * 1000 > now - MESSAGE_TTL_MS
    ),
  );
}

async function postDigest(
  channel: string,
  input: DigestInput,
): Promise<string> {
  const pool = await readJson<Pool>("pool.json", { date: "", items: [] });
  const { picks, bundles } = resolveDigest(pool, input);
  const messages = await readJson<Record<string, MessageRef>>(
    "messages.json",
    {},
  );

  if (picks.length + bundles.length > 0) {
    const parent = await postMessage(
      channel,
      parentMessage(pool.date, picks, bundles),
    );
    const post = async (p: Pick) => {
      const text = articleMessage(p);
      const ts = await postMessage(channel, text, parent);
      messages[ts] = {
        kind: "article",
        channel,
        text,
        url: p.entry.url,
        title: p.entry.title,
        feedUrl: p.entry.feedUrl,
        feedTitle: p.entry.feedTitle,
      };
    };
    for (const p of picks) await post(p);
    // A bundle is one slot in the parent's list, but each of its entries gets
    // its own thread message so a reaction can target a single article.
    for (const item of bundles.flatMap((b) => b.items)) {
      await post({ entry: item.entry, reason: item.reason, explore: false });
    }
    await writeJson("messages.json", pruneMessages(messages, Date.now()));
  }

  // Every candidate counts as seen, picked or not, so tomorrow's pool holds
  // only what is new since this run.
  const seen = await readJson<Seen>("seen.json", { ids: [] });
  await writeJson("seen.json", {
    lastRun: Date.now(),
    ids: [...pool.items.map((e) => e.id), ...seen.ids].slice(0, SEEN_LIMIT),
  });
  return `Posted ${picks.length} picks and ${bundles.length} bundles.`;
}

if (import.meta.main) {
  const i = Deno.args.indexOf("--channel");
  const channel = i === -1 ? undefined : Deno.args[i + 1];
  if (!channel) throw new Error("usage: feeds-mcp.ts --channel <id>");

  const server = new McpServer({ name: "feeds", version: "1.0.0" });
  server.registerTool(
    "post_digest",
    {
      description:
        "Post today's feed digest to the owner's Slack DM. Refer to candidates only by their ids (c1, c2, …). At most 5 slots; a bundle of one high-volume feed counts as one slot; at most one pick may be explore. Call it with empty lists when nothing is worth reading, so the candidates are marked as seen.",
      inputSchema: {
        picks: z.array(z.object({
          id: z.string(),
          reason: z.string().min(1).max(120),
          explore: z.boolean().optional(),
        })),
        bundles: z.array(z.object({
          ids: z.array(z.string()),
          reason: z.array(z.string().min(1).max(120)),
        })),
      },
    },
    async (input: DigestInput) => ({
      content: [{ type: "text", text: await postDigest(channel, input) }],
    }),
  );
  await server.connect(new StdioServerTransport());
}
