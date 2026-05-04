import {
  assert,
  assertEquals,
} from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  AGENT_NAMES,
  isEmbedded,
  parsePsLine,
  type PsRow,
} from "./agent-presence.ts";

function makeGetRow(
  chain: Record<number, PsRow>,
): (pid: number) => Promise<PsRow | null> {
  return (pid) => Promise.resolve(chain[pid] ?? null);
}

Deno.test("AGENT_NAMES contains all three managed agents", () => {
  assert(AGENT_NAMES.has("claude"));
  assert(AGENT_NAMES.has("codex"));
  assert(AGENT_NAMES.has("opencode"));
});

Deno.test("isEmbedded: top-level codex (single agent in ancestry) -> false", async () => {
  // chain: deno_self(100) -> sh(200) -> codex(300) -> zsh(400) -> tmux(1)
  const chain: Record<number, PsRow> = {
    100: { ppid: 200, comm: "deno" },
    200: { ppid: 300, comm: "sh" },
    300: { ppid: 400, comm: "codex" },
    400: { ppid: 1, comm: "zsh" },
  };
  assertEquals(await isEmbedded(100, makeGetRow(chain)), false);
});

Deno.test("isEmbedded: Claude -> codex via skill (two agents in ancestry) -> true", async () => {
  // chain: deno(100) -> sh(200) -> codex(300) -> bash(400) -> claude(500) -> zsh(600)
  const chain: Record<number, PsRow> = {
    100: { ppid: 200, comm: "deno" },
    200: { ppid: 300, comm: "sh" },
    300: { ppid: 400, comm: "codex" },
    400: { ppid: 500, comm: "bash" },
    500: { ppid: 600, comm: "claude" },
    600: { ppid: 1, comm: "zsh" },
  };
  assertEquals(await isEmbedded(100, makeGetRow(chain)), true);
});

Deno.test("isEmbedded: codex -> codex nested (same agent twice) -> true", async () => {
  // chain: deno(100) -> sh(200) -> codex(300) -> sh(400) -> codex(500) -> zsh(600)
  const chain: Record<number, PsRow> = {
    100: { ppid: 200, comm: "deno" },
    200: { ppid: 300, comm: "sh" },
    300: { ppid: 400, comm: "codex" },
    400: { ppid: 500, comm: "sh" },
    500: { ppid: 600, comm: "codex" },
    600: { ppid: 1, comm: "zsh" },
  };
  assertEquals(await isEmbedded(100, makeGetRow(chain)), true);
});

Deno.test("isEmbedded: Claude -> opencode via skill -> true", async () => {
  // chain: bun(100) -> sh(200) -> opencode(300) -> bash(400) -> claude(500) -> zsh(600)
  const chain: Record<number, PsRow> = {
    100: { ppid: 200, comm: "bun" },
    200: { ppid: 300, comm: "sh" },
    300: { ppid: 400, comm: "opencode" },
    400: { ppid: 500, comm: "bash" },
    500: { ppid: 600, comm: "claude" },
    600: { ppid: 1, comm: "zsh" },
  };
  assertEquals(await isEmbedded(100, makeGetRow(chain)), true);
});

Deno.test("isEmbedded: walk terminates safely at pid<=1 with no agent in chain -> false", async () => {
  const chain: Record<number, PsRow> = {
    100: { ppid: 0, comm: "deno" },
  };
  assertEquals(await isEmbedded(100, makeGetRow(chain)), false);
});

Deno.test("isEmbedded: getRow returning null halts walk -> false", async () => {
  const getRow = (_pid: number) => Promise.resolve(null);
  assertEquals(await isEmbedded(100, getRow), false);
});

Deno.test("parsePsLine: basename normalize -> {ppid, comm}", () => {
  assertEquals(parsePsLine("62800 claude"), {
    ppid: 62800,
    comm: "claude",
  });
});

Deno.test("parsePsLine: full path + trailing whitespace -> trimmed basename", () => {
  assertEquals(parsePsLine("  62800   /etc/profiles/per-user/wadackel/bin/codex  "), {
    ppid: 62800,
    comm: "codex",
  });
});

Deno.test("parsePsLine: malformed line -> null", () => {
  assertEquals(parsePsLine("not a ps line"), null);
});
