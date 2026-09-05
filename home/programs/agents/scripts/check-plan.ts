#!/usr/bin/env -S deno run --allow-read --no-prompt

// Deterministic lint for /plan output. Both plan skills run it right after DRAFT
// and again before ACTIVATE.
//
// Usage:
//   check-plan.ts <plan.md> [--json]
//
// Exit 0: no error (warnings allowed). Exit 1: at least one error — the plan
// cannot be activated. Exit 2: input error (missing file, directory).
//
// Unlike writing-metrics/lint.ts, findings drive the exit code: this is a gate
// on the plan-body contract, not a readability hint.
//
// Line-number anchors (`file.md:12`) are deliberately not checked: measured on
// nineteen real plans, an anchor range check produced zero errors and dozens of
// warnings on deliberate path abbreviations, and the anchor mistakes that
// actually surfaced were bare `:N` references and ranges that pointed at the
// wrong prose — neither is decidable from the plan file. Meaning-level checks
// (whether a Self-resolved claim is true, whether a `[live]` item is required)
// stay with the critic and the adversarial agent.

const REQUIRED_SECTIONS = [
  "## Context",
  "## Files to Change",
  "## Task Outline",
  "## Completion Criteria",
  "### Autonomous Verification",
  "### Requires User Confirmation",
  "### Baseline",
];
const AV_TAGS = ["[file-state]", "[orchestrator-only]", "[live]", "[outcome]"];
const RUC_LABELS = [
  "Observe:",
  "Why not autonomous:",
  "Needs:",
  "Your steps:",
  "Needed by:",
] as const;
type RucLabel = (typeof RUC_LABELS)[number];
// Same vocabulary as the item template pinned in plan/SKILL.md; change both.
const NEEDS_VOCAB = [
  "sudo",
  "auth",
  "dialog",
  "role switch",
  "dev server",
  "real PR",
  "device",
  "interactive session",
];
const NEEDED_BY_PREFIXES = ["task ", "final gate", "next real run"];

export type Severity = "error" | "warn";
export type Finding = {
  line: number;
  severity: Severity;
  rule: string;
  message: string;
};

function fail(msg: string): never {
  console.error(`check-plan.ts: ${msg}`);
  Deno.exit(2);
}

type Line = { no: number; text: string };

// Fenced blocks may contain heading-shaped and bullet-shaped lines (templates,
// report skeletons), so every rule sees only the lines outside them. Trailing
// whitespace and CR are dropped here because the heading and `None` checks
// compare whole lines, and a stray space would otherwise fail the gate.
function outsideFences(lines: string[]): Line[] {
  const out: Line[] = [];
  let inFence = false;
  lines.forEach((raw, i) => {
    const text = raw.trimEnd();
    if (/^\s*(```|~~~)/.test(text)) {
      inFence = !inFence;
      return;
    }
    if (!inFence) out.push({ no: i + 1, text });
  });
  return out;
}

// Headings match the whole line, so `### Requires User Confirmation item
// format` does not open the Requires User Confirmation section.
function section(
  lines: Line[],
  heading: string,
): { headingLine: number; body: Line[] } | undefined {
  const level = heading.match(/^#+/)![0].length;
  const start = lines.findIndex((l) => l.text === heading);
  if (start < 0) return undefined;
  const body: Line[] = [];
  for (const l of lines.slice(start + 1)) {
    const m = l.text.match(/^(#+) /);
    if (m && m[1].length <= level) break;
    body.push(l);
  }
  return { headingLine: lines[start].no, body };
}

// Continuation lines are joined into the bullet so a five-field item may wrap;
// a blank line ends it so a trailing paragraph is not swallowed.
function bullets(body: Line[]): Line[] {
  const items: Line[] = [];
  let current: Line | undefined;
  for (const l of body) {
    const m = l.text.match(/^\s*-[ \t]+(.*)$/);
    if (m) {
      if (current) items.push(current);
      current = { no: l.no, text: m[1].trim() };
    } else if (l.text.trim() === "") {
      if (current) items.push(current);
      current = undefined;
    } else if (current) {
      current.text += " " + l.text.trim();
    }
  }
  if (current) items.push(current);
  return items;
}

function checkRucItem(item: Line, findings: Finding[]): void {
  const text = item.text.replace(/^\[(live|orchestrator-only)\]\s*/, "");
  if (text === item.text) {
    findings.push({
      line: item.no,
      severity: "error",
      rule: "ruc-format",
      message: "item must start with [live] or [orchestrator-only]",
    });
  }
  let cursor = 0;
  const positions = new Map<RucLabel, number>();
  for (const label of RUC_LABELS) {
    const idx = text.indexOf(label, cursor);
    if (idx < 0) {
      findings.push({
        line: item.no,
        severity: "error",
        rule: "ruc-format",
        message: `label ${label} missing or out of order`,
      });
      return;
    }
    positions.set(label, idx);
    cursor = idx + label.length;
  }
  const field = (label: RucLabel) => {
    const i = RUC_LABELS.indexOf(label);
    const next = RUC_LABELS.at(i + 1);
    return text.slice(
      positions.get(label)! + label.length,
      next ? positions.get(next) : undefined,
    ).replace(/\s*\/\s*$/, "").trim();
  };
  const needs = field("Needs:").split(/[,|]/).map((s) => s.trim()).filter(
    Boolean,
  );
  const badNeeds = needs.filter((n) => !NEEDS_VOCAB.includes(n));
  if (needs.length === 0 || badNeeds.length > 0) {
    findings.push({
      line: item.no,
      severity: "error",
      rule: "ruc-format",
      message: `Needs: must list values from ${NEEDS_VOCAB.join(" | ")}` +
        (badNeeds.length ? ` (got ${badNeeds.join(", ")})` : ""),
    });
  }
  const neededBy = field("Needed by:");
  if (!NEEDED_BY_PREFIXES.some((p) => neededBy.startsWith(p))) {
    findings.push({
      line: item.no,
      severity: "error",
      rule: "ruc-format",
      message:
        "Needed by: must be task N, final gate, or next real run <trigger>",
    });
  }
}

export function checkPlan(source: string): Finding[] {
  const findings: Finding[] = [];
  const lines = outsideFences(source.split("\n"));
  for (const heading of REQUIRED_SECTIONS) {
    if (!lines.some((l) => l.text === heading)) {
      findings.push({
        line: 0,
        severity: "error",
        rule: "section-missing",
        message: `${heading} not found`,
      });
    }
  }
  const av = section(lines, "### Autonomous Verification");
  if (av) {
    const items = bullets(av.body);
    for (const item of items) {
      if (!AV_TAGS.some((t) => item.text.startsWith(t))) {
        findings.push({
          line: item.no,
          severity: "error",
          rule: "av-tag-missing",
          message: `bullet must start with one of ${AV_TAGS.join(" ")}`,
        });
      }
    }
    if (!items.some((i) => i.text.startsWith("[live]"))) {
      findings.push({
        line: av.headingLine,
        severity: "warn",
        rule: "live-missing",
        message: "no [live] item under Autonomous Verification",
      });
    }
  }
  const ruc = section(lines, "### Requires User Confirmation");
  if (ruc) {
    const items = bullets(ruc.body);
    if (items.length === 0) {
      findings.push({
        line: ruc.headingLine,
        severity: "error",
        rule: "ruc-format",
        message: "section must contain `- None` or five-field items",
      });
    }
    for (const item of items) {
      if (item.text === "None") continue;
      checkRucItem(item, findings);
    }
  }
  return findings.sort((a, b) => a.line - b.line);
}

if (import.meta.main) {
  const asJson = Deno.args.includes("--json");
  const args = Deno.args.filter((a) => a !== "--json");
  if (args.length !== 1) fail("usage: check-plan.ts <plan.md> [--json]");
  const path = args[0];
  let source: string;
  try {
    if ((await Deno.stat(path)).isDirectory) fail(`directory given: ${path}`);
    source = await Deno.readTextFile(path);
  } catch (e) {
    fail(
      `cannot read: ${path} (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  const findings = checkPlan(source);
  const errors = findings.filter((f) => f.severity === "error").length;
  const warnings = findings.length - errors;
  if (asJson) {
    console.log(JSON.stringify(findings, null, 2));
  } else {
    for (const f of findings) {
      console.log(`${f.line}:[${f.severity}] ${f.rule}: ${f.message}`);
    }
    console.log(`${errors} errors, ${warnings} warnings`);
  }
  Deno.exit(errors > 0 ? 1 : 0);
}
