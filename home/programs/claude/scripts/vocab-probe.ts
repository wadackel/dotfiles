#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

// Measures whether the vocabulary digest changes how Claude reads short
// instructions. Probes run with every hook disabled so neither the memo nor the
// SessionStart injection runs; the digest is added explicitly instead.
//   vocab-probe.ts draft [--count 20]   # writes probes.md for the owner to correct
//   vocab-probe.ts run [--reps 3] [--concurrency 4]

import { writeSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "@std/cli/parse-args";
import { parse, stringify } from "@std/yaml";
import { run as runCommand } from "../../agents/lib/proc.ts";
import { repoNameFor } from "../../agents/memo/memo-shared.ts";
import {
  buildDigest,
  effectiveEntries,
  loadNotes,
  loadProposals,
  loadSchema,
  symmetricRelations,
  vaultPaths,
} from "../../agents/scripts/vocab-lib.ts";
import {
  SEED_SOURCES,
  shortUtterances,
} from "../../agents/scripts/vocab-propose.ts";

export interface Expected {
  skill: string;
  paths: string[];
  needs_clarification: boolean;
  // Any one of these must appear in the interpretation. It catches a meaning
  // the other fields cannot, such as "commit on main" for "commit & push".
  mentions?: string[];
}

export interface Probe {
  id: string;
  cwd: string;
  utterance: string;
  expected: Expected;
}

export interface Answer {
  skill: string;
  paths: string[];
  needs_clarification: boolean;
  interpretation?: string;
}

export interface Row {
  probe: string;
  condition: "without" | "with";
  rep: number;
  correct: boolean;
  clarified: boolean;
  // A run that produced no answer is kept apart from a wrong answer, so an
  // outage or rate limit cannot pass for a difference between the conditions.
  failed?: boolean;
}

const PROBES = "98_Maintenance/vocab-probe/probes.md";

export function renderProbes(probes: Probe[]): string {
  return "エージェントの語彙の効果を測る凍結した問題。各問の expected を、指示したときに意図していた解釈に直す。" +
    "skill は使うべきスキル名（無ければ空文字）、paths は触るべきファイル（部分一致で採点）、needs_clarification は確認の質問が必要か、mentions は解釈の文に含まれるべき語（どれか 1 つで可、省略可）。\n\n" +
    "```yaml\n" + stringify(probes, { lineWidth: -1 }) + "```\n";
}

export function parseProbes(md: string): Probe[] {
  const block = md.match(/```yaml\n([\s\S]*?)```/);
  if (!block) throw new Error("probes.md に yaml ブロックがない");
  return (parse(block[1]) as Probe[]).map((p) => ({
    id: String(p.id),
    cwd: String(p.cwd),
    utterance: String(p.utterance),
    expected: {
      skill: String(p.expected?.skill ?? ""),
      paths: (p.expected?.paths ?? []).map(String),
      needs_clarification: p.expected?.needs_clarification === true,
      ...(p.expected?.mentions?.length
        ? { mentions: p.expected.mentions.map(String) }
        : {}),
    },
  }));
}

const bareSkill = (s: string) => s.replace(/^\//, "").trim().toLowerCase();

export function score(probe: Probe, answer: Answer): boolean {
  const e = probe.expected;
  if (e.skill && bareSkill(answer.skill) !== bareSkill(e.skill)) return false;
  if (!e.paths.every((path) => answer.paths.some((a) => a.includes(path)))) {
    return false;
  }
  if (answer.needs_clarification !== e.needs_clarification) return false;
  const said = (answer.interpretation ?? "").toLowerCase();
  return !e.mentions?.length ||
    e.mentions.some((m) => said.includes(m.toLowerCase()));
}

export function digestTerms(digest: string): string[] {
  const terms: string[] = [];
  for (const m of digest.matchAll(/^- ([^（:\n]+?)(?:（([^）]*)）)?:/gm)) {
    terms.push(m[1].trim(), ...(m[2] ? m[2].split(" / ") : []));
  }
  return terms;
}

export function injected(probe: Probe, digest: string): boolean {
  const lower = probe.utterance.toLowerCase();
  return digestTerms(digest).some((t) => lower.includes(t.toLowerCase()));
}

export function summarize(rows: Row[]) {
  const out: {
    condition: string;
    rep: number;
    total: number;
    correct: number;
    clarified: number;
    failed: number;
  }[] = [];
  for (const r of rows) {
    let s = out.find((x) => x.condition === r.condition && x.rep === r.rep);
    if (!s) {
      s = {
        condition: r.condition,
        rep: r.rep,
        total: 0,
        correct: 0,
        clarified: 0,
        failed: 0,
      };
      out.push(s);
    }
    s.total++;
    if (r.correct) s.correct++;
    if (r.clarified) s.clarified++;
    if (r.failed) s.failed++;
  }
  return out;
}

// --- I/O ---

const ANSWER_SCHEMA = {
  type: "object",
  properties: {
    skill: { type: "string" },
    paths: { type: "array", items: { type: "string" } },
    needs_clarification: { type: "boolean" },
    interpretation: { type: "string" },
  },
  required: ["skill", "paths", "needs_clarification", "interpretation"],
};

const PROMPT = (utterance: string) =>
  "あなたはユーザーから短い指示を受け取ったコーディングエージェントです。まだ作業はせず、この指示をどう解釈するかだけを答えてください。\n" +
  "- skill: この指示で使うスキルの名前（使わないなら空文字）\n" +
  "- paths: 読んだり変更したりすると考えるファイルやディレクトリ（分からなければ空）\n" +
  "- needs_clarification: 実行の前に確認の質問が必要なら true\n" +
  "- interpretation: 解釈を 1 文で\n\n" +
  `指示: ${utterance}`;

function home(): string {
  const h = process.env.HOME;
  if (!h) throw new Error("HOME is not set");
  return h;
}

const expand = (path: string) =>
  path.startsWith("~/") ? `${home()}/${path.slice(2)}` : path;

async function ask(
  probe: Probe,
  digestFile: string | null,
): Promise<Answer | null> {
  const args = [
    "-p",
    "--settings",
    JSON.stringify({ disableAllHooks: true }),
    "--tools",
    "",
    "--strict-mcp-config",
    "--no-session-persistence",
    "--output-format",
    "json",
    "--json-schema",
    JSON.stringify(ANSWER_SCHEMA),
    ...(digestFile ? ["--append-system-prompt-file", digestFile] : []),
    PROMPT(probe.utterance),
  ];
  const out = await runCommand("claude", args, {
    cwd: expand(probe.cwd),
    env: { CLAUDE_MEMO_SKIP: "1" },
  });
  if (out.code !== 0) {
    const reason = out.stderr.trim().split("\n")[0];
    console.error(`\n${probe.id}: claude -p failed: ${reason}`);
    return null;
  }
  try {
    const json = JSON.parse(out.stdout);
    if (json.structured_output) return json.structured_output;
  } catch {
    // Falls through to the same report as a missing structured_output.
  }
  console.error(`\n${probe.id}: claude -p returned no structured_output`);
  return null;
}

async function digestFor(cwd: string): Promise<string> {
  const p = vaultPaths(home());
  const { schema } = await loadSchema(p);
  return buildDigest(
    effectiveEntries(await loadNotes(p), await loadProposals(p)),
    {
      repo: await repoNameFor(expand(cwd)),
      includeGlobal: true,
      symmetric: symmetricRelations(schema),
    },
  );
}

async function draft(count: number): Promise<void> {
  const p = vaultPaths(home());
  let used: string[] = [];
  try {
    used = JSON.parse(await readFile(`${p.root}/${SEED_SOURCES}`, "utf8"));
  } catch {
    // No seed yet: every utterance is available.
  }
  const since = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const seen = new Set(used);
  const picked: Probe[] = [];
  const all = (await shortUtterances(home(), since, 30))
    .sort((a, b) => b.at.localeCompare(a.at));
  for (const u of all) {
    if (seen.has(u.text) || u.text.length < 4) continue;
    seen.add(u.text);
    const cwd = u.cwd.startsWith(`${home()}/`)
      ? `~/${u.cwd.slice(home().length + 1)}`
      : u.cwd;
    picked.push({
      id: `p${String(picked.length + 1).padStart(2, "0")}`,
      cwd,
      utterance: u.text,
      expected: {
        skill: u.skill ?? "",
        paths: u.paths.map((x) =>
          x.startsWith(`${u.cwd}/`) ? x.slice(u.cwd.length + 1) : x
        ),
        needs_clarification: false,
      },
    });
    if (picked.length >= count) break;
  }
  const path = `${p.root}/${PROBES}`;
  await mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  await writeFile(path, renderProbes(picked), { flag: "wx" });
  console.log(
    `${path}: ${picked.length} 問（expected は直後の操作からの推測。直してから run する）`,
  );
}

async function run(reps: number, concurrency: number): Promise<void> {
  const p = vaultPaths(home());
  const probes = parseProbes(await readFile(`${p.root}/${PROBES}`, "utf8"));
  const tmp = await mkdtemp(join(tmpdir(), "vocab-probe-"));
  const digests = new Map<string, { file: string; text: string }>();
  for (const cwd of new Set(probes.map((x) => x.cwd))) {
    const text = await digestFor(cwd);
    const file = `${tmp}/${digests.size}.md`;
    await writeFile(file, text);
    digests.set(cwd, { file, text });
  }
  const jobs: (() => Promise<Row & { answer: Answer | null }>)[] = [];
  for (const condition of ["without", "with"] as const) {
    for (let rep = 1; rep <= reps; rep++) {
      for (const probe of probes) {
        jobs.push(async () => {
          const d = digests.get(probe.cwd)!;
          const answer = await ask(
            probe,
            condition === "with" && d.text ? d.file : null,
          );
          return {
            probe: probe.id,
            condition,
            rep,
            correct: answer ? score(probe, answer) : false,
            clarified: answer?.needs_clarification === true,
            failed: answer === null,
            answer,
          };
        });
      }
    }
  }
  const results: (Row & { answer: Answer | null })[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < jobs.length) {
        const job = jobs[next++];
        results.push(await job());
        writeSync(
          2,
          new TextEncoder().encode(`\r${results.length}/${jobs.length}`),
        );
      }
    }),
  );
  await rm(tmp, { recursive: true });
  const order = (r: Row) =>
    `${r.condition === "without" ? 0 : 1}-${r.rep}-${r.probe}`;
  results.sort((a, b) => order(a).localeCompare(order(b)));

  const date = new Date().toLocaleDateString("sv-SE");
  const dir = `${p.root}/98_Maintenance/vocab-probe`;
  await writeFile(
    `${dir}/results-${date}.json`,
    JSON.stringify(results, null, 2) + "\n",
  );
  const lines = [
    `${probes.length} 問 × 語彙なし / あり × ${reps} 回。採点は skill・paths・needs_clarification の一致。`,
    "",
    "| 条件 | 回 | 正解 | 確認で終わった | 回答なし |",
    "|---|---|---|---|---|",
    ...summarize(results).map((s) =>
      `| ${
        s.condition === "with" ? "語彙あり" : "語彙なし"
      } | ${s.rep} | ${s.correct}/${s.total} | ${s.clarified}/${s.total} | ${s.failed}/${s.total} |`
    ),
    "",
    "| 問題 | 指示 | 語彙が要約に入っていた | 語彙なしの正解 | 語彙ありの正解 |",
    "|---|---|---|---|---|",
    ...probes.map((pr) => {
      const count = (c: string) =>
        results.filter((r) =>
          r.probe === pr.id && r.condition === c && r.correct
        )
          .length;
      return `| ${pr.id} | \`${pr.utterance.replaceAll("|", "\\|")}\` | ${
        injected(pr, digests.get(pr.cwd)!.text) ? "yes" : "no"
      } | ${count("without")}/${reps} | ${count("with")}/${reps} |`;
    }),
  ];
  await writeFile(
    `${dir}/results-${date}.md`,
    lines.join("\n") + "\n",
  );
  console.log(`\n${dir}/results-${date}.md`);
  console.log(lines.slice(2, 4 + reps * 2).join("\n"));
}

if (import.meta.main) {
  const [command, ...rest] = process.argv.slice(2);
  const flags = parseArgs(rest, {
    string: ["count", "reps", "concurrency"],
  });
  if (command === "draft") await draft(Number(flags.count ?? 20));
  else if (command === "run") {
    await run(Number(flags.reps ?? 3), Number(flags.concurrency ?? 4));
  } else {
    console.error(
      "Usage: vocab-probe.ts draft [--count 20] | run [--reps 3] [--concurrency 4]",
    );
    process.exit(2);
  }
}
