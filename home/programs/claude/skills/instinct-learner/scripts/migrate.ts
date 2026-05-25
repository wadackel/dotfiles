#!/usr/bin/env -S deno run --allow-env=HOME --allow-read --allow-write

/**
 * migrate.ts — one-shot migration from instincts.jsonl to retrospective-ledger.jsonl.
 *
 * Adds empty proposals[] and outcomes[] arrays to each entry. Renames the source
 * to instincts.jsonl.bak so the original remains recoverable.
 *
 * Usage:
 *   migrate.ts --dry-run    Print summary and first 3 entries, no writes
 *   migrate.ts              Perform migration
 */

const HOME = Deno.env.get("HOME")!;
const SRC = `${HOME}/.claude/instincts.jsonl`;
const DST = `${HOME}/.claude/retrospective-ledger.jsonl`;
const BAK = `${HOME}/.claude/instincts.jsonl.bak`;

interface OldInstinct {
  id: string;
  rule: string;
  status: string;
  confidence: number;
  domain: string;
  source_sessions: string[];
  created: string;
  last_reinforced: string;
  promoted_at: string | null;
  claude_md_section: string | null;
}

function readJsonl(path: string): OldInstinct[] {
  const text = Deno.readTextFileSync(path);
  return text
    .trim()
    .split("\n")
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line) as OldInstinct);
}

function upgrade(o: OldInstinct): OldInstinct & { proposals: unknown[]; outcomes: unknown[] } {
  return { ...o, proposals: [], outcomes: [] };
}

const dryRun = Deno.args.includes("--dry-run");

try {
  Deno.statSync(SRC);
} catch {
  console.error(`Source file not found: ${SRC}`);
  Deno.exit(1);
}

try {
  Deno.statSync(DST);
  console.error(`Destination already exists: ${DST}. Refusing to overwrite.`);
  Deno.exit(1);
} catch {
  // expected — destination should not exist yet
}

const entries = readJsonl(SRC);
const upgraded = entries.map(upgrade);

console.log(`Source:      ${SRC}`);
console.log(`Destination: ${DST}`);
console.log(`Backup:      ${BAK}`);
console.log(`Entries:     ${entries.length}`);
console.log();
console.log("Preview (first 3 entries after upgrade):");
for (const e of upgraded.slice(0, 3)) {
  console.log(`  ${e.id} (${e.confidence}) [${e.domain}] proposals=${e.proposals.length} outcomes=${e.outcomes.length}`);
}

if (dryRun) {
  console.log("\n(dry-run — no files written or renamed)");
  Deno.exit(0);
}

const text = upgraded.map((e) => JSON.stringify(e)).join("\n") + "\n";
Deno.writeTextFileSync(DST, text);
Deno.renameSync(SRC, BAK);

console.log();
console.log(`✓ Wrote ${upgraded.length} entries to ${DST}`);
console.log(`✓ Renamed ${SRC} → ${BAK}`);
