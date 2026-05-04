// opencode plugin: bridges opencode session/chat/tool events → tmux pane
// options consumed by ~/.local/share/picker-tmux/picker (the prefix+w popup
// SSOT lives in ../tmux/pane_row.ts:TMUX_FORMAT). The Bun-specific I/O
// boundary lives here; pure logic + types live in plugin_logic.ts so Deno
// can test them.
//
// Wiring lives in opencode.json's "plugin" array. opencode loads this file
// in-process under its bundled Bun runtime and inherits the parent process
// env, so process.env.TMUX_PANE is the originating tmux pane id when the
// user starts opencode from a tmux pane.

import type { Plugin } from "@opencode-ai/plugin";
import {
  eventToOps,
  type Op,
  type PaneState,
} from "./plugin_logic.ts";
import {
  isEmbedded,
  parsePsLine,
  type PsRow,
} from "./agent-presence.ts";

// Bun is provided by the opencode runtime. Declare here so this file
// type-checks under tooling that doesn't auto-load @types/bun.
declare const Bun: {
  spawnSync: (
    cmd: string[],
    opts?: {
      stdout?: "pipe" | "inherit" | "ignore";
      stderr?: "pipe" | "inherit" | "ignore";
    },
  ) => {
    exitCode: number;
    stdout: Uint8Array;
    stderr: Uint8Array;
  };
};

function fetchParent(pid: number): Promise<PsRow | null> {
  try {
    const result = Bun.spawnSync(
      ["ps", "-p", String(pid), "-o", "ppid=,comm="],
      { stdout: "pipe", stderr: "ignore" },
    );
    if (result.exitCode !== 0) return Promise.resolve(null);
    return Promise.resolve(parsePsLine(new TextDecoder().decode(result.stdout)));
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

// Sanity check on bootstrap: log once if TMUX_PANE is missing so the user
// can diagnose why the badge stays unset. The plugin is otherwise silent —
// opencode logs its own stderr.
function bootstrapWarning(): void {
  if (!paneIdOrNull()) {
    console.warn(
      "opencode-pane-status: TMUX_PANE not set or malformed; plugin is no-op.",
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

    "permission.ask": async (input) => {
      await dispatch("permission.ask", input as Record<string, unknown>);
    },
  };
};
