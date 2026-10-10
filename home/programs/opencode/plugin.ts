// opencode plugin: bridges opencode session/chat/tool events → tmux pane
// options consumed by ~/.local/share/agentower/agentower (the prefix+w popup
// SSOT lives in ../tmux/agentower/pane_row.ts:TMUX_FORMAT). The Bun-specific I/O
// boundary lives here; pure logic + types live in plugin_logic.ts so they can
// be unit-tested outside opencode.
//
// Wiring lives in opencode.json's "plugin" array. opencode loads this file
// in-process under its bundled Bun runtime and inherits the parent process
// env, so process.env.TMUX_PANE is the originating tmux pane id when the
// user starts opencode from a tmux pane.

import type { Plugin } from "@opencode-ai/plugin";
import { eventToOps, type PaneState, vocabDigestFor } from "./plugin_logic.ts";
// `Op` lives in pane-shared.ts (SSOT), imported through the sibling symlink
// that is published next to this file.
import { type Op } from "./pane-shared.ts";
import { isEmbedded, parsePsLine, type PsRow } from "./agent-presence.ts";

// Bun is provided by the opencode runtime. Declare here so this file
// type-checks under tooling that doesn't auto-load @types/bun.
declare const Bun: {
  spawnSync: (
    cmd: string[],
    opts?: {
      stdout?: "pipe" | "inherit" | "ignore";
      stderr?: "pipe" | "inherit" | "ignore";
      timeout?: number;
    },
  ) => {
    exitCode: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
  };
  spawn: (
    cmd: string[],
    opts?: {
      stdin?: "pipe" | "inherit" | "ignore";
      stdout?: "pipe" | "inherit" | "ignore";
      stderr?: "pipe" | "inherit" | "ignore";
    },
  ) => {
    stdin: { write: (data: string) => void; end: () => void };
    unref: () => void;
  };
  which: (cmd: string) => string | null;
};

function fetchParent(pid: number): Promise<PsRow | null> {
  try {
    const result = Bun.spawnSync(
      ["ps", "-p", String(pid), "-o", "ppid=,comm="],
      { stdout: "pipe", stderr: "ignore" },
    );
    if (result.exitCode !== 0) return Promise.resolve(null);
    return Promise.resolve(
      parsePsLine(new TextDecoder().decode(result.stdout)),
    );
  } catch {
    return Promise.resolve(null);
  }
}

// Validate pane id shape (`%<digits>`) before passing to tmux. opencode runs
// arbitrary user code; a stray `TMUX_PANE` value of `; rm -rf /` is harmless
// here because we always use argv arrays (no shell), but a leading `-` would
// be parsed by tmux itself as an option, so the pattern guard stays.
const PANE_ID_RE = /^%\d+$/;

function paneIdOrNull(): string | null {
  const v = process.env.TMUX_PANE;
  if (!v || !PANE_ID_RE.test(v)) return null;
  return v;
}

// Read the subset of pane options needed by eventToOps to make
// concurrent-tool decisions (`tool.execute.after` only unsets
// `@pane_current_tool` when the finishing tool matches the recorded current).
function readPaneState(pane: string): PaneState {
  const status = tmuxShow(pane, "@pane_status");
  const currentTool = tmuxShow(pane, "@pane_current_tool");
  return { status, currentTool };
}

function tmuxShow(pane: string, key: string): string {
  const result = Bun.spawnSync(["tmux", "show", "-t", pane, "-pv", key], {
    stdout: "pipe",
  });
  // tmux returns non-zero with empty stderr when the option is unset — that
  // is the normal default-path and must stay silent. Treat any non-zero as
  // "value not set" and return empty string.
  if (result.exitCode !== 0) return "";
  return new TextDecoder().decode(result.stdout).trim();
}

function applyOps(pane: string, ops: Op[]): void {
  for (const op of ops) {
    const args = op.kind === "set"
      ? ["tmux", "set", "-t", pane, "-p", op.key, op.value]
      : ["tmux", "set", "-t", pane, "-p", "-u", op.key];
    const result = Bun.spawnSync(args);
    if (result.exitCode !== 0) {
      const err = new TextDecoder().decode(result.stderr).trim();
      console.warn(
        `opencode-pane-status: tmux ${op.kind} ${op.key} failed: ${err}`,
      );
    }
  }
}

async function dispatch(
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const pane = paneIdOrNull();
  if (!pane) return;
  // Skip pane writes when this opencode is running embedded under another
  // agent's process tree (e.g. spawned via Claude's /codex-cli skill or a
  // shell that inherited TMUX_PANE from a wrapping agent). Only the main
  // session for the pane should drive @pane_* state.
  if (await isEmbedded(process.pid, fetchParent)) return;
  const state = readPaneState(pane);
  const ops = eventToOps(event, data, state);
  if (ops.length === 0) return;
  applyOps(pane, ops);
}

// The memo worker and vocab.ts are started by path, and their shebangs look up
// `bun` on PATH. Both launches discard their output, so this lookup feeds the
// one warning that explains an empty vocabulary or a missing memo; it does not
// gate the launches.
const BUN_BIN: string | null = Bun.which("bun");

interface MemoDispatchInput {
  sessionID: string;
  cwd: string;
}

function readMemoDispatch(
  event: string,
  data: Record<string, unknown>,
): MemoDispatchInput | null {
  // session.idle and session.status:idle both signal the assistant has
  // finished its turn. Either is sufficient to dispatch memo; if both fire
  // for the same turn the worker debounces via shouldRunLLM and the daily
  // note's upsert behavior keeps the entry idempotent.
  const isIdle = event === "session.idle" ||
    (event === "session.status" &&
      typeof (data.properties as Record<string, unknown> | undefined)?.type ===
        "string" &&
      (data.properties as Record<string, unknown>).type === "idle");
  if (!isIdle) return null;

  const sid = typeof data.sessionID === "string" ? data.sessionID : "";
  const props = data.properties as Record<string, unknown> | undefined;
  const sidFromProps = typeof props?.sessionID === "string"
    ? props.sessionID as string
    : "";
  const sessionID = sid || sidFromProps;
  if (!sessionID) return null;

  const cwd = typeof data.cwd === "string"
    ? (data.cwd as string)
    : (typeof (props?.info as Record<string, unknown> | undefined)
        ?.directory ===
        "string"
      ? ((props!.info as Record<string, unknown>).directory as string)
      : process.cwd());
  return { sessionID, cwd };
}

function spawnMemoWorker(input: MemoDispatchInput): void {
  let workerPath: string;
  try {
    workerPath =
      new URL("./scripts/opencode-memo.ts", import.meta.url).pathname;
  } catch {
    // import.meta.url should always be available; if URL construction fails,
    // skip silently rather than break the plugin.
    return;
  }
  try {
    const child = Bun.spawn(
      [workerPath],
      { stdin: "pipe", stdout: "ignore", stderr: "ignore" },
    );
    child.stdin.write(JSON.stringify({
      session_id: input.sessionID,
      cwd: input.cwd,
    }));
    child.stdin.end();
    child.unref();
  } catch (e) {
    console.warn(`opencode-memo: spawn failed: ${e}`);
  }
}

async function dispatchMemo(
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const input = readMemoDispatch(event, data);
  if (!input) return;
  // Skip when running embedded under another agent's process tree, mirroring
  // the pane-status guard. Prevents duplicate daily-note entries.
  if (await isEmbedded(process.pid, fetchParent)) return;
  spawnMemoWorker(input);
}

// The vocabulary digest comes from vocab.ts, which reads the Obsidian vault.
// It is executed by path, so the kernel applies its shebang and with it the
// flags that keep a bunfig.toml or .env in the session's cwd from loading.
const vocabCache = new Map<string, string>();

function buildVocabDigest(): string {
  if (!process.env.HOME) return "";
  try {
    const result = Bun.spawnSync(
      [
        `${process.env.HOME}/.agents/scripts/vocab.ts`,
        "digest",
        "--cwd",
        process.cwd(),
      ],
      // The transform blocks the model call it runs before, so a stuck git or
      // a slow vault read costs at most this long, then no vocabulary.
      { stdout: "pipe", stderr: "ignore", timeout: 5000 },
    );
    return result.exitCode === 0
      ? new TextDecoder().decode(result.stdout).trim()
      : "";
  } catch {
    return "";
  }
}

// Sanity check on bootstrap: log once if TMUX_PANE is missing so the user
// can diagnose why the badge stays unset. The plugin is otherwise silent —
// opencode logs its own stderr.
function bootstrapWarning(): void {
  if (!paneIdOrNull()) {
    console.warn(
      "opencode-pane-status: TMUX_PANE not set or malformed; plugin is no-op.",
    );
  }
  if (!BUN_BIN) {
    console.warn(
      "opencode-memo: `bun` not on PATH; the memo worker and the vocabulary digest cannot start.",
    );
  }
}

export const PaneStatus: Plugin = async (_input) => {
  bootstrapWarning();
  return {
    // Generic event handler for session.* events that don't have dedicated
    // hooks (session.created, session.deleted, session.idle, session.status,
    // session.error). Filter on event.type to keep dispatch focused.
    event: async ({ event }) => {
      const e = event as { type: string; properties?: Record<string, unknown> };
      const data: Record<string, unknown> = {};
      if (e.properties) data.properties = e.properties;
      // Promote sessionID up to the top level so eventToOps can readSessionId
      // without re-traversing properties — it already supports both shapes
      // but flattening here keeps the dispatch trace simpler in logs.
      const sid = (e.properties as Record<string, unknown> | undefined)
        ?.sessionID;
      if (typeof sid === "string") data.sessionID = sid;
      await dispatch(e.type, data);
      await dispatchMemo(e.type, data);
    },

    "chat.message": async (input, output) => {
      // Named hook input shape: { sessionID, agent?, model?, messageID?, ... }
      // Output carries the user message; eventToOps reads either
      // top-level `prompt` (debug) or `output.message.content`.
      await dispatch("chat.message", {
        ...(input as Record<string, unknown>),
        output: output as Record<string, unknown>,
      });
    },

    "tool.execute.before": async (input) => {
      const i = input as Record<string, unknown>;
      // Plan R1: opencode `tool.execute.before` payload `tool` field shape
      // is documented as a string but allow object fallback. Log once if it
      // is neither so future opencode releases that change the shape are
      // observable in stderr.
      if (typeof i.tool !== "string" && typeof i.tool !== "object") {
        console.warn(
          `opencode-pane-status: tool.execute.before tool field is ${typeof i
            .tool}, expected string|object`,
        );
      }
      await dispatch("tool.execute.before", i);
    },

    "tool.execute.after": async (input, output) => {
      await dispatch("tool.execute.after", {
        ...(input as Record<string, unknown>),
        output: output as Record<string, unknown>,
      });
    },

    "experimental.chat.system.transform": async (input, output) => {
      const text = vocabDigestFor(
        vocabCache,
        input.sessionID,
        process.env.VOCAB_DIGEST,
        buildVocabDigest,
      );
      if (text) output.system.push(text);
    },

    "permission.ask": async (input) => {
      await dispatch("permission.ask", input as Record<string, unknown>);
    },
  };
};
