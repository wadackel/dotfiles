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

/**
 * Match a glob pattern against a text string.
 * Only `*` wildcard is supported (matches any sequence of characters).
 * Uses regex internally: escape regex special chars, then replace * with .*
 */
export function globMatch(pattern: string, text: string): boolean {
  // (1) escape regex special characters
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  // (2) replace glob * with regex .*
  const regexStr = escaped.replace(/\*/g, ".*");
  // (3) anchor to full string
  const regex = new RegExp(`^${regexStr}$`);
  return regex.test(text);
}

/**
 * Check if a rule is subsumed by any existing rule.
 * Returns the first subsuming rule if found, null otherwise.
 *
 * Only handles Bash(...) rules. A rule is subsumed if the global rule's
 * inner pattern (with wildcards) matches the local rule's inner content.
 *
 * Examples:
 * - "Bash(deno *)" subsumes "Bash(deno test *)" → inner glob "deno *" matches "deno test *"
 * - "Bash(* --help *)" subsumes "Bash(gemini --help *)" → inner glob "* --help *" matches "gemini --help *"
 * - "Bash(* -h *)" does NOT subsume "Bash(extract-session-history.ts)" → no space-bounded " -h "
 */
export function findSubsumingRule(
  rule: string,
  existingRules: string[],
): string | null {
  const normalized = normalizeRule(rule);

  // Only handle Bash(...) rules
  const innerMatch = normalized.match(/^Bash\((.+)\)$/);
  if (!innerMatch) return null;
  const localInner = innerMatch[1];

  for (const existing of existingRules) {
    const normExisting = normalizeRule(existing);

    // Skip exact match (calculateDiff already handles these)
    if (normExisting === normalized) continue;

    // Only wildcard-containing existing rules can subsume
    const existingInner = normExisting.match(/^Bash\((.+)\)$/)?.[1];
    if (!existingInner || !existingInner.includes("*")) continue;

    if (globMatch(existingInner, localInner)) {
      return normExisting;
    }
  }

  return null;
}

/**
 * Remove specified rules from a settings object's permissions.allow.
 * Uses normalizeRule for comparison (handles deprecated :*) syntax).
 * Returns the updated settings object. Never returns null — preserves the file
 * even if allow becomes empty.
 */
export function removeRulesFromSettings(
  settings: unknown,
  rulesToRemove: string[],
): unknown {
  if (
    settings === null ||
    typeof settings !== "object" ||
    !("permissions" in settings)
  ) {
    return settings;
  }

  const s = settings as Record<string, unknown>;
  const perms = s.permissions as Record<string, unknown> | null;
  if (!perms) return settings;

  const currentAllow = extractAllowRules(settings);
  const removeSet = new Set(rulesToRemove.map(normalizeRule));

  const filteredAllow = currentAllow.filter(
    (r) => !removeSet.has(normalizeRule(r)),
  );

  return {
    ...s,
    permissions: {
      ...perms,
      allow: filteredAllow,
    },
  };
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
  | {
      status: "proposal";
      new_rules: string[];
      new_rules_count: number;
      subsumed_rules: Array<{ rule: string; subsumed_by: string }>;
      subsumed_count: number;
      project_path: string;
      user_settings_path: string;
    }
  | { status: "noop"; message: string }
  | { status: "applied"; applied_count: number; message: string }
  | { status: "cleaned"; cleaned_count: number; message: string }
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

  // Compute diff (rules in local that are not exact-matched in global)
  const diffRules = canonicalizeRules(calculateDiff(localRules, existingRules));

  if (diffRules.length === 0) {
    output({ status: "noop", message: "新規ルールはありません（すべて既存）" });
    return;
  }

  // Partition into subsumed vs genuinely new
  const newRules: string[] = [];
  const subsumedRules: Array<{ rule: string; subsumed_by: string }> = [];

  for (const rule of diffRules) {
    const subsumer = findSubsumingRule(rule, existingRules);
    if (subsumer) {
      subsumedRules.push({ rule, subsumed_by: subsumer });
    } else {
      newRules.push(rule);
    }
  }

  output({
    status: "proposal",
    new_rules: newRules,
    new_rules_count: newRules.length,
    subsumed_rules: subsumedRules,
    subsumed_count: subsumedRules.length,
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

  // Merge and calculate actual diff
  const existingRules = extractAllowRules(globalSettings);
  const normalizedExistingCount = canonicalizeRules(existingRules).length;
  const merged = mergeAllowRules(existingRules, canonicalized);
  const actuallyAdded = merged.length - normalizedExistingCount;

  if (actuallyAdded === 0) {
    output({ status: "noop", message: "新規ルールはありません（すべて既存）" });
    return;
  }

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
    status: "applied",
    applied_count: actuallyAdded,
    message: `${actuallyAdded}件のルールを追加しました`,
  });
}

function cleanupMode(rulesJsonArg: string): void {
  // Parse rules to remove
  let rulesToRemove: unknown;
  try {
    rulesToRemove = JSON.parse(rulesJsonArg);
  } catch {
    die("invalid_rules", "Invalid rules JSON");
  }

  if (!Array.isArray(rulesToRemove)) {
    die("invalid_rules", "Rules must be a JSON array");
  }

  const rules = (rulesToRemove as unknown[]).filter(
    (r): r is string => typeof r === "string",
  );

  // Read local settings
  let localSettings: unknown;
  try {
    localSettings = readJsonFile(PROJECT_LOCAL_SETTINGS);
  } catch {
    die("no_local_settings", ".claude/settings.local.json が見つかりません");
  }

  const before = extractAllowRules(localSettings);
  const updated = removeRulesFromSettings(localSettings, rules);
  const after = extractAllowRules(updated);
  const cleanedCount = before.length - after.length;

  if (cleanedCount === 0) {
    output({ status: "noop", message: "削除対象のルールはありません" });
    return;
  }

  try {
    // Write directly (local file, not symlinked)
    Deno.writeTextFileSync(
      PROJECT_LOCAL_SETTINGS,
      JSON.stringify(updated, null, 2) + "\n",
    );
  } catch (e) {
    die("write_failed", `ローカル設定ファイルの更新に失敗しました: ${e}`);
  }

  output({
    status: "cleaned",
    cleaned_count: cleanedCount,
    message: `${cleanedCount}件のルールをローカル設定から削除しました`,
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
  } else if (mode === "--cleanup") {
    const rulesJson = Deno.args[1];
    if (!rulesJson) {
      die("missing_rules", "Usage: merge.ts --cleanup '<rules_json>'");
    }
    cleanupMode(rulesJson);
  } else {
    proposalMode(userSettingsPath);
  }
}
