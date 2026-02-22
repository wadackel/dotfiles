#!/usr/bin/env -S deno run --allow-read --allow-write --allow-env=HOME

// ================================================================
// Settings Merger - Merge .claude/settings.local.json to global settings
// ================================================================

const PROJECT_LOCAL_SETTINGS = "./.claude/settings.local.json";

// ================================================================
// Pure functions (exported for testing)
// ================================================================

/** Normalize deprecated ":*)" suffix to " *)" */
export function normalizeRule(rule: string): string {
  return rule.replace(/:(\*)(\))/g, " $1$2");
}

/** Normalize, deduplicate, and sort a list of rules */
export function canonicalizeRules(rules: string[]): string[] {
  return [...new Set(rules.map(normalizeRule))].sort();
}

/** Extract permissions.allow from parsed settings JSON */
export function extractAllowRules(settings: unknown): string[] {
  if (
    settings !== null &&
    typeof settings === "object" &&
    "permissions" in settings &&
    settings.permissions !== null &&
    typeof settings.permissions === "object" &&
    "allow" in settings.permissions &&
    Array.isArray(settings.permissions.allow)
  ) {
    return (settings.permissions.allow as unknown[]).filter(
      (r): r is string => typeof r === "string",
    );
  }
  return [];
}

/** Compute rules in localRules that are not already in existingRules (after normalization) */
export function calculateDiff(
  localRules: string[],
  existingRules: string[],
): string[] {
  const normalizedExisting = new Set(existingRules.map(normalizeRule));
  return localRules
    .map(normalizeRule)
    .filter((r) => !normalizedExisting.has(r));
}

/** Merge incoming rules into existing rules (normalize, deduplicate, sort) */
export function mergeAllowRules(
  existing: string[],
  incoming: string[],
): string[] {
  return canonicalizeRules([...existing, ...incoming]);
}

// ================================================================
// I/O helpers
// ================================================================

function readJsonFile(path: string): unknown {
  const text = Deno.readTextFileSync(path);
  return JSON.parse(text);
}

function writeJsonFile(path: string, data: unknown): void {
  // Write through symlink: resolve the real path then write
  const realPath = Deno.realPathSync(path);
  Deno.writeTextFileSync(realPath, JSON.stringify(data, null, 2) + "\n");
}

// ================================================================
// Output helpers
// ================================================================

type Result =
  | { status: "proposal"; new_rules: string[]; new_rules_count: number; project_path: string; user_settings_path: string }
  | { status: "noop"; message: string }
  | { status: "success"; applied_count: number; message: string }
  | { status: "error"; error_type: string; message: string };

function output(result: Result): void {
  console.log(JSON.stringify(result));
}

function die(error_type: string, message: string): never {
  output({ status: "error", error_type, message });
  Deno.exit(1);
}

// ================================================================
// Modes
// ================================================================

function proposalMode(userSettingsPath: string): void {
  // Read local settings
  let localSettings: unknown;
  try {
    localSettings = readJsonFile(PROJECT_LOCAL_SETTINGS);
  } catch {
    die("no_local_settings", ".claude/settings.local.json が見つかりません");
  }

  const localRules = extractAllowRules(localSettings);
  if (localRules.length === 0) {
    die("no_local_rules", ".claude/settings.local.json に permissions.allow が見つかりません");
  }

  // Read global settings
  let globalSettings: unknown;
  try {
    globalSettings = readJsonFile(userSettingsPath);
  } catch {
    die("no_user_settings", "~/.claude/settings.json が見つかりません");
  }

  const existingRules = extractAllowRules(globalSettings);

  // Compute diff
  const newRules = canonicalizeRules(calculateDiff(localRules, existingRules));

  if (newRules.length === 0) {
    output({ status: "noop", message: "新規ルールはありません（すべて既存）" });
    return;
  }

  output({
    status: "proposal",
    new_rules: newRules,
    new_rules_count: newRules.length,
    project_path: Deno.cwd(),
    user_settings_path: userSettingsPath,
  });
}

function applyMode(rulesJsonArg: string, userSettingsPath: string): void {
  // Parse incoming rules
  let incomingRules: unknown;
  try {
    incomingRules = JSON.parse(rulesJsonArg);
  } catch {
    die("invalid_rules", "Invalid rules JSON");
  }

  if (!Array.isArray(incomingRules)) {
    die("invalid_rules", "Rules must be a JSON array");
  }

  const rules = (incomingRules as unknown[]).filter(
    (r): r is string => typeof r === "string",
  );

  const canonicalized = canonicalizeRules(rules);
  if (canonicalized.length === 0) {
    die("no_rules", "No rules to apply");
  }

  // Read global settings
  let globalSettings: unknown;
  try {
    globalSettings = readJsonFile(userSettingsPath);
  } catch {
    die("no_user_settings", "~/.claude/settings.json が見つかりません");
  }

  // Merge and write
  const existingRules = extractAllowRules(globalSettings);
  const merged = mergeAllowRules(existingRules, canonicalized);

  const updated = {
    ...(globalSettings as Record<string, unknown>),
    permissions: {
      ...((globalSettings as Record<string, unknown>).permissions as Record<string, unknown> ?? {}),
      allow: merged,
    },
  };

  try {
    writeJsonFile(userSettingsPath, updated);
  } catch (e) {
    die("write_failed", `設定ファイルの更新に失敗しました: ${e}`);
  }

  output({
    status: "success",
    applied_count: canonicalized.length,
    message: `${canonicalized.length}件のルールを追加しました`,
  });
}

// ================================================================
// Entry point
// ================================================================

if (import.meta.main) {
  const claudeHome = `${Deno.env.get("HOME")}/.claude`;
  const userSettingsPath = `${claudeHome}/settings.json`;

  const mode = Deno.args[0];

  if (mode === "--apply") {
    const rulesJson = Deno.args[1];
    if (!rulesJson) {
      die("missing_rules", "Usage: merge.ts --apply '<rules_json>'");
    }
    applyMode(rulesJson, userSettingsPath);
  } else {
    proposalMode(userSettingsPath);
  }
}
