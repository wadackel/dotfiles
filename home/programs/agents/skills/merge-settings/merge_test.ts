import { assertEquals } from "jsr:@std/assert";
import {
  calculateDiff,
  canonicalizeRules,
  extractAllowRules,
  findSubsumingRule,
  globMatch,
  mergeAllowRules,
  normalizeRule,
  removeRulesFromSettings,
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

// ----------------------------------------------------------------
// globMatch
// ----------------------------------------------------------------

Deno.test("globMatch: * matches any characters", () => {
  assertEquals(globMatch("*", "anything here"), true);
  assertEquals(globMatch("*", ""), true);
});

Deno.test("globMatch: no wildcard is exact match", () => {
  assertEquals(globMatch("git commit", "git commit"), true);
  assertEquals(globMatch("git commit", "git commit -m"), false);
});

Deno.test("globMatch: trailing wildcard", () => {
  assertEquals(globMatch("git *", "git commit -m foo"), true);
  assertEquals(globMatch("git *", "git"), false);
});

Deno.test("globMatch: leading wildcard", () => {
  assertEquals(globMatch("* --help *", "gemini --help --verbose"), true);
  assertEquals(globMatch("* --help *", "gemini --help"), false);
});

Deno.test("globMatch: middle wildcard", () => {
  assertEquals(globMatch("nix * check", "nix flake check"), true);
  assertEquals(globMatch("nix * check", "nix check"), false);
});

Deno.test("globMatch: regex special characters in pattern are escaped", () => {
  assertEquals(globMatch("script.ts", "script.ts"), true);
  assertEquals(globMatch("script.ts", "scriptXts"), false);
  assertEquals(globMatch("Bash(git *)", "Bash(git commit *)"), true);
});

Deno.test("globMatch: false positive regression - * -h * does not match extract-session-history.ts", () => {
  assertEquals(globMatch("* -h *", "extract-session-history.ts"), false);
});

Deno.test("globMatch: * --version matches exact command without trailing wildcard", () => {
  assertEquals(globMatch("* --version", "node --version"), true);
  assertEquals(globMatch("* --version", "node --version --extra"), false);
});

// ----------------------------------------------------------------
// findSubsumingRule
// ----------------------------------------------------------------

Deno.test("findSubsumingRule: prefix subsumption - deno * subsumes deno test *", () => {
  assertEquals(
    findSubsumingRule("Bash(deno test *)", ["Bash(deno *)"]),
    "Bash(deno *)",
  );
});

Deno.test("findSubsumingRule: multi-level prefix", () => {
  assertEquals(
    findSubsumingRule(
      "Bash(nix-store --query --references *)",
      ["Bash(nix-store *)"],
    ),
    "Bash(nix-store *)",
  );
});

Deno.test("findSubsumingRule: leading wildcard - * --help * subsumes gemini --help *", () => {
  assertEquals(
    findSubsumingRule("Bash(gemini --help *)", ["Bash(* --help *)"]),
    "Bash(* --help *)",
  );
});

Deno.test("findSubsumingRule: leading wildcard exact suffix - * --version subsumes node --version", () => {
  assertEquals(
    findSubsumingRule("Bash(node --version)", ["Bash(* --version)"]),
    "Bash(* --version)",
  );
});

Deno.test("findSubsumingRule: false positive regression - * -h * does NOT subsume extract-session-history.ts", () => {
  assertEquals(
    findSubsumingRule("Bash(extract-session-history.ts)", ["Bash(* -h *)"]),
    null,
  );
});

Deno.test("findSubsumingRule: exact match is not subsumption", () => {
  assertEquals(
    findSubsumingRule("Bash(git *)", ["Bash(git *)"]),
    null,
  );
});

Deno.test("findSubsumingRule: handles deprecated :*) syntax in local rule", () => {
  assertEquals(
    findSubsumingRule("Bash(deno eval:*)", ["Bash(deno *)"]),
    "Bash(deno *)",
  );
});

Deno.test("findSubsumingRule: handles deprecated :*) syntax in existing rule", () => {
  assertEquals(
    findSubsumingRule("Bash(deno eval *)", ["Bash(deno:*)"]),
    "Bash(deno *)",
  );
});

Deno.test("findSubsumingRule: git-lfs is NOT subsumed by git", () => {
  assertEquals(
    findSubsumingRule("Bash(git-lfs *)", ["Bash(git *)"]),
    null,
  );
});

Deno.test("findSubsumingRule: nix-build is NOT subsumed by nix", () => {
  assertEquals(
    findSubsumingRule("Bash(nix-build *)", ["Bash(nix *)"]),
    null,
  );
});

Deno.test("findSubsumingRule: non-Bash rule returns null", () => {
  assertEquals(
    findSubsumingRule("WebFetch(domain:api.github.com)", ["WebFetch(domain:*.github.com)"]),
    null,
  );
});

Deno.test("findSubsumingRule: existing rule without wildcard cannot subsume", () => {
  assertEquals(
    findSubsumingRule("Bash(git commit *)", ["Bash(git status)"]),
    null,
  );
});

Deno.test("findSubsumingRule: exact command (no wildcard in local) is subsumed", () => {
  assertEquals(
    findSubsumingRule("Bash(git push)", ["Bash(git *)"]),
    "Bash(git *)",
  );
});

// ----------------------------------------------------------------
// removeRulesFromSettings
// ----------------------------------------------------------------

Deno.test("removeRulesFromSettings: removes specified rules", () => {
  const settings = {
    permissions: { allow: ["Bash(git *)", "Bash(rg *)", "Bash(tmux *)"], deny: [] },
  };
  const result = removeRulesFromSettings(settings, ["Bash(git *)", "Bash(tmux *)"]);
  assertEquals(result, {
    permissions: { allow: ["Bash(rg *)"], deny: [] },
  });
});

Deno.test("removeRulesFromSettings: normalized comparison - :*) and space* treated as equal", () => {
  const settings = {
    permissions: { allow: ["Bash(git:*)"], deny: [] },
  };
  const result = removeRulesFromSettings(settings, ["Bash(git *)"]);
  assertEquals(result, {
    permissions: { allow: [], deny: [] },
  });
});

Deno.test("removeRulesFromSettings: preserves file when allow becomes empty (no null)", () => {
  const settings = {
    permissions: { allow: ["Bash(git *)"], deny: [] },
  };
  const result = removeRulesFromSettings(settings, ["Bash(git *)"]);
  // File is preserved with empty allow, not deleted (not null)
  assertEquals(result, {
    permissions: { allow: [], deny: [] },
  });
});

Deno.test("removeRulesFromSettings: preserves other fields (sandbox, env)", () => {
  const settings = {
    permissions: { allow: ["Bash(git *)"], deny: [] },
    sandbox: { enabled: true },
  };
  const result = removeRulesFromSettings(settings, ["Bash(git *)"]);
  assertEquals(result, {
    permissions: { allow: [], deny: [] },
    sandbox: { enabled: true },
  });
});

Deno.test("removeRulesFromSettings: non-existent rule specification is harmless", () => {
  const settings = {
    permissions: { allow: ["Bash(git *)", "Bash(rg *)"], deny: [] },
  };
  const result = removeRulesFromSettings(settings, ["Bash(tmux *)"]);
  assertEquals(result, {
    permissions: { allow: ["Bash(git *)", "Bash(rg *)"], deny: [] },
  });
});

Deno.test("removeRulesFromSettings: handles non-object input gracefully", () => {
  assertEquals(removeRulesFromSettings(null, ["Bash(git *)"]), null);
  assertEquals(removeRulesFromSettings("string", ["Bash(git *)"]), "string");
});
