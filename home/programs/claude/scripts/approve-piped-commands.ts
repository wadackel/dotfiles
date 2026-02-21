#!/usr/bin/env -S deno run

// PermissionRequest hook for Bash: auto-approve compound commands
// where all individual commands are in the allowed set.

export const ALLOWED_COMMANDS = new Set([
  "7z", "ag", "awk", "bat", "cargo", "cat", "chmod", "chown", "claude",
  "cp", "curl", "date", "deno", "dig", "docker", "docker-compose", "du",
  "echo", "env", "esbuild", "eslint", "eza", "fd", "ffmpeg", "ffprobe",
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

/** コマンド文字列から各セグメントの先頭コマンド名を抽出 */
export function extractCommands(command: string): string[] {
  const normalized = command
    .replace(/\d*>&\d+/g, "") // 2>&1 等
    .replace(/\d*>[^ ]*/g, "") // >/dev/null, 2>/dev/null 等
    .replace(/\d*<[^ ]*/g, ""); // <input 等

  // ) を除去し ( でサブシェルを分割してから演算子で分割する
  const parts = normalized.replace(/\)/g, "").split("(");

  const result: string[] = [];
  for (const part of parts) {
    const segments = part.split(/\s*(?:\|{1,2}|&&|;)\s*/);
    for (const segment of segments) {
      const cmd = segment.trim().split(/\s+/)[0];
      if (cmd) result.push(cmd);
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
  return cmds.every((cmd) => allowed.has(cmd));
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
