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
  appendDigestLog,
  type DigestRow,
  type MessageRef,
  type Pool,
  readJson,
  type Seen,
  SEEN_LIMIT,
  withStateLock,
  writeJson,
} from "./feed-store.ts";
import { postMessage } from "./slack.ts";
import { startTrace, trace } from "./trace.ts";

export type DigestInput = {
  picks: { id: string; reason: string; explore?: boolean }[];
  bundles: { ids: string[]; reason: string[] }[];
};

// Resolves the model's ids against today's pool and enforces the bundle rules.
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

export async function postDigest(
  channel: string,
  input: DigestInput,
  post: typeof postMessage = postMessage,
): Promise<string> {
  const pool = await readJson<Pool>("pool.json", { date: "", items: [] });
  // The model may call again after a tool timeout while the first call is
  // still posting; a pool is posted once.
  if (pool.postedAt) {
    throw new Error(`this digest was already posted at ${pool.postedAt}`);
  }
  const { picks, bundles } = resolveDigest(pool, input);
  // A bundle is one slot in the parent's list, but each of its entries gets
  // its own thread message so a reaction can target a single article.
  const articles = [
    ...picks.map((p) => ({ pick: p, bundle: false })),
    ...bundles.flatMap((b) =>
      b.items.map((item) => ({
        pick: { entry: item.entry, reason: item.reason, explore: false },
        bundle: true,
      }))
    ),
  ];

  if (articles.length === 0) {
    await markSeen(pool);
    return "Posted nothing.";
  }

  // Up to the parent post nothing is on Slack yet, so a failure there keeps
  // the candidates for tomorrow. Past it, what was posted must be recorded
  // even if a later post fails, or its reactions go nowhere and it comes back
  // tomorrow as a candidate.
  const parent = await post(channel, parentMessage(pool.date, picks, bundles));
  await writeJson("pool.json", { ...pool, postedAt: new Date().toISOString() });
  const started = Date.now();
  const at = new Date().toISOString();
  const rows: DigestRow[] = [];
  // Refs the per-post write could not store; the final write adds them.
  const pending: Record<string, MessageRef> = {};
  try {
    for (const { pick, bundle } of articles) {
      const text = articleMessage(pick);
      const ts = await post(channel, text, parent);
      const ref: MessageRef = {
        kind: "article",
        channel,
        text,
        url: pick.entry.url,
        title: pick.entry.title,
        feedUrl: pick.entry.feedUrl,
        feedTitle: pick.entry.feedTitle,
      };
      // Written per post and re-read under the lock: posting can take minutes,
      // and a reaction handled meanwhile writes this file too. A reaction can
      // hold the lock through a rate-limited chat.update, so a lock timeout
      // defers the ref instead of stopping the digest halfway.
      try {
        await withStateLock(async () => {
          const messages = await readJson<Record<string, MessageRef>>(
            "messages.json",
            {},
          );
          messages[ts] = ref;
          await writeJson("messages.json", messages);
        });
      } catch (e) {
        pending[ts] = ref;
        trace(`deferred message ref: ${e instanceof Error ? e.message : e}`);
      }
      rows.push({
        kind: "pick",
        at,
        date: pool.date,
        url: pick.entry.url,
        explore: pick.explore,
        bundle,
      });
    }
  } finally {
    await markSeen(pool);
    await appendDigestLog(rows);
    try {
      await withStateLock(async () => {
        const messages = await readJson<Record<string, MessageRef>>(
          "messages.json",
          {},
        );
        await writeJson(
          "messages.json",
          pruneMessages({ ...messages, ...pending }, Date.now()),
        );
      });
    } catch (e) {
      trace(
        `message refs not saved (${Object.keys(pending).length} deferred): ${
          e instanceof Error ? e.message : e
        }`,
      );
    }
    trace(
      `posted ${rows.length}/${articles.length} in ${Date.now() - started}ms`,
    );
  }
  return `Posted ${picks.length} picks and ${bundles.length} bundles.`;
}

// Every candidate counts as seen, picked or not, so tomorrow's pool holds
// only what is new since this run.
async function markSeen(pool: Pool): Promise<void> {
  const seen = await readJson<Seen>("seen.json", { ids: [] });
  await writeJson("seen.json", {
    lastRun: Date.now(),
    ids: [...pool.items.map((e) => e.id), ...seen.ids].slice(0, SEEN_LIMIT),
  });
}

if (import.meta.main) {
  const i = Deno.args.indexOf("--channel");
  const channel = i === -1 ? undefined : Deno.args[i + 1];
  if (!channel) throw new Error("usage: feeds-mcp.ts --channel <id>");
  startTrace();

  const server = new McpServer({ name: "feeds", version: "1.0.0" });
  server.registerTool(
    "post_digest",
    {
      description:
        "Post today's feed digest to the owner's Slack DM. Refer to candidates only by their ids (c1, c2, …). There is no limit on the number of picks; the articles of one high-volume feed go together in one bundle. Call it with empty lists when nothing is worth reading, so the candidates are marked as seen.",
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
