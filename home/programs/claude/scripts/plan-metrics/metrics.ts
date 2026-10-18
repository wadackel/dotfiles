// The eight metric groups as pure functions over parsed transcripts and sidecars.
import type { Segment, Subagent } from "./transcripts.ts";

export function median(nums: number[]): number {
  const s = nums.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!s.length) return NaN;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round1 = (
  n: number,
) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
const pct = (
  num: number,
  den: number,
) => (den ? Math.round((100 * num) / den) : null);

function section(text: string, start: RegExp, end: RegExp): string {
  const m = start.exec(text);
  if (!m) return "";
  const rest = text.slice(m.index + m[0].length);
  const e = end.exec(rest);
  return e ? rest.slice(0, e.index) : rest;
}

const NONE = /^\s*(-\s*)?\(?none\)?\.?\s*$/im;

// ---- critic ----

const CRITICAL_START = /^#{2,4}\s*Critical Issues[^\n]*\n/m;
const CRITICAL_END = /\n#{2,4}\s*(Improvement|Verdict|Suggestions|Reasoning)/;
const ITEM = /^\s{0,2}(\d+\.\s|- \*\*|\*\*|- \[)/;
const FIELD =
  /^\s*-?\s*\*\*(Dimension|Location|Suggestion|Fix|Evidence|Risk|Why|Mitigation|Impact|Severity|Issue|Claim|Tag|Category)\*\*/;

/** Top-level items of `### Critical Issues`; an explicit None, or an absent section, yields none. */
export function criticalItems(report: string): string[] {
  const sec = section(report, CRITICAL_START, CRITICAL_END);
  if (!sec.trim() || NONE.test(sec.trim().split("\n")[0])) return [];
  return sec.split("\n").filter((l) => ITEM.test(l) && !FIELD.test(l));
}

export type CriticalClass = "user" | "evidence" | "dim7" | "behavior";
const USER = /\[USER\]/;
const EVIDENCE =
  /Self-resolved|cite|citation|\[Direct\]|\[Inferred\]|\[Supported\]|probe|lines? \d+|:\d+(-\d+)?\b/i;
const DIM7 =
  /Dim(ension)?\s*7|MUST-check|\[live\]|Test Strategy|Requires User Confirmation|next real run/i;

/** Ordered: user → evidence → dim7 → behavior, on the item's first 240 chars. The order and the input unit are the ruler plan-metrics-baseline.md was taken with; changing either changes every later comparison. */
export function classifyCritical(item: string): CriticalClass {
  const head = item.slice(0, 240);
  if (USER.test(head)) return "user";
  if (EVIDENCE.test(head)) return "evidence";
  if (DIM7.test(head)) return "dim7";
  return "behavior";
}

// ---- adversarial ----

const CLAIM = /\*\*Claim\*\*/g;

export function falsifiedCount(report: string): number {
  const sec = section(
    report,
    /^#{3,4}\s*Falsified[^\n]*\n/m,
    /\n#{3,4}\s*(Unverified|Verified|Design Questions|Verdict)/,
  );
  return (sec.match(CLAIM) ?? []).length;
}

export function designQuestionCount(report: string): number {
  const sec = section(
    report,
    /^#{3,4}\s*Design Questions[^\n]*\n/m,
    /\n#{2,4}\s*Verdict/,
  );
  return sec.split("\n").filter((l) =>
    /^\s*(- |\d+\.\s)/.test(l) && !NONE.test(l)
  ).length;
}

// ---- deepening log ----

export type DeepeningLog = {
  rounds: number;
  round1Veto: boolean;
  round2Applied: boolean;
};

export function parseDeepeningLog(text: string): DeepeningLog {
  const parts = text.split(/^#{2,3}\s*Round\s+/m).slice(1);
  const r1 = parts[0] ?? "";
  const r2 = parts[1] ?? "";
  return {
    rounds: parts.length,
    round1Veto: /Dim(ension)?\s*7|MUST-\d|veto/i.test(r1),
    round2Applied: /Applied|^\s*\d+\.\s/m.test(r2),
  };
}

// ---- gate log ----

export type ReviewerVerdict = {
  name: string;
  verdict: "PASS" | "FAIL";
  everFailed: boolean;
  blocker: boolean;
};
export type GateLog = {
  rounds: number;
  reviewers: ReviewerVerdict[];
  skipped: boolean;
  unparsed: boolean;
  rereview: boolean;
};

const REVIEWER = /\b([a-z0-9]+(?:-[a-z0-9]+)*-(?:reviewer|auditor))\b/g;
const HEADING = /^(#{2,5}\s+|\*\*)/;
// A pasted reply carries its own headings; they belong to the reviewer named above them, not to a new block.
const REPLY_HEADING =
  /^(#{2,5}\s*|\*\*)(Issues|Must Fix|Should Fix|Nits|Notes|Findings|Verdict|Reasoning|Dimension|Extracted|Investigation|Summary|Round 1 evidence|AGREE|CRITICAL|HIGH|MEDIUM|LOW)/i;
const VERDICT_LINE = /VERDICT:\s*(PASS|FAIL)/;
// `- name: PASS`, `- name — FAIL`, `- name: Issues None. VERDICT: PASS`, several per line.
const INLINE =
  /\b([a-z0-9]+(?:-[a-z0-9]+)*-(?:reviewer|auditor))(?:\s*\([^)]*\))?\s*(?:[:—-]\s*)?(?:Issues None\.\s*)?(?:VERDICT:\s*)?(PASS|FAIL)\b/g;
// `comment-reviewer:` on its own line, followed by the pasted reply (often fenced).
const NAME_LINE =
  /^\s*(?:\*\*|`)?([a-z0-9]+(?:-[a-z0-9]+)*-(?:reviewer|auditor))(?:\*\*|`)?[^\n]{0,60}[:：]\s*$/;
const SELECTION_LINE =
  /^(\s*-\s*)?(\*\*)?(Reviewers?|Selection|Reviewer selection)(\*\*)?\s*[:：]/i;
const NOT_DISPATCHED =
  /not (dispatched|selected|triggered|re-dispatched)|skipped|no .*row|none/i;
const VERDICTS_LINE =
  /^\s*(-\s*)?(\*\*)?Verdicts?(\*\*)?\s*[:：]?\s*(?:\([^)]*\))?[^\n]*?\b(?:all\s+)?(PASS|FAIL)\b/i;
const EVERY_PASS =
  /every reply ended[^\n]*VERDICT: PASS|all (replies|reviewers)[^\n]*PASS/i;
const SKIPPED =
  /wave (was )?skipped|skipped the (review )?wave|no reviewers? (were )?dispatched|review wave skipped|Main-session review/i;
// A FAIL carries a blocker when its block names MUST_FIX / CRITICAL / HIGH or a spec Issue; "SHOULD_FIX only" FAILs do not.
// Case-sensitive on purpose: reviewers write "confidence: high" in prose, which is not a HIGH severity.
// A `### Must Fix` / `### Issues` section is populated unless its first line is a None sentinel or the next heading.
const EMPTY_SECTION = String
  .raw`(?!\s*(?:\(?[Nn]one\)?|-\s*[Nn]one|\*\*[Nn]one\*\*|[Nn]ot applicable|Empty if none)\.?\s*$)(?!\s*#)`;
const BLOCKER = new RegExp(
  String
    .raw`MUST_FIX|CRITICAL\b|\bHIGH\b|^###\s*Must Fix\s*\n${EMPTY_SECTION}|^###\s*Issues\s*\n${EMPTY_SECTION}|\bType(?:\*{0,2}:|:\*{0,2}|\*{0,2})[ \t]*(?:MISSING|EXTRA|MISUNDERSTOOD|INCOMPLETE)|Issues?\s*\((?![Nn]one)|^Issues:\s*(?![Nn]one)`,
  "m",
);
const SHOULD_ONLY = /SHOULD_FIX[- ]only/i;

function namesIn(line: string): string[] {
  return line.split(/[;。.]\s/).filter((seg) => !NOT_DISPATCHED.test(seg))
    .flatMap((seg) => seg.match(new RegExp(REVIEWER.source, "g")) ?? []);
}

export function parseGateLog(text: string): GateLog {
  const lines = text.split("\n");
  const rounds = Math.max(
    1,
    (text.match(/^#{3,4}\s*(Round|Wave)\s*\d/gm) ?? []).length,
  );
  const anchors: Array<
    { line: number; name: string; verdict: "PASS" | "FAIL" }
  > = [];
  let currentHeading = "";
  let pendingReviewers: string[] = [];
  let inFence = false;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (/^\s*```/.test(l)) {
      inFence = !inFence;
      continue;
    }
    const isHeading = !inFence && (HEADING.test(l) || /^#{2,5}\s/.test(l)) &&
      !REPLY_HEADING.test(l);
    const nameLine = !inFence && !isHeading ? NAME_LINE.exec(l) : null;
    if (nameLine) {
      currentHeading = nameLine[1];
      continue;
    }
    if (isHeading) {
      const m = new RegExp(REVIEWER.source).exec(l);
      currentHeading = m ? m[1] : "";
    }
    const v = VERDICT_LINE.exec(l);
    if (v && !EVERY_PASS.test(l)) {
      const inlineName = new RegExp(REVIEWER.source).exec(l)?.[1];
      const name = inlineName ?? currentHeading;
      if (name) {
        anchors.push({ line: i, name, verdict: v[1] as "PASS" | "FAIL" });
      }
      continue;
    }
    if (isHeading) {
      const dash = /—\s*(PASS|FAIL)\b/.exec(l);
      if (dash && currentHeading) {
        anchors.push({
          line: i,
          name: currentHeading,
          verdict: dash[1] as "PASS" | "FAIL",
        });
      }
      if (SELECTION_LINE.test(l) || /Verdicts/.test(l)) {
        const names = namesIn(l);
        if (names.length) pendingReviewers = names;
        if (EVERY_PASS.test(l)) {
          for (const n of pendingReviewers) {
            anchors.push({ line: i, name: n, verdict: "PASS" });
          }
        }
      }
      continue;
    }
    const inline = [...l.matchAll(INLINE)];
    if (SELECTION_LINE.test(l)) {
      const names = namesIn(l);
      const all = /\b(?:Both|All|Each)\s+(PASS|FAIL)\b/.exec(l);
      if (all) {
        for (const n of names) {
          anchors.push({
            line: i,
            name: n,
            verdict: all[1] as "PASS" | "FAIL",
          });
        }
      } else if (inline.length) {
        for (const m of inline) {
          anchors.push({
            line: i,
            name: m[1],
            verdict: m[2] as "PASS" | "FAIL",
          });
        }
      } else if (names.length) pendingReviewers = names;
      continue;
    }
    if (inline.length) {
      for (const m of inline) {
        anchors.push({ line: i, name: m[1], verdict: m[2] as "PASS" | "FAIL" });
      }
      continue;
    }
    const verdicts = VERDICTS_LINE.exec(l);
    if (verdicts && pendingReviewers.length) {
      for (const n of pendingReviewers) {
        anchors.push({
          line: i,
          name: n,
          verdict: verdicts[4].toUpperCase() as "PASS" | "FAIL",
        });
      }
      pendingReviewers = [];
      continue;
    }
    if (EVERY_PASS.test(l) && pendingReviewers.length) {
      for (const n of pendingReviewers) {
        anchors.push({ line: i, name: n, verdict: "PASS" });
      }
      pendingReviewers = [];
    }
  }
  // A block ends at the next verdict or the next log-level heading, so the parent's own
  // "Blockers fixed: none (no MUST_FIX ...)" summary never counts as a reviewer's finding.
  const logHeadings: number[] = [];
  {
    let fence = false;
    lines.forEach((l, i) => {
      if (/^\s*```/.test(l)) fence = !fence;
      else if (!fence && /^#{2,5}\s/.test(l) && !REPLY_HEADING.test(l)) {
        logHeadings.push(i);
      }
    });
  }
  const byName = new Map<string, ReviewerVerdict>();
  anchors.forEach((a, idx) => {
    // A pasted reply ends with its VERDICT line, a heading form starts with it: span the whole region between neighbouring headings or verdicts.
    const prevAnchor = idx > 0 ? anchors[idx - 1].line + 1 : 0;
    const prevHeading = [...logHeadings].reverse().find((h) => h <= a.line) ??
      0;
    const nextAnchor = anchors[idx + 1]?.line ?? lines.length;
    const nextHeading = logHeadings.find((h) => h > a.line) ?? lines.length;
    const block = lines.slice(
      Math.max(prevAnchor, prevHeading),
      Math.min(nextAnchor, nextHeading),
    ).filter((l) =>
      !/\bno\s+(new\s+)?(MUST_FIX|blocker)|Blockers? fixed: none/i.test(l)
    ).join("\n");
    const blocker = a.verdict === "FAIL" && BLOCKER.test(block) &&
      !SHOULD_ONLY.test(block);
    const prev = byName.get(a.name);
    // The last verdict is the final state; a FAIL in any round still counts as a finding.
    byName.set(a.name, {
      name: a.name,
      verdict: a.verdict,
      everFailed: (prev?.everFailed ?? false) || a.verdict === "FAIL",
      blocker: (prev?.blocker ?? false) || blocker,
    });
  });
  const skipped = byName.size === 0 && SKIPPED.test(text);
  return {
    rounds,
    reviewers: [...byName.values()],
    skipped,
    unparsed: byName.size === 0 && !skipped,
    rereview: /rereview-\d+/.test(text) || rounds > 1,
  };
}

// ---- evidence ----

export type EvidenceStats = {
  records: number;
  distinctIds: number;
  recordsPerIdMedian: number;
  statusChangedIds: number;
  distinctTargets: number;
  outputChars: number;
};

export function evidenceStats(ev: unknown): EvidenceStats {
  const tasks = ((ev as { tasks?: unknown }).tasks ?? []) as Array<
    {
      checks?: Array<
        { id?: string; status?: string; target?: string; output?: string }
      >;
    }
  >;
  const perId = new Map<string, { n: number; statuses: Set<string> }>();
  const targets = new Set<string>();
  let records = 0, outputChars = 0;
  for (const t of Array.isArray(tasks) ? tasks : []) {
    for (const c of t.checks ?? []) {
      records++;
      outputChars += (c.output ?? "").length;
      if (c.target) targets.add(c.target);
      const e = perId.get(c.id ?? "") ?? { n: 0, statuses: new Set<string>() };
      e.n++;
      e.statuses.add(c.status ?? "");
      perId.set(c.id ?? "", e);
    }
  }
  return {
    records,
    distinctIds: perId.size,
    recordsPerIdMedian: median([...perId.values()].map((e) => e.n)),
    statusChangedIds:
      [...perId.values()].filter((e) => e.statuses.size > 1).length,
    distinctTargets: targets.size,
    outputChars,
  };
}

// ---- report ----

export type Inputs = {
  segments: Segment[];
  agents: Array<Subagent & { project: string }>;
  deepening: DeepeningLog[];
  gates: GateLog[];
  evidence: EvidenceStats[];
  frictionTexts: Array<{ session: string; texts: string[] }>;
  diffOnlyCalls: number;
  population: {
    listed: number;
    read: number;
    skippedTmp: number;
    skippedOld: number;
    missing: number;
    includeTmp: boolean;
  };
  unparsed: {
    badLines: number;
    unparsedKind: number;
    sidecars: number;
    subagentFiles: number;
    metaFiles: number;
    untimedSegments: number;
  };
  windowEnd: number;
};

export const FRICTION = {
  gitC: "Do not use 'git -C",
  sedInPlace: "sed: can't read s/",
  repositoryMismatch: "repository mismatch",
  selfResolvedGrade: "[error] self-resolved-grade",
  targetChanged: "target changed during verification",
} as const;

export function buildReport(input: Inputs) {
  const handed = input.segments.filter((s) => s.handoff);
  const byLevel: Record<string, Segment[]> = {};
  for (const s of handed) (byLevel[s.handoff!.complexity] ??= []).push(s);
  const phases: Record<string, unknown> = {};
  for (const level of ["trivial", "small", "medium", "large", "xl", "?"]) {
    const segs = byLevel[level];
    if (!segs?.length) continue;
    phases[level] = {
      plans: new Set(segs.map((s) => s.handoff!.slug || s.sessionPath)).size,
      planActiveMin: round1(median(segs.map((s) => s.planActiveMin!))),
      waitMin: round1(median(segs.map((s) => s.waitMin))),
      repliesMedian: median(segs.map((s) => s.questions.length)),
      implMin: round1(
        median(
          segs.filter((s) => s.implMin !== undefined).map((s) => s.implMin!),
        ),
      ),
      noEnd: segs.filter((s) => s.state === "noEnd").length,
    };
  }

  const critics = input.agents.filter((a) => a.kind === "critic");
  const items = critics.flatMap((a) =>
    criticalItems(a.report).map((line) => ({
      cls: classifyCritical(line),
      line,
      description: a.description,
      project: a.project,
    }))
  );
  const classification = { user: 0, evidence: 0, dim7: 0, behavior: 0 };
  for (const it of items) classification[it.cls]++;
  const withCritical =
    critics.filter((a) => criticalItems(a.report).length > 0).length;
  const adversarial = input.agents.filter((a) => a.kind === "adversarial");
  const falsified = adversarial.map((a) => falsifiedCount(a.report));
  const dq = adversarial.map((a) => designQuestionCount(a.report));

  const round2 = input.deepening.filter((d) => d.rounds >= 2);
  const failByReviewer: Record<string, number> = {};
  const blockerByReviewer: Record<string, number> = {};
  const dispatchByReviewer: Record<string, number> = {};
  let failLogs = 0;
  for (const g of input.gates) {
    if (g.reviewers.some((r) => r.everFailed)) failLogs++;
    for (const r of g.reviewers) {
      dispatchByReviewer[r.name] = (dispatchByReviewer[r.name] ?? 0) + 1;
      if (r.everFailed) {
        failByReviewer[r.name] = (failByReviewer[r.name] ?? 0) + 1;
      }
      if (r.blocker) {
        blockerByReviewer[r.name] = (blockerByReviewer[r.name] ?? 0) + 1;
      }
    }
  }

  const implSegs = input.segments.filter((s) => s.implTs !== undefined);
  const inputChars = implSegs.reduce((a, s) => a + s.implToolInputChars, 0);
  const planStateChars = implSegs.reduce(
    (a, s) => a + s.planStateInputChars,
    0,
  );

  const questions = handed.flatMap((s) => s.questions);
  const before = questions.filter((q) => !q.afterCritic);
  const after = questions.filter((q) => q.afterCritic);

  const friction: Record<string, number> = {};
  for (const [key, needle] of Object.entries(FRICTION)) {
    friction[key] = input.frictionTexts.filter((f) =>
      f.texts.some((t) => t.includes(needle))
    ).length;
  }

  const starts = input.segments.map((s) => s.startTs).filter((t) =>
    Number.isFinite(t)
  );
  const criticPlans = new Set(
    handed.filter((s) => s.criticTs !== undefined).map((s) =>
      s.handoff!.slug || s.sessionPath
    ),
  ).size;
  return {
    window: {
      from: starts.length ? new Date(Math.min(...starts)).toISOString() : null,
      to: Number.isFinite(input.windowEnd)
        ? new Date(input.windowEnd).toISOString()
        : null,
    },
    population: {
      ...input.population,
      abandonedPlanSegments:
        input.segments.filter((s) => s.state === "noHandoff").length,
    },
    unparsed: {
      badLines: input.unparsed.badLines,
      sidecars: input.unparsed.sidecars,
      subagentFiles: input.unparsed.subagentFiles,
      metaFiles: input.unparsed.metaFiles,
      untimedSegments: input.unparsed.untimedSegments,
      noEndSegments: input.segments.filter((s) => s.state === "noEnd").length,
      unparsedKind: input.unparsed.unparsedKind,
      gateLogs: input.gates.filter((g) => g.unparsed).length,
      skippedWaves: input.gates.filter((g) => g.skipped).length,
    },
    warnings: criticPlans < 10
      ? [
        `fewer than 10 plans with a critic in the window (${criticPlans}): rates are not reliable`,
      ]
      : [],
    phases,
    critics: {
      runs: critics.length,
      durMin: round1(median(critics.map((a) => a.durMin))),
      out: median(critics.map((a) => a.out)),
      cacheRead: median(critics.map((a) => a.cacheRead)),
      withCriticalRate: pct(withCritical, critics.length),
      items: items.length,
      classification,
      behaviorShare: pct(classification.behavior, items.length),
    },
    adversarial: {
      runs: adversarial.length,
      durMin: round1(median(adversarial.map((a) => a.durMin))),
      out: median(adversarial.map((a) => a.out)),
      withFalsifiedRate: pct(
        falsified.filter((n) => n > 0).length,
        adversarial.length,
      ),
      falsified: falsified.reduce((a, b) => a + b, 0),
      designQuestions: dq.reduce((a, b) => a + b, 0),
      designQuestionsPerRun: round1(
        adversarial.length
          ? dq.reduce((a, b) => a + b, 0) / adversarial.length
          : NaN,
      ),
    },
    rounds: {
      logs: input.deepening.length,
      round2: round2.length,
      round2Rate: pct(round2.length, input.deepening.length),
      round1Veto: round2.filter((d) => d.round1Veto).length,
      round2Applied: round2.filter((d) => d.round2Applied).length,
    },
    gates: {
      logs: input.gates.length,
      dispatchMedian: median(
        input.gates.filter((g) => !g.unparsed && !g.skipped).map((g) =>
          g.reviewers.length
        ),
      ),
      failLogs,
      failRate: pct(failLogs, input.gates.length),
      dispatchByReviewer,
      failByReviewer,
      blockerByReviewer,
      rereviewLogs: input.gates.filter((g) => g.rereview).length,
    },
    evidence: {
      implSegments: implSegs.length,
      planStateShare: pct(planStateChars, inputChars),
      targetChanged: implSegs.reduce((a, s) => a + s.targetChanged, 0),
      sidecars: input.evidence.length,
      recordsPerIdMedian: median(
        input.evidence.map((e) => e.recordsPerIdMedian),
      ),
      distinctTargetsMedian: median(
        input.evidence.map((e) => e.distinctTargets),
      ),
      statusChangedIds: input.evidence.reduce(
        (a, e) => a + e.statusChangedIds,
        0,
      ),
      outputCharsMedian: median(input.evidence.map((e) => e.outputChars)),
    },
    questions: {
      segments: handed.length,
      turns: questions.length,
      perPlanMedian: median(handed.map((s) => s.questions.length)),
      before: {
        turns: before.length,
        waitMin: round1(median(before.map((q) => q.waitMin))),
      },
      after: {
        turns: after.length,
        waitMin: round1(median(after.map((q) => q.waitMin))),
      },
      recommendationRate: pct(
        questions.filter((q) => q.hasRecommendation).length,
        questions.length,
      ),
    },
    friction: {
      gitCSessions: friction.gitC,
      sedInPlaceSessions: friction.sedInPlace,
      repositoryMismatchSessions: friction.repositoryMismatch,
      selfResolvedGradeSessions: friction.selfResolvedGrade,
      targetChangedSessions: friction.targetChanged,
      diffOnlyCalls: input.diffOnlyCalls,
    },
    lists: {
      questions: handed.flatMap((s) =>
        s.questions.map((q) => ({
          phase: q.afterCritic ? "後" : "前",
          slug: s.handoff!.slug,
          heading: q.heading,
          answer: q.answer,
        }))
      ),
      critical: items.map((it) => ({
        cls: it.cls,
        description: it.description,
        line: it.line.trim(),
      })),
    },
  };
}

export type Report = ReturnType<typeof buildReport>;
