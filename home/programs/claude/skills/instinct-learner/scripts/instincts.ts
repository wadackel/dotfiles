#!/usr/bin/env -S deno run --allow-env=HOME --allow-read --allow-write

/**
 * instincts.ts — Atomic instinct CRUD for the instinct-learner skill
 *
 * Subcommands:
 *   add --rule "..." --domain "..." [--session "..."]
 *   reinforce <id>
 *   list [--min-confidence N]
 *   prune
 *   promote
 */

const INSTINCTS_PATH = `${Deno.env.get("HOME")}/.claude/instincts.jsonl`;

interface Instinct {
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
}

function today(): string {
  return new Date().toISOString().split("T")[0];
}

function generateId(): string {
  const n = Math.floor(Math.random() * 100000);
  return `inst-${String(n).padStart(5, "0")}`;
}

export function readInstincts(path: string): Instinct[] {
  try {
    const text = Deno.readTextFileSync(path);
    return text
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Instinct);
  } catch {
    return [];
  }
}

export function writeInstincts(path: string, instincts: Instinct[]): void {
  const text = instincts.map((i) => JSON.stringify(i)).join("\n") + "\n";
  Deno.writeTextFileSync(path, text);
}

export function findSimilar(
  instincts: Instinct[],
  rule: string,
): Instinct | undefined {
  const normalize = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, "");
  const normalized = normalize(rule);
  return instincts.find((i) => {
    if (i.status === "pruned") return false;
    const n = normalize(i.rule);
    // Simple similarity: check if either contains the other or >60% word overlap
    const words1 = new Set(normalized.split(/\s+/).filter((w) => w.length > 2));
    const words2 = new Set(n.split(/\s+/).filter((w) => w.length > 2));
    if (words1.size === 0 || words2.size === 0) return false;
    const intersection = [...words1].filter((w) => words2.has(w));
    const overlap =
      intersection.length / Math.min(words1.size, words2.size);
    return overlap > 0.5;
  });
}

function clampConfidence(c: number): number {
  return Math.round(Math.min(0.9, Math.max(0, c)) * 10) / 10;
}

function cmdAdd(args: string[]): void {
  let rule = "";
  let domain = "workflow";
  let session = "unknown";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--rule" && i + 1 < args.length) rule = args[++i];
    else if (args[i] === "--domain" && i + 1 < args.length) domain = args[++i];
    else if (args[i] === "--session" && i + 1 < args.length)
      session = args[++i];
  }

  if (!rule) {
    console.error("Error: --rule is required");
    Deno.exit(1);
  }

  const instincts = readInstincts(INSTINCTS_PATH);
  const similar = findSimilar(instincts, rule);

  if (similar) {
    console.log(
      `Similar instinct found: ${similar.id} (confidence: ${similar.confidence})`,
    );
    console.log(`  "${similar.rule}"`);
    console.log(`Reinforcing instead of creating new.`);
    similar.confidence = clampConfidence(similar.confidence + 0.1);
    similar.last_reinforced = today();
    if (!similar.source_sessions.includes(session)) {
      similar.source_sessions.push(session);
    }
    writeInstincts(INSTINCTS_PATH, instincts);
    console.log(`Updated confidence: ${similar.confidence}`);
    return;
  }

  const instinct: Instinct = {
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
  };

  instincts.push(instinct);
  writeInstincts(INSTINCTS_PATH, instincts);
  console.log(`Created instinct: ${instinct.id} (confidence: 0.5)`);
  console.log(`  "${rule}"`);
}

function cmdReinforce(args: string[]): void {
  const id = args[0];
  if (!id) {
    console.error("Error: instinct id is required");
    Deno.exit(1);
  }

  const instincts = readInstincts(INSTINCTS_PATH);
  const instinct = instincts.find((i) => i.id === id);

  if (!instinct) {
    console.error(`Error: instinct ${id} not found`);
    Deno.exit(1);
  }

  if (instinct.status !== "active") {
    console.error(`Error: instinct ${id} is ${instinct.status}, not active`);
    Deno.exit(1);
  }

  instinct.confidence = clampConfidence(instinct.confidence + 0.1);
  instinct.last_reinforced = today();
  writeInstincts(INSTINCTS_PATH, instincts);
  console.log(
    `Reinforced ${id}: confidence ${instinct.confidence} ("${instinct.rule}")`,
  );
}

function cmdList(args: string[]): void {
  let minConfidence = 0;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--min-confidence" && i + 1 < args.length)
      minConfidence = parseFloat(args[++i]);
  }

  const instincts = readInstincts(INSTINCTS_PATH);
  const filtered = instincts.filter(
    (i) => i.status !== "pruned" && i.confidence >= minConfidence,
  );

  if (filtered.length === 0) {
    console.log("No instincts found.");
    return;
  }

  filtered.sort((a, b) => b.confidence - a.confidence);

  for (const i of filtered) {
    const status = i.status === "promoted" ? " [promoted]" : "";
    console.log(`${i.id} (${i.confidence})${status} [${i.domain}]`);
    console.log(`  "${i.rule}"`);
  }
  console.log(`\nTotal: ${filtered.length} instincts`);
}

function cmdPrune(_args: string[]): void {
  const instincts = readInstincts(INSTINCTS_PATH);
  const toPrune = instincts.filter(
    (i) => i.status === "active" && i.confidence <= 0.3,
  );

  if (toPrune.length === 0) {
    console.log("No instincts to prune.");
    return;
  }

  for (const i of toPrune) {
    i.status = "pruned";
    console.log(`Pruned: ${i.id} (${i.confidence}) "${i.rule}"`);
  }

  writeInstincts(INSTINCTS_PATH, instincts);
  console.log(`\nPruned ${toPrune.length} instincts.`);
}

function cmdPromote(_args: string[]): void {
  const instincts = readInstincts(INSTINCTS_PATH);
  const candidates = instincts.filter(
    (i) => i.status === "active" && i.confidence >= 0.7,
  );

  if (candidates.length === 0) {
    console.log("No promotion candidates (need confidence >= 0.7).");
    return;
  }

  console.log("## CLAUDE.md Promotion Candidates\n");
  for (const i of candidates) {
    console.log(`- ${i.id} (${i.confidence}) [${i.domain}]`);
    console.log(`  Rule: "${i.rule}"`);
    console.log(`  Sessions: ${i.source_sessions.length}`);
    console.log();
  }
  console.log(
    "To promote, add the rule to CLAUDE.md and run: instincts.ts mark-promoted <id> <section>",
  );
}

function cmdMarkPromoted(args: string[]): void {
  const id = args[0];
  const section = args.slice(1).join(" ") || "General";

  if (!id) {
    console.error("Error: instinct id is required");
    Deno.exit(1);
  }

  const instincts = readInstincts(INSTINCTS_PATH);
  const instinct = instincts.find((i) => i.id === id);

  if (!instinct) {
    console.error(`Error: instinct ${id} not found`);
    Deno.exit(1);
  }

  instinct.status = "promoted";
  instinct.promoted_at = today();
  instinct.claude_md_section = section;
  writeInstincts(INSTINCTS_PATH, instincts);
  console.log(`Promoted ${id} to CLAUDE.md section "${section}"`);
}

// Main — only run when executed directly, not when imported as a module
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
  default:
    console.log(`Usage: instincts.ts <add|reinforce|list|prune|promote|mark-promoted> [args]

Commands:
  add --rule "..." --domain "..." [--session "..."]  Create or reinforce an instinct
  reinforce <id>                                      Increase confidence by 0.1
  list [--min-confidence N]                           List instincts (filtered)
  prune                                               Remove instincts with confidence <= 0.3
  promote                                             Show CLAUDE.md promotion candidates
  mark-promoted <id> [section]                        Mark instinct as promoted`);
    Deno.exit(subcommand ? 1 : 0);
}
}
