#!/usr/bin/env -S deno run --allow-read --allow-write

// Splices a Nix-generated managed block into ~/.codex/config.toml between
// `# nix-managed:start` / `# nix-managed:end` markers. Content outside the
// markers (e.g. [projects.*] / [notice] sections that Codex CLI mutates at
// runtime) is preserved verbatim. Idempotent: skips write when the resulting
// content equals the current file.

const START_MARKER = "# nix-managed:start";
const END_MARKER = "# nix-managed:end";

export interface ApplyResult {
  action: "created" | "replaced" | "prepended" | "noop";
  warning?: string;
}

export function spliceContent(
  current: string | null,
  managedBody: string,
): { next: string; result: ApplyResult } {
  const normalizedBody = managedBody.endsWith("\n") ? managedBody : managedBody + "\n";
  const block = `${START_MARKER}\n${normalizedBody}${END_MARKER}\n`;

  if (current === null) {
    return { next: block, result: { action: "created" } };
  }

  const startIdx = current.indexOf(`${START_MARKER}\n`);
  // Search for END from the start marker forward so a stray reversed marker
  // pair (END appearing before START) falls through to the prepend+warn path
  // instead of corrupting the splice region.
  const endIdx = startIdx === -1
    ? -1
    : current.indexOf(`${END_MARKER}\n`, startIdx);

  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = current.slice(0, startIdx);
    const after = current.slice(endIdx + `${END_MARKER}\n`.length);
    const next = before + block + after;
    if (next === current) {
      return { next, result: { action: "noop" } };
    }
    return { next, result: { action: "replaced" } };
  }

  // No markers: prepend with a blank line separating from existing content.
  // Existing managed-target keys (model, mcp_servers.*, ...) will now duplicate
  // and TOML parsing will fail until the user removes them manually.
  const separator = current.startsWith("\n") || current.length === 0 ? "" : "\n";
  const next = block + separator + current;
  return {
    next,
    result: {
      action: "prepended",
      warning:
        "Managed block prepended above existing content. Remove duplicate top-level keys / sections from the unmanaged tail (model, model_reasoning_*, sandbox_mode, notify, personality, web_search, [features], [sandbox_workspace_write], [mcp_servers.chrome-devtools]) before next Codex CLI run, or TOML parsing will fail.",
    },
  };
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await Deno.readTextFile(path);
  } catch (err) {
    if (err instanceof Deno.errors.NotFound) return null;
    throw err;
  }
}

async function main(): Promise<number> {
  const [managedPath, targetPath] = Deno.args;
  if (!managedPath || !targetPath) {
    console.error("usage: apply-managed.ts <managed-toml-path> <target-path>");
    return 2;
  }

  const managedBody = await Deno.readTextFile(managedPath);
  const current = await readIfExists(targetPath);
  const { next, result } = spliceContent(current, managedBody);

  if (result.action !== "noop") {
    await Deno.writeTextFile(targetPath, next);
  }
  if (result.warning) {
    console.error(`[codex-config] ${result.warning}`);
  }
  console.error(`[codex-config] ${result.action}: ${targetPath}`);
  return 0;
}

if (import.meta.main) {
  const code = await main();
  if (code !== 0) Deno.exit(code);
}
