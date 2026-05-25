#!/usr/bin/env -S deno run --allow-env=HOME --allow-read --allow-write --allow-run

/**
 * retrospective-ledger.ts — Outcome-tracking ledger for the session-retrospective skill.
 *
 * Replaces the former instincts.ts. Extended schema tracks not only atomic rules
 * but also the proposals derived from those rules and the outcomes observed in
 * subsequent sessions, closing the feedback loop that session-retrospective v3
 * relies on.
 *
 * Subcommands:
 *   add --rule "..." --domain "..." [--session "..."]
 *   reinforce <id>
 *   list [--min-confidence N]
 *   prune
 *   promote
 *   mark-promoted <id> [section]
 *   record-proposal <id> --layer hook|permissions|skill|claude_md \
 *                        --target <path> --plan <json> [--expiry "..."]
 *   verify --transcript <path> [--dry-run]
 */

const LEDGER_PATH = `${Deno.env.get("HOME")}/.claude/retrospective-ledger.jsonl`;

// --- Types ---

type EnforcementLayer = "hook" | "permissions" | "skill" | "claude_md";

type VerificationPlan =
  | { type: "transcript_grep"; pattern: string; expected: "absent" | "present" }
  | {
    type: "git_log_grep";
    pattern: string;
    expected: "absent" | "present";
    since_days?: number;
  }
  | { type: "file_exists"; path: string; expected: boolean };

interface ProposalRecord {
  proposed_at: string;
  session_id: string;
  enforcement_layer: EnforcementLayer;
  target_file: string;
  verification_plan: VerificationPlan;
  expiry_condition: string | null;
}

interface OutcomeRecord {
  session_id: string;
  checked_at: string;
  result: "prevented" | "recurred" | "not-applicable";
  evidence: string;
}

export interface LedgerEntry {
  id: string;
  rule: string;
  status: "active" | "promoted" | "pruned";
  confidence: number;
  domain: string;
  source_sessions: string[];
  created: string;
  last_reinforced: string;
  promoted_at: string | null;
  claude_md_section: string | null;
  proposals: ProposalRecord[];
  outcomes: OutcomeRecord[];
}

// --- Helpers ---

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function generateId(): string {
  const n = Math.floor(Math.random() * 100000);
  return `inst-${String(n).padStart(5, "0")}`;
}

export function readLedger(path: string): LedgerEntry[] {
  try {
    const text = Deno.readTextFileSync(path);
    return text
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as LedgerEntry);
  } catch {
    return [];
  }
}

export function writeLedger(path: string, entries: LedgerEntry[]): void {
  const text = entries.map((e) => JSON.stringify(e)).join("\n") + "\n";
  Deno.writeTextFileSync(path, text);
}

export function findSimilar(
  entries: LedgerEntry[],
  rule: string,
): LedgerEntry | undefined {
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, "");
  const normalized = normalize(rule);
  return entries.find((e) => {
    if (e.status === "pruned") return false;
    const n = normalize(e.rule);
    const words1 = new Set(normalized.split(/\s+/).filter((w) => w.length > 2));
    const words2 = new Set(n.split(/\s+/).filter((w) => w.length > 2));
    if (words1.size === 0 || words2.size === 0) return false;
    const intersection = [...words1].filter((w) => words2.has(w));
    const overlap = intersection.length / Math.min(words1.size, words2.size);
    return overlap > 0.5;
  });
}

function clampConfidence(c: number): number {
  return Math.round(Math.min(0.9, Math.max(0, c)) * 100) / 100;
}

// --- Confidence deltas (outcome-driven) ---

const DELTA_PREVENTED = 0.05;
const DELTA_RECURRED = -0.2;
const DELTA_NOT_APPLICABLE_STREAK = -0.1;
const NOT_APPLICABLE_STREAK_THRESHOLD = 5;

export function applyOutcome(
  entry: LedgerEntry,
  outcome: OutcomeRecord,
): LedgerEntry {
  entry.outcomes.push(outcome);
  let delta = 0;
  if (outcome.result === "prevented") delta = DELTA_PREVENTED;
  else if (outcome.result === "recurred") delta = DELTA_RECURRED;
  else if (outcome.result === "not-applicable") {
    // Look at trailing consecutive not-applicable count
    let streak = 0;
    for (let i = entry.outcomes.length - 1; i >= 0; i--) {
      if (entry.outcomes[i].result === "not-applicable") streak++;
      else break;
    }
    if (streak >= NOT_APPLICABLE_STREAK_THRESHOLD && streak % NOT_APPLICABLE_STREAK_THRESHOLD === 0) {
      delta = DELTA_NOT_APPLICABLE_STREAK;
    }
  }
  entry.confidence = clampConfidence(entry.confidence + delta);
  entry.last_reinforced = today();
  return entry;
}

// --- Verification plan execution ---

export function executeTranscriptGrep(
  plan: Extract<VerificationPlan, { type: "transcript_grep" }>,
  transcriptPath: string,
): "prevented" | "recurred" | "not-applicable" {
  let text: string;
  try {
    text = Deno.readTextFileSync(transcriptPath);
  } catch {
    return "not-applicable";
  }
  const re = new RegExp(plan.pattern);
  const found = re.test(text);
  if (plan.expected === "absent") {
    return found ? "recurred" : "prevented";
  }
  return found ? "prevented" : "recurred";
}

// --- Subcommands ---

function cmdAdd(args: string[]): void {
  let rule = "";
  let domain = "workflow";
  let session = "unknown";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rule" && i + 1 < args.length) rule = args[++i];
    else if (args[i] === "--domain" && i + 1 < args.length) domain = args[++i];
    else if (args[i] === "--session" && i + 1 < args.length) session = args[++i];
  }

  if (!rule) {
    console.error("Error: --rule is required");
    Deno.exit(1);
  }

  const entries = readLedger(LEDGER_PATH);
  const similar = findSimilar(entries, rule);

  if (similar) {
    console.log(`Similar entry found: ${similar.id} (confidence: ${similar.confidence})`);
    console.log(`  "${similar.rule}"`);
    console.log(`Reinforcing instead of creating new.`);
    similar.confidence = clampConfidence(similar.confidence + 0.1);
    similar.last_reinforced = today();
    if (!similar.source_sessions.includes(session)) {
      similar.source_sessions.push(session);
    }
    writeLedger(LEDGER_PATH, entries);
    console.log(`Updated confidence: ${similar.confidence}`);
    return;
  }

  const entry: LedgerEntry = {
    id: generateId(),
    rule,
    status: "active",
    confidence: 0.5,
    domain,
    source_sessions: [session],
    created: today(),
    last_reinforced: today(),
    promoted_at: null,
    claude_md_section: null,
    proposals: [],
    outcomes: [],
  };

  entries.push(entry);
  writeLedger(LEDGER_PATH, entries);
  console.log(`Created entry: ${entry.id} (confidence: 0.5)`);
  console.log(`  "${rule}"`);
}

function cmdReinforce(args: string[]): void {
  const id = args[0];
  if (!id) {
    console.error("Error: entry id is required");
    Deno.exit(1);
  }

  const entries = readLedger(LEDGER_PATH);
  const entry = entries.find((e) => e.id === id);
  if (!entry) {
    console.error(`Error: entry ${id} not found`);
    Deno.exit(1);
  }
  if (entry.status !== "active") {
    console.error(`Error: entry ${id} is ${entry.status}, not active`);
    Deno.exit(1);
  }

  entry.confidence = clampConfidence(entry.confidence + 0.1);
  entry.last_reinforced = today();
  writeLedger(LEDGER_PATH, entries);
  console.log(`Reinforced ${id}: confidence ${entry.confidence} ("${entry.rule}")`);
}

function cmdList(args: string[]): void {
  let minConfidence = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--min-confidence" && i + 1 < args.length) {
      minConfidence = parseFloat(args[++i]);
    }
  }

  const entries = readLedger(LEDGER_PATH);
  const filtered = entries.filter(
    (e) => e.status !== "pruned" && e.confidence >= minConfidence,
  );

  if (filtered.length === 0) {
    console.log("No entries found.");
    return;
  }

  filtered.sort((a, b) => b.confidence - a.confidence);

  for (const e of filtered) {
    const status = e.status === "promoted" ? " [promoted]" : "";
    const props = e.proposals.length > 0 ? ` p=${e.proposals.length}` : "";
    const outs = e.outcomes.length > 0 ? ` o=${e.outcomes.length}` : "";
    console.log(`${e.id} (${e.confidence})${status} [${e.domain}]${props}${outs}`);
    console.log(`  "${e.rule}"`);
  }
  console.log(`\nTotal: ${filtered.length} entries`);
}

function cmdPrune(_args: string[]): void {
  const entries = readLedger(LEDGER_PATH);
  const toPrune = entries.filter(
    (e) => e.status === "active" && e.confidence <= 0.3,
  );

  if (toPrune.length === 0) {
    console.log("No entries to prune.");
    return;
  }

  for (const e of toPrune) {
    e.status = "pruned";
    console.log(`Pruned: ${e.id} (${e.confidence}) "${e.rule}"`);
  }

  writeLedger(LEDGER_PATH, entries);
  console.log(`\nPruned ${toPrune.length} entries.`);
}

function cmdPromote(_args: string[]): void {
  const entries = readLedger(LEDGER_PATH);
  const candidates = entries.filter(
    (e) => e.status === "active" && e.confidence >= 0.7,
  );

  if (candidates.length === 0) {
    console.log("No promotion candidates (need confidence >= 0.7).");
    return;
  }

  console.log("## CLAUDE.md Promotion Candidates\n");
  for (const e of candidates) {
    console.log(`- ${e.id} (${e.confidence}) [${e.domain}]`);
    console.log(`  Rule: "${e.rule}"`);
    console.log(`  Sessions: ${e.source_sessions.length}`);
    console.log();
  }
  console.log("To promote, add the rule to CLAUDE.md and run: retrospective-ledger.ts mark-promoted <id> <section>");
}

function cmdMarkPromoted(args: string[]): void {
  const id = args[0];
  const section = args.slice(1).join(" ") || "General";

  if (!id) {
    console.error("Error: entry id is required");
    Deno.exit(1);
  }

  const entries = readLedger(LEDGER_PATH);
  const entry = entries.find((e) => e.id === id);
  if (!entry) {
    console.error(`Error: entry ${id} not found`);
    Deno.exit(1);
  }

  entry.status = "promoted";
  entry.promoted_at = today();
  entry.claude_md_section = section;
  writeLedger(LEDGER_PATH, entries);
  console.log(`Promoted ${id} to CLAUDE.md section "${section}"`);
}

function cmdRecordProposal(args: string[]): void {
  let id = "";
  let layer: EnforcementLayer | "" = "";
  let target = "";
  let planJson = "";
  let expiry: string | null = null;
  let session = "unknown";

  for (let i = 0; i < args.length; i++) {
    if (i === 0 && !args[i].startsWith("--")) id = args[i];
    else if (args[i] === "--layer" && i + 1 < args.length) layer = args[++i] as EnforcementLayer;
    else if (args[i] === "--target" && i + 1 < args.length) target = args[++i];
    else if (args[i] === "--plan" && i + 1 < args.length) planJson = args[++i];
    else if (args[i] === "--expiry" && i + 1 < args.length) expiry = args[++i];
    else if (args[i] === "--session" && i + 1 < args.length) session = args[++i];
  }

  if (!id || !layer || !target || !planJson) {
    console.error("Error: record-proposal requires <id> --layer --target --plan");
    Deno.exit(1);
  }

  const entries = readLedger(LEDGER_PATH);
  const entry = entries.find((e) => e.id === id);
  if (!entry) {
    console.error(`Error: entry ${id} not found`);
    Deno.exit(1);
  }

  const plan = JSON.parse(planJson) as VerificationPlan;
  const proposal: ProposalRecord = {
    proposed_at: today(),
    session_id: session,
    enforcement_layer: layer as EnforcementLayer,
    target_file: target,
    verification_plan: plan,
    expiry_condition: expiry,
  };
  entry.proposals.push(proposal);
  writeLedger(LEDGER_PATH, entries);
  console.log(`Recorded proposal on ${id} (layer=${layer}, target=${target})`);
}

export function cmdVerify(args: string[]): void {
  let transcript = "";
  let dryRun = false;
  let session = "unknown";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--transcript" && i + 1 < args.length) transcript = args[++i];
    else if (args[i] === "--dry-run") dryRun = true;
    else if (args[i] === "--session" && i + 1 < args.length) session = args[++i];
  }

  const entries = readLedger(LEDGER_PATH);
  const active = entries.filter((e) => e.status === "active" && e.proposals.length > 0);

  if (active.length === 0) {
    console.log("No active entries with proposals to verify.");
    return;
  }

  console.log(`Verifying ${active.length} entries (dry-run=${dryRun})\n`);
  for (const entry of active) {
    const latest = entry.proposals[entry.proposals.length - 1];
    const plan = latest.verification_plan;

    let result: "prevented" | "recurred" | "not-applicable" = "not-applicable";
    let evidence = "";

    if (plan.type === "transcript_grep") {
      if (!transcript) {
        console.log(`${entry.id}: skipped (transcript_grep needs --transcript)`);
        continue;
      }
      result = executeTranscriptGrep(plan, transcript);
      evidence = `transcript_grep pattern=${plan.pattern} expected=${plan.expected}`;
    } else if (plan.type === "git_log_grep") {
      console.log(`${entry.id}: git_log_grep not yet implemented in v1 — treating as not-applicable`);
      evidence = "git_log_grep not-implemented";
    } else if (plan.type === "file_exists") {
      console.log(`${entry.id}: file_exists not yet implemented in v1 — treating as not-applicable`);
      evidence = "file_exists not-implemented";
    }

    console.log(`${entry.id}: ${result} — ${evidence}`);

    if (!dryRun) {
      applyOutcome(entry, {
        session_id: session,
        checked_at: today(),
        result,
        evidence,
      });
    }
  }

  if (!dryRun) {
    writeLedger(LEDGER_PATH, entries);
    console.log("\nOutcomes persisted.");
  } else {
    console.log("\n(dry-run — no changes written)");
  }
}

// --- Main ---

if (import.meta.main) {
  const [subcommand, ...args] = Deno.args;
  switch (subcommand) {
    case "add":
      cmdAdd(args);
      break;
    case "reinforce":
      cmdReinforce(args);
      break;
    case "list":
      cmdList(args);
      break;
    case "prune":
      cmdPrune(args);
      break;
    case "promote":
      cmdPromote(args);
      break;
    case "mark-promoted":
      cmdMarkPromoted(args);
      break;
    case "record-proposal":
      cmdRecordProposal(args);
      break;
    case "verify":
      cmdVerify(args);
      break;
    default:
      console.log(`Usage: retrospective-ledger.ts <subcommand> [args]

Commands:
  add --rule "..." --domain "..." [--session "..."]        Create or reinforce an entry
  reinforce <id>                                            Increase confidence by 0.1
  list [--min-confidence N]                                 List entries (filtered)
  prune                                                     Remove entries with confidence <= 0.3
  promote                                                   Show CLAUDE.md promotion candidates
  mark-promoted <id> [section]                              Mark entry as promoted
  record-proposal <id> --layer <L> --target <path>          Attach a proposal to an entry
                  --plan <json> [--expiry "..."]
  verify --transcript <path> [--dry-run] [--session <id>]   Auto-check proposals' outcomes`);
      Deno.exit(subcommand ? 1 : 0);
  }
}
