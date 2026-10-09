// Records, without a model call, the moments where the owner's words define
// something (a correction, an answer to the agent's question, an unregistered
// term used twice). Definitions are drafted weekly by the main agent in
// /weekly-review, which reads those moments in full; a small model given a few
// excerpts proposed only generic tool names.

import { readFileSync, writeFileSync } from "node:fs";
import {
  appendFile,
  mkdir,
  readdir,
  readFile,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  effectiveEntries,
  isSafeText,
  loadNotes,
  loadProposals,
  privateNames,
  refStatus,
  splitFrontmatter,
  vaultPaths,
  writeProposal,
} from "./vocab-lib.ts";

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

export interface SessionInput {
  agent: "claude" | "codex" | "opencode";
  sessionId: string;
  cwd: string;
  repo: string;
  turns: Turn[];
  home: string;
  tmpdir: string;
  now?: Date;
}

export interface ProposeResult {
  recorded: number;
  note: string;
}

export const AUTO_PENDING_LIMIT = 5;
export const AUTO_ORIGINS = new Set(["session", "weekly"]);

const CORRECTION =
  /そうじゃな|そういう意味|そういうことじゃ|ではなく|じゃなくて|のことじゃない|のことではない|勘違い|誤解|違います|違う[。、よ]|ちがう|not what I|I meant/;
const QUESTION_END = /[?？]\s*$/;

// Everyday English and git/CI verbs repeat in any session without being the
// owner's own vocabulary.
const STOPWORDS = new Set(
  (
    "the and for you are not this that with from can please yes " +
    "commit push pull merge rebase branch main master diff test tests build " +
    "run lint fix bug issue review deploy release install update config file " +
    "code error log api cli pr"
  ).split(" "),
);

// Paths, URLs and code spans name files, not vocabulary.
function prose(text: string): string {
  return text
    .replace(/`[^`]*`/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/\S*[/.]\S*/g, " ");
}

export function tokens(text: string, known: Set<string>): string[] {
  const out: string[] = [];
  for (
    const m of prose(text).matchAll(/[A-Za-z][A-Za-z0-9_+-]{2,}|[ァ-ヴー]{3,}/g)
  ) {
    const key = m[0].toLowerCase();
    if (!STOPWORDS.has(key) && !known.has(key)) out.push(m[0]);
  }
  return out;
}

export function extractCandidates(
  texts: string[],
  known: Set<string>,
): string[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    for (const term of tokens(text, known)) {
      counts.set(term, (counts.get(term) ?? 0) + 1);
    }
  }
  return [...counts].filter(([, n]) => n >= 2).map(([t]) => t).sort();
}

const tail = (text: string, n: number) =>
  text.length > n ? `…${text.slice(-n)}` : text;
const oneLine = (text: string) => text.replace(/\s+/g, " ").trim();

interface State {
  userTurns: number;
  seen: string[];
}

// The whole session id: Codex ids are UUIDv7 and opencode ids start with a
// timestamp, so a short prefix is shared by sessions started close together.
const sessionKey = (id: string) => id.replace(/[^A-Za-z0-9_-]/g, "_");

function statePath(input: SessionInput): string {
  return `${input.tmpdir}/vocab-${input.agent}-${
    sessionKey(input.sessionId)
  }.json`;
}

function readState(path: string): State {
  try {
    const s = JSON.parse(readFileSync(path, "utf8"));
    return { userTurns: Number(s.userTurns) || 0, seen: s.seen ?? [] };
  } catch {
    return { userTurns: 0, seen: [] };
  }
}

export type Signal = "correction" | "clarification";

export interface Excerpt {
  signal: Signal;
  session: string;
  agent: string;
  repo: string;
  at: string;
  assistant?: string;
  user: string;
}

export interface Candidate {
  term: string;
  session: string;
  agent: string;
  repo: string;
  at: string;
}

const stateDir = (home: string) => `${home}/.local/state/vocab`;

async function appendJsonl(path: string, rows: unknown[]): Promise<void> {
  if (!rows.length) return;
  await mkdir(path.replace(/\/[^/]+$/, ""), { recursive: true });
  await appendFile(
    path,
    rows.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );
}

async function readJsonl<T>(path: string): Promise<T[]> {
  try {
    return (await readFile(path, "utf8")).split("\n").filter(Boolean)
      .flatMap((l) => {
        try {
          return [JSON.parse(l) as T];
        } catch {
          return [];
        }
      });
  } catch {
    return [];
  }
}

export async function proposeFromSession(
  input: SessionInput,
): Promise<ProposeResult> {
  const p = vaultPaths(input.home);
  if (input.cwd === p.root || input.cwd.startsWith(`${p.root}/`)) {
    return { recorded: 0, note: "vault の中のセッションは対象外" };
  }

  const path = statePath(input);
  const state = readState(path);
  const userIdx = input.turns
    .map((t, i) => (t.role === "user" ? i : -1))
    .filter((i) => i >= 0);
  const fresh = userIdx.slice(state.userTurns);
  if (fresh.length === 0) return { recorded: 0, note: "新しい発話なし" };

  const proposals = await loadProposals(p);
  const entries = effectiveEntries(await loadNotes(p), proposals);
  const known = new Set(
    [...entries.values()].flatMap((e) => [e.name, ...e.aliases])
      .concat(proposals.map((x) => x.term))
      .map((t) => t.toLowerCase()),
  );
  const privates = await privateNames(p);
  const at = (input.now ?? new Date()).toISOString();
  const origin = {
    session: input.sessionId,
    agent: input.agent,
    repo: input.repo,
    at,
  };

  const excerpts: Excerpt[] = [];
  for (const i of fresh) {
    const user = oneLine(input.turns[i].text).slice(0, 600);
    const prev = input.turns[i - 1];
    const assistant = prev?.role === "assistant"
      ? oneLine(tail(prev.text, 400))
      : undefined;
    const signal: Signal | null = CORRECTION.test(user)
      ? "correction"
      : assistant && QUESTION_END.test(assistant)
      ? "clarification"
      : null;
    if (!signal) continue;
    if (![user, assistant ?? ""].every((t) => isSafeText(t, privates))) {
      continue;
    }
    excerpts.push({ signal, ...origin, assistant, user });
  }

  const repeated = extractCandidates(
    userIdx.map((i) => input.turns[i].text),
    known,
  ).filter((t) => !state.seen.includes(t) && isSafeText(t, privates));

  await appendJsonl(`${stateDir(input.home)}/excerpts.jsonl`, excerpts);
  await appendJsonl(
    `${stateDir(input.home)}/candidates.jsonl`,
    repeated.map((term) => ({ term, ...origin })),
  );
  writeFileSync(
    path,
    JSON.stringify(
      {
        userTurns: userIdx.length,
        seen: [...state.seen, ...repeated],
      } satisfies State,
    ),
  );
  const recorded = excerpts.length + repeated.length;
  return { recorded, note: `${recorded} 件を記録` };
}

// --- Weekly ---

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const KEEP_MS = 30 * 24 * 60 * 60 * 1000;

async function userInvokedSkills(
  home: string,
): Promise<{ name: string; description: string }[]> {
  const root = `${home}/.claude/skills`;
  const out: { name: string; description: string }[] = [];
  try {
    for (const e of await readdir(root, { withFileTypes: true })) {
      try {
        const fm = splitFrontmatter(
          await readFile(`${root}/${e.name}/SKILL.md`, "utf8"),
        );
        if (fm?.data["disable-model-invocation"] !== true) continue;
        const description = String(fm.data.description ?? "").trim();
        const first = description.match(/^.*?[.。](?=\s|$)/)?.[0] ??
          description;
        out.push({ name: e.name, description: first });
      } catch {
        // A directory without SKILL.md is not a skill.
      }
    }
  } catch {
    // No skills root on this machine.
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

function alternativesSection(plan: string): string {
  const m = plan.match(
    /^### Alternatives Considered\n([\s\S]*?)(?=^#{1,3} |(?![\s\S]))/m,
  );
  return m ? m[1].trim() : "";
}

// Old records are dropped so the local state stays a rolling month.
async function prune(path: string, now: Date): Promise<void> {
  const rows = await readJsonl<{ at: string }>(path);
  const kept = rows.filter((r) => now.getTime() - Date.parse(r.at) <= KEEP_MS);
  if (kept.length === rows.length) return;
  await writeFile(
    path,
    kept.map((r) => JSON.stringify(r)).join("\n") + (kept.length ? "\n" : ""),
  );
}

export interface WeeklyResult {
  report: string[];
  packet: string;
}

// Writes the proposals that need no judgment (broken references, skills the
// owner invokes by name) and returns a packet of the week's material for the
// agent running /weekly-review to draft definitions from.
export async function weeklyProposals(o: {
  home: string;
  now: Date;
  today: string;
}): Promise<WeeklyResult> {
  const p = vaultPaths(o.home);
  const proposals = await loadProposals(p);
  // A rejected proposal is archived out of the top level; without it the same
  // skill or term would be proposed again every week.
  const rejected = await loadProposals(
    p,
    () => {},
    `${p.proposalsDir}/rejected`,
  );
  const notes = await loadNotes(p);
  const entries = effectiveEntries(notes, proposals);
  const known = new Set(
    [...entries.values()].flatMap((e) => [e.name, ...e.aliases])
      .concat(proposals.map((x) => x.term), rejected.map((x) => x.term))
      .map((t) => t.toLowerCase()),
  );
  const sameRefs = (a: string[], b: string[]) =>
    a.length === b.length && a.every((x) => b.includes(x));
  let room = AUTO_PENDING_LIMIT -
    proposals.filter((x) =>
      x.status === "pending" && AUTO_ORIGINS.has(x.origin)
    ).length;
  const written: string[] = [];
  const write = async (
    input: Parameters<typeof writeProposal>[1],
    evidence: string[],
  ) => {
    if (room <= 0) return;
    if (await writeProposal(p, input, evidence, o.today)) {
      room--;
      written.push(input.term);
      known.add(input.term.toLowerCase());
    }
  };

  for (const { note, kept, broken } of await refStatus(notes, o.home)) {
    if (!broken.length) continue;
    if (
      proposals.some((x) =>
        x.term === note.name && x.kind === "vocab-definition"
      ) ||
      rejected.some((x) =>
        x.term === note.name && x.kind === "vocab-definition" &&
        sameRefs(x.refersTo, kept)
      )
    ) continue;
    await write(
      {
        origin: "weekly",
        kind: "vocab-definition",
        term: note.name,
        definition: note.definition,
        refers_to: kept,
      },
      broken.map((b) =>
        `refers_to の参照切れ \`${b}\`。承認すると参照から外れる。移動先があるなら書き直してから承認する`
      ),
    );
  }

  const referenced = [...entries.values()].flatMap((e) => e.refersTo);
  for (const skill of await userInvokedSkills(o.home)) {
    if (
      known.has(skill.name.toLowerCase()) ||
      referenced.some((r) => r.endsWith(`/skills/${skill.name}/SKILL.md`))
    ) continue;
    await write(
      {
        origin: "weekly",
        kind: "vocab-new",
        term: skill.name,
        vocab_kind: "workflow",
        definition: skill.description,
        refers_to: [`~/.claude/skills/${skill.name}/SKILL.md`],
      },
      [`ユーザーが名前で呼び出すスキル \`/${skill.name}\` に語彙がない`],
    );
  }

  const dir = stateDir(o.home);
  await prune(`${dir}/excerpts.jsonl`, o.now);
  await prune(`${dir}/candidates.jsonl`, o.now);
  const week = <T extends { at: string }>(rows: T[]) =>
    rows.filter((r) => o.now.getTime() - Date.parse(r.at) <= WEEK_MS);
  const excerpts = week(await readJsonl<Excerpt>(`${dir}/excerpts.jsonl`));
  const candidates = week(
    await readJsonl<Candidate>(`${dir}/candidates.jsonl`),
  );

  const recurring = new Map<string, Candidate[]>();
  for (const c of candidates) {
    if (known.has(c.term.toLowerCase())) continue;
    recurring.set(c.term, [...(recurring.get(c.term) ?? []), c]);
  }
  const terms = [...recurring]
    .filter(([, rows]) => new Set(rows.map((r) => r.session)).size >= 2)
    .sort(([a], [b]) => a.localeCompare(b));

  const plansDir = `${o.home}/.claude/plans`;
  const plans: { name: string; section: string }[] = [];
  try {
    for (const e of await readdir(plansDir, { withFileTypes: true })) {
      if (!/^\d{8}T\d{4}-[^.]+\.md$/.test(e.name)) continue;
      const info = await stat(`${plansDir}/${e.name}`);
      if (o.now.getTime() - info.mtime.getTime() > WEEK_MS) continue;
      const section = alternativesSection(
        await readFile(`${plansDir}/${e.name}`, "utf8"),
      );
      if (section) plans.push({ name: e.name, section });
    }
  } catch {
    // No plans directory.
  }
  plans.sort((a, b) => a.name.localeCompare(b.name));

  const packet = [
    `# 語彙の週次の材料（${o.today}）`,
    "",
    `承認待ちの自動提案に追加できるのはあと ${Math.max(room, 0)} 件。` +
    "定義は下の根拠から読み取れる範囲だけで書き、" +
    "`vocab.ts add <term> --kind <kind> --definition <text> --draft --origin weekly` で提案する。",
    "",
    `## 訂正と確認への回答（${excerpts.length} 件）`,
    ...excerpts.flatMap((e) => [
      "",
      `### ${e.session}（${e.agent}, ${e.repo}, ${
        e.at.slice(0, 10)
      }）${e.signal}`,
      ...(e.assistant ? [`- エージェント: ${e.assistant}`] : []),
      `- ユーザー: ${e.user}`,
    ]),
    "",
    `## 繰り返し使われた未登録の語（${terms.length} 件）`,
    ...terms.map(([term, rows]) =>
      `- ${term}: ${new Set(rows.map((r) => r.session)).size} セッション（${
        [...new Set(rows.map((r) => r.agent))].join(", ")
      } / ${[...new Set(rows.map((r) => r.repo))].join(", ")}）`
    ),
    "",
    `## 今週の計画の採らなかった案（${plans.length} 件）`,
    ...plans.flatMap((pl) => ["", `### ${pl.name}`, pl.section]),
  ].join("\n");

  const report = [`週次の提案: ${written.length} 件を自動で提案`];
  if (room <= 0) {
    report.push(
      `承認待ちの自動提案が ${AUTO_PENDING_LIMIT} 件に達したため、残りは次回に回した`,
    );
  }
  return { report, packet };
}

// --- Short utterances from Claude transcripts (probes) ---

export interface Utterance {
  text: string;
  cwd: string;
  session: string;
  at: string;
  skill?: string;
  paths: string[];
}

export const SEED_SOURCES = "98_Maintenance/vocab-probe/seed-sources.json";

const COMMAND_NOISE =
  /^(<command-|<local-command-|<task-notification>|<bash-|<system-reminder>|\[Request interrupted|Caveat:|\/)/;

async function* transcripts(dir: string): AsyncGenerator<string> {
  try {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      if (e.name === "subagents") continue;
      const path = `${dir}/${e.name}`;
      if (e.isDirectory()) yield* transcripts(path);
      else if (e.name.endsWith(".jsonl")) yield path;
    }
  } catch {
    // Unreadable directories are skipped.
  }
}

// Each short owner instruction, with what the agent did right after it: the
// skill it invoked and the files it touched are the best hint at the intended
// reading, which the owner then confirms by hand.
export async function shortUtterances(
  home: string,
  sinceMs: number,
  maxChars: number,
): Promise<Utterance[]> {
  const vault = vaultPaths(home).root;
  const out: Utterance[] = [];
  for await (const path of transcripts(`${home}/.claude/projects`)) {
    const info = await stat(path);
    if (info.mtime.getTime() < sinceMs) continue;
    let current: Utterance | null = null;
    for (const line of (await readFile(path, "utf8")).split("\n")) {
      let e;
      try {
        e = JSON.parse(line);
      } catch {
        continue;
      }
      const content = e.message?.content;
      if (e.type === "user" && !e.isMeta && !e.isSidechain) {
        const text = typeof content === "string"
          ? content
          : Array.isArray(content)
          ? content.filter((b: { type: string }) => b.type === "text")
            .map((b: { text: string }) => b.text).join(" ")
          : "";
        const t = oneLine(text);
        if (!t) continue;
        current = null;
        const cwd = String(e.cwd ?? "");
        if (
          t.length > maxChars || COMMAND_NOISE.test(t) ||
          Date.parse(e.timestamp ?? "") < sinceMs ||
          cwd === vault || cwd.startsWith(`${vault}/`) ||
          cwd.includes("/.cache/claude-memo")
        ) continue;
        current = {
          text: t,
          cwd,
          session: String(e.sessionId ?? "").slice(0, 8),
          at: String(e.timestamp ?? ""),
          paths: [],
        };
        out.push(current);
      } else if (e.type === "assistant" && current && Array.isArray(content)) {
        for (const b of content) {
          if (b.type !== "tool_use") continue;
          if (b.name === "Skill" && !current.skill && b.input?.skill) {
            current.skill = String(b.input.skill);
          }
          const file = b.input?.file_path ?? b.input?.path;
          if (typeof file === "string" && current.paths.length < 3) {
            current.paths.push(file);
          }
        }
      }
    }
  }
  return out;
}
