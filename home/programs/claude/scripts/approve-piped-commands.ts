#!/usr/bin/env -S deno run

// PermissionRequest hook for Bash: auto-approve compound commands
// where all individual commands are in the allowed set.

import { parse } from "npm:shell-quote@1";

export const ALLOWED_COMMANDS = new Set([
  "7z", "ag", "awk", "bat", "cargo", "cat", "chmod", "chown", "claude",
  "cp", "curl", "date", "deno", "dig", "docker", "docker-compose", "du",
  "echo", "env", "esbuild", "eslint", "extract-session-history.ts", "eza",
  "fd", "ffmpeg", "ffprobe",
  "find", "fold", "fzf", "gemini", "gh", "git", "go", "grep", "gunzip",
  "gzip", "head", "http", "jq", "kill", "killall", "kubectl", "ln", "ls",
  "lsof", "make", "mkdir", "mv", "node", "npm", "nix", "nix-build",
  "nix-env", "nix-store", "oxlint", "pgrep", "pkill", "plutil", "pnpm",
  "prettier", "ps", "python", "python3", "readlink", "rg", "rm", "rsync",
  "sed", "sleep", "sort", "ssh", "starship", "tail", "tar", "tee",
  "terminal-notifier", "test", "time", "timeout", "tmux", "tokei", "touch",
  "tr", "tree", "tsx", "wc", "wget", "which", "whoami", "xargs", "yq",
  "zellij",
]);

/** Compound operator (|, &&, ||, ;) またはリダイレクト (2>&1, >/dev/null 等) を含むかチェック */
export function hasShellSyntax(command: string): boolean {
  return /[|;]|&&|\d*>&\d+|\d*>[^ ]*|\d*<[^ ]*/.test(command);
}

type Token = string | { op: string } | { comment: string };

const SEGMENT_OPS = new Set(["|", "||", "&&", ";", "(", ")"]);
const REDIRECT_OPS = new Set([">", ">>", ">&", "<", "<<"]);

/** shell-quote でパースし、各セグメントの先頭コマンド名を抽出 */
export function extractCommands(command: string): string[] {
  const tokens = parse(command) as Token[];
  const result: string[] = [];
  let expectCmd = true;
  let skipNext = false;

  for (const token of tokens) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    if (typeof token === "object" && "op" in token) {
      if (REDIRECT_OPS.has(token.op)) {
        skipNext = true;
      } else if (SEGMENT_OPS.has(token.op)) {
        expectCmd = true;
      }
      continue;
    }

    if (typeof token !== "string") continue;

    if (expectCmd) {
      if (/^[A-Z_][A-Z0-9_]*=/.test(token)) continue;
      result.push(token);
      expectCmd = false;
    }
  }

  return result;
}

/** すべてのコマンドが許可リストに含まれるか判定 */
export function shouldApprove(
  command: string,
  allowed: Set<string> = ALLOWED_COMMANDS,
): boolean {
  if (!hasShellSyntax(command)) return false;
  const cmds = extractCommands(command);
  if (cmds.length === 0) return false;
  return cmds.every((cmd) => {
    if (allowed.has(cmd)) return true;
    const base = cmd.includes("/") ? cmd.split("/").pop()! : cmd;
    return allowed.has(base);
  });
}

// --- Entry point ---

if (import.meta.main) {
  interface HookInput {
    tool_name: string;
    tool_input: { command: string };
  }

  const input: HookInput = JSON.parse(
    await new Response(Deno.stdin.readable).text(),
  );

  if (input.tool_name !== "Bash") Deno.exit(0);
  if (!shouldApprove(input.tool_input.command)) Deno.exit(0);

  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: { behavior: "allow" },
    },
  }));
}
