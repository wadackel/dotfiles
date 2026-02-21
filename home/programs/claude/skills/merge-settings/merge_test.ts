import { assertEquals } from "jsr:@std/assert";
import {
  calculateDiff,
  canonicalizeRules,
  extractAllowRules,
  mergeAllowRules,
  normalizeRule,
} from "./merge.ts";

// ----------------------------------------------------------------
// normalizeRule
// ----------------------------------------------------------------

Deno.test("normalizeRule: converts deprecated :*) to space *)", () => {
  assertEquals(normalizeRule("Bash(tmux:*)"), "Bash(tmux *)");
});

Deno.test("normalizeRule: preserves already-correct form", () => {
  assertEquals(normalizeRule("Bash(git commit *)"), "Bash(git commit *)");
});

Deno.test("normalizeRule: does not touch non-wildcard colons (WebFetch domain)", () => {
  assertEquals(
    normalizeRule("WebFetch(domain:example.com)"),
    "WebFetch(domain:example.com)",
  );
});

Deno.test("normalizeRule: handles hyphenated command names", () => {
  assertEquals(normalizeRule("Bash(nix-store:*)"), "Bash(nix-store *)");
});

Deno.test("normalizeRule: handles subcommand with space before :*)", () => {
  assertEquals(
    normalizeRule("Bash(nix flake check:*)"),
    "Bash(nix flake check *)",
  );
});

Deno.test("normalizeRule: handles exact command without wildcard (no change)", () => {
  assertEquals(normalizeRule("Bash(whoami)"), "Bash(whoami)");
});

// ----------------------------------------------------------------
// canonicalizeRules
// ----------------------------------------------------------------

Deno.test("canonicalizeRules: deduplicates identical rules", () => {
  assertEquals(canonicalizeRules(["a", "b", "a"]), ["a", "b"]);
});

Deno.test("canonicalizeRules: sorts rules alphabetically", () => {
  assertEquals(canonicalizeRules(["b", "a", "c"]), ["a", "b", "c"]);
});

Deno.test("canonicalizeRules: normalizes and deduplicates :*) and space* variants", () => {
  assertEquals(
    canonicalizeRules(["Bash(tmux *)", "Bash(tmux:*)"]),
    ["Bash(tmux *)"],
  );
});

Deno.test("canonicalizeRules: empty array returns empty", () => {
  assertEquals(canonicalizeRules([]), []);
});

// ----------------------------------------------------------------
// extractAllowRules
// ----------------------------------------------------------------

Deno.test("extractAllowRules: extracts allow array from valid settings", () => {
  const settings = {
    permissions: { allow: ["Bash(git *)", "Bash(rg *)"], deny: [] },
  };
  assertEquals(extractAllowRules(settings), ["Bash(git *)", "Bash(rg *)"]);
});

Deno.test("extractAllowRules: returns empty when permissions.allow absent", () => {
  assertEquals(extractAllowRules({ permissions: { deny: [] } }), []);
});

Deno.test("extractAllowRules: returns empty when permissions absent", () => {
  assertEquals(extractAllowRules({ env: {} }), []);
});

Deno.test("extractAllowRules: returns empty for null/non-object", () => {
  assertEquals(extractAllowRules(null), []);
  assertEquals(extractAllowRules("string"), []);
});

Deno.test("extractAllowRules: filters out non-string elements", () => {
  const settings = {
    permissions: { allow: ["Bash(git *)", 42, null, "Bash(rg *)"] },
  };
  assertEquals(extractAllowRules(settings), ["Bash(git *)", "Bash(rg *)"]);
});

// ----------------------------------------------------------------
// calculateDiff
// ----------------------------------------------------------------

Deno.test("calculateDiff: returns rules in local that are not in existing", () => {
  assertEquals(
    calculateDiff(["a", "b", "c"], ["a", "c"]),
    ["b"],
  );
});

Deno.test("calculateDiff: returns empty when all local rules exist", () => {
  assertEquals(calculateDiff(["a", "b"], ["a", "b"]), []);
});

Deno.test("calculateDiff: treats :*) and space* as equivalent (no duplicate)", () => {
  assertEquals(
    calculateDiff(["Bash(rg:*)"], ["Bash(rg *)"]),
    [],
  );
});

Deno.test("calculateDiff: treats space* and :*) as equivalent (no duplicate)", () => {
  assertEquals(
    calculateDiff(["Bash(tmux *)"], ["Bash(tmux:*)"]),
    [],
  );
});

Deno.test("calculateDiff: returns all local rules when existing is empty", () => {
  assertEquals(calculateDiff(["a", "b"], []), ["a", "b"]);
});

Deno.test("calculateDiff: normalizes results", () => {
  // local has deprecated form; diff result should be normalized
  const diff = calculateDiff(["Bash(screen:*)"], []);
  assertEquals(diff, ["Bash(screen *)"]);
});

// ----------------------------------------------------------------
// mergeAllowRules
// ----------------------------------------------------------------

Deno.test("mergeAllowRules: merges, deduplicates, and sorts", () => {
  assertEquals(
    mergeAllowRules(["Bash(rg *)", "Bash(git *)"], ["Bash(tmux *)", "Bash(git *)"]),
    ["Bash(git *)", "Bash(rg *)", "Bash(tmux *)"],
  );
});

Deno.test("mergeAllowRules: normalizes :*) in incoming rules", () => {
  assertEquals(
    mergeAllowRules(["Bash(tmux *)"], ["Bash(screen:*)"]),
    ["Bash(screen *)", "Bash(tmux *)"],
  );
});

Deno.test("mergeAllowRules: deduplicates :*) and space* variants across existing and incoming", () => {
  assertEquals(
    mergeAllowRules(["Bash(rg *)"], ["Bash(rg:*)"]),
    ["Bash(rg *)"],
  );
});
