#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null
/**
 * Measures the plan / impl / gate workflow from transcripts and plan sidecars and
 * prints eight metric groups behind an effective-window line. Compared against
 * plan-metrics-baseline.md. There is no `--to`: transcripts rotate out after about
 * 30 days, so the window is set by retention, and a two-group comparison inside one
 * run would compare a full month with a partial one.
 *
 * Usage:
 *   plan-metrics.ts [--from YYYY-MM-DD] [--root DIR] [--plans DIR] [--include-tmp] [--list questions|critical] [--json]
 *
 * `--from` includes everything from 00:00 of that day in +09:00, whatever the local TZ.
 */
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  buildReport,
  type DeepeningLog,
  type EvidenceStats,
  evidenceStats,
  type GateLog,
  parseDeepeningLog,
  parseGateLog,
} from "./metrics.ts";
import {
  countDiffOnlyCalls,
  errorResultTexts,
  findPlanSegments,
  joinSubagents,
  listSessionFiles,
  readSession,
  type Segment,
  sidecarTime,
  type Subagent,
} from "./transcripts.ts";

const USAGE =
  "usage: plan-metrics.ts [--from YYYY-MM-DD] [--root DIR] [--plans DIR] [--include-tmp] [--list questions|critical] [--json]";

function fail(msg: string): never {
  console.error(`plan-metrics.ts: ${msg}\n${USAGE}`);
  process.exit(1);
}

let fromMs = -Infinity;
let root = join(homedir(), ".claude", "projects");
let plans = join(homedir(), ".claude", "plans");
let includeTmp = false;
let list: "questions" | "critical" | null = null;
let json = false;
{
  const args = [...process.argv.slice(2)];
  while (args.length) {
    const a = args.shift()!;
    if (a === "--from") {
      const v = args.shift();
      if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) {
        fail(`--from は YYYY-MM-DD 形式で指定する（got: ${v ?? "なし"}）`);
      }
      // Date.parse returns NaN for "2026-13-45"; a NaN bound compares false everywhere and
      // would silently disable the window, so stop here instead.
      const ms = Date.parse(`${v}T00:00:00+09:00`);
      if (Number.isNaN(ms)) fail(`--from の日付が不正: ${v}`);
      fromMs = ms;
    } else if (a === "--root" || a === "--plans") {
      const v = args.shift();
      if (!v || v.startsWith("--")) fail(`${a} にディレクトリを指定する`);
      if (a === "--root") root = v;
      else plans = v;
    } else if (a === "--include-tmp") includeTmp = true;
    else if (a === "--list") {
      const v = args.shift();
      if (v !== "questions" && v !== "critical") {
        fail(`--list は questions か critical（got: ${v ?? "なし"}）`);
      }
      list = v;
    } else if (a === "--json") json = true;
    else fail(`未知の引数: ${a}`);
  }
}

const listing = await listSessionFiles(root, { fromMs, includeTmp });
const segments: Segment[] = [];
const agents: Array<Subagent & { project: string }> = [];
const frictionTexts: Array<{ session: string; texts: string[] }> = [];
let diffOnlyCalls = 0,
  badLines = 0,
  unparsedKind = 0,
  unparsedSidecars = 0,
  unparsedSubagentFiles = 0,
  badMeta = 0,
  readSessions = 0,
  windowEnd = -Infinity;
const untimed = { count: 0 };
for (const f of listing.files) {
  let session;
  try {
    session = await readSession(f.path, f.project);
  } catch {
    listing.missing++;
    continue;
  }
  readSessions++;
  badLines += session.badLines;
  segments.push(...findPlanSegments(session, { fromMs, untimed }));
  diffOnlyCalls += countDiffOnlyCalls(session);
  const sub = await joinSubagents(session);
  unparsedKind += sub.unparsedKind;
  badLines += sub.badLines;
  unparsedSubagentFiles += sub.missing;
  badMeta += sub.badMeta;
  for (const a of sub.agents) {
    if (!Number.isFinite(a.startTs) || a.startTs >= fromMs) {
      agents.push({ ...a, project: f.project });
    }
  }
  frictionTexts.push({
    session: f.path,
    texts: [
      ...errorResultTexts(session),
      ...sub.agents.flatMap((a) => a.errorResults),
    ],
  });
  for (const e of session.events) if (e.ts > windowEnd) windowEnd = e.ts;
}

const deepening: DeepeningLog[] = [];
const gates: GateLog[] = [];
const evidence: EvidenceStats[] = [];
let sidecarNames: string[] = [];
try {
  sidecarNames = await readdir(plans);
} catch {
  listing.missing++;
}
for (const name of sidecarNames) {
  const t = sidecarTime(name);
  if (t === null || t < fromMs) continue;
  const path = join(plans, name);
  try {
    if (name.endsWith(".gate.log.md")) {
      gates.push(parseGateLog(await readFile(path, "utf8")));
    } else if (name.endsWith(".log.md")) {
      deepening.push(parseDeepeningLog(await readFile(path, "utf8")));
    } else if (name.endsWith(".evidence.json")) {
      evidence.push(evidenceStats(JSON.parse(await readFile(path, "utf8"))));
    }
  } catch {
    unparsedSidecars++;
  }
}

const report = buildReport({
  segments,
  agents,
  deepening,
  gates,
  evidence,
  frictionTexts,
  diffOnlyCalls,
  population: {
    listed: listing.files.length,
    read: readSessions,
    skippedTmp: listing.skippedTmp,
    skippedOld: listing.skippedOld,
    missing: listing.missing,
    includeTmp,
  },
  unparsed: {
    badLines,
    unparsedKind,
    sidecars: unparsedSidecars,
    subagentFiles: unparsedSubagentFiles,
    metaFiles: badMeta,
    untimedSegments: untimed.count,
  },
  windowEnd,
});

// --list echoes text other sessions wrote; a transcript can carry terminal escapes.
const plain = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
if (list === "questions") {
  for (const q of report.lists.questions) {
    console.log(plain(`${q.phase}\t${q.slug}\t${q.heading}\t${q.answer}`));
  }
} else if (list === "critical") {
  for (const c of report.lists.critical) {
    console.log(plain(`${c.cls}\t${c.description}\t${c.line}`));
  }
} else if (json) {
  const { lists: _lists, ...rest } = report;
  console.log(JSON.stringify(rest, null, 2));
} else {
  const { lists: _lists, ...rest } = report;
  for (const [group, value] of Object.entries(rest)) {
    console.log(`## ${group}`);
    if (Array.isArray(value)) {
      for (const v of value) console.log(`  ${v}`);
      continue;
    }
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      console.log(
        `  ${k}: ${
          v !== null && typeof v === "object" ? JSON.stringify(v) : String(v)
        }`,
      );
    }
  }
}
