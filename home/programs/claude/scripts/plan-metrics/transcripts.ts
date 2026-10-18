// Reads Claude Code transcripts (~/.claude/projects/**/*.jsonl) and their
// subagent files, and cuts each session into /plan segments.
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { createInterface } from "node:readline";
import { basename, join } from "node:path";

export type ToolUse = {
  id: string;
  name: string;
  input: Record<string, unknown>;
};
export type ToolResult = { toolUseId: string; isError: boolean; text: string };
export type Ev = {
  i: number;
  type: string;
  ts: number;
  uuid: string;
  sidechain: boolean;
  meta: boolean;
  userText: string | null;
  assistantText: string | null;
  toolUses: ToolUse[];
  toolResults: ToolResult[];
  outputTokens: number;
  cacheRead: number;
};
export type Session = {
  path: string;
  project: string;
  events: Ev[];
  badLines: number;
};

const TMP_PROJECT = /^-private-tmp-/;

function blockText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((b) =>
      (b && typeof b === "object" &&
          typeof (b as { text?: unknown }).text === "string")
        ? (b as { text: string }).text
        : ""
    )
    .join("\n");
}

function parseEvent(raw: Record<string, unknown>, i: number): Ev {
  const msg = (raw.message ?? {}) as {
    content?: unknown;
    usage?: Record<string, number>;
  };
  const content = msg.content;
  const type = String(raw.type ?? "");
  let userText: string | null = null;
  let assistantText: string | null = null;
  const toolUses: ToolUse[] = [];
  const toolResults: ToolResult[] = [];
  if (type === "user") {
    if (typeof content === "string") userText = content;
    else if (Array.isArray(content)) {
      const texts: string[] = [];
      for (const b of content) {
        if (!b || typeof b !== "object") continue;
        const block = b as {
          type?: string;
          text?: string;
          tool_use_id?: string;
          is_error?: boolean;
          content?: unknown;
        };
        if (block.type === "tool_result") {
          toolResults.push({
            toolUseId: String(block.tool_use_id ?? ""),
            isError: block.is_error === true,
            text: blockText(block.content),
          });
        } else if (block.type === "text" && typeof block.text === "string") {
          texts.push(block.text);
        }
      }
      if (toolResults.length === 0 && texts.length) userText = texts.join("\n");
    }
  } else if (type === "assistant" && Array.isArray(content)) {
    const texts: string[] = [];
    for (const b of content) {
      if (!b || typeof b !== "object") continue;
      const block = b as {
        type?: string;
        text?: string;
        id?: string;
        name?: string;
        input?: unknown;
      };
      if (block.type === "text" && typeof block.text === "string") {
        texts.push(block.text);
      } else if (block.type === "tool_use") {
        toolUses.push({
          id: String(block.id ?? ""),
          name: String(block.name ?? ""),
          input: (block.input && typeof block.input === "object"
            ? block.input
            : {}) as Record<string, unknown>,
        });
      }
    }
    const joined = texts.join("\n");
    if (joined.trim()) assistantText = joined;
  }
  const ts = typeof raw.timestamp === "string"
    ? Date.parse(raw.timestamp)
    : NaN;
  return {
    i,
    type,
    ts,
    uuid: String(raw.uuid ?? ""),
    sidechain: raw.isSidechain === true,
    meta: raw.isMeta === true,
    userText,
    assistantText,
    toolUses,
    toolResults,
    outputTokens: msg.usage?.output_tokens ?? 0,
    cacheRead: msg.usage?.cache_read_input_tokens ?? 0,
  };
}

/** Streams one transcript; a line that is not JSON is counted, not fatal. */
export async function readSession(
  path: string,
  project: string,
): Promise<Session> {
  const events: Ev[] = [];
  let badLines = 0;
  const rl = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  let i = 0;
  for await (const line of rl) {
    if (!line.trim()) continue;
    let raw: unknown;
    try {
      raw = JSON.parse(line);
    } catch {
      badLines++;
      continue;
    }
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      badLines++;
      continue;
    }
    events.push(parseEvent(raw as Record<string, unknown>, i++));
  }
  return { path, project, events, badLines };
}

export type SessionFile = { path: string; project: string; mtimeMs: number };
export type Listing = {
  files: SessionFile[];
  skippedTmp: number;
  skippedOld: number;
  missing: number;
};

/**
 * Main transcripts only (`<root>/<project>/<session>.jsonl`); subagents live one
 * directory deeper. Files older than `fromMs` by mtime are not opened: nothing
 * in a file is newer than its mtime. Transcripts rotate out after ~30 days, so
 * a directory or file can vanish mid-scan; that is counted, not raised.
 */
export async function listSessionFiles(
  root: string,
  opts: { fromMs: number; includeTmp: boolean },
): Promise<Listing> {
  const out: Listing = { files: [], skippedTmp: 0, skippedOld: 0, missing: 0 };
  let projects: string[];
  try {
    projects = (await readdir(root, { withFileTypes: true })).filter((d) =>
      d.isDirectory()
    ).map((d) => d.name);
  } catch {
    out.missing++;
    return out;
  }
  for (const project of projects) {
    if (!opts.includeTmp && TMP_PROJECT.test(project)) {
      out.skippedTmp++;
      continue;
    }
    let names: string[];
    try {
      names = (await readdir(join(root, project), { withFileTypes: true }))
        .filter((d) => d.isFile() && d.name.endsWith(".jsonl")).map((d) =>
          d.name
        );
    } catch {
      out.missing++;
      continue;
    }
    for (const name of names) {
      const path = join(root, project, name);
      let mtimeMs: number;
      try {
        mtimeMs = (await stat(path)).mtimeMs;
      } catch {
        out.missing++;
        continue;
      }
      if (mtimeMs < opts.fromMs) {
        out.skippedOld++;
        continue;
      }
      out.files.push({ path, project, mtimeMs });
    }
  }
  return out;
}

const PLAN_CMD = "<command-name>/plan</command-name>";
const IMPL_CMD = "<command-name>/impl</command-name>";
const GATE_CMD = "<command-name>/gate</command-name>";
const HANDOFF = /^## Plan ready/m;
const COMPLEXITY = /Complexity:\s*(trivial|small|medium|large|xl)/;
const SLUG = /plans\/([0-9]{8}T[0-9]{4}-[a-z0-9-]+)\.md/i;
// `## 確かめたこと` only exists since 2026-09-22; older reports end with `Full record:`.
const IMPL_END =
  /^## 確かめたこと|^## 決めてほしいこと|^Sidecar:|^Full record:/m;
const NOT_A_REPLY =
  /<task-notification>|Subagent hand-back|<agent-message|<command-name>/;
const RECOMMENDATION = /推奨|Recommend/i;
// Whole word, so an Explore agent described as "critical path" is not a critic.
const CRITIC_DESC = /\bcritics?\b|critique/i;
const ADVERSARIAL_DESC = /adversar|falsif/i;
const CRITIC_PROMPT = /You are an adversarial plan critic/i;
const ADVERSARIAL_PROMPT = /adversarial falsification agent/i;
const TEMPLATE_REF = /critic-prompt\.md|adversarial-prompt\.md/;

export type Question = {
  askTs: number;
  answerTs: number;
  waitMin: number;
  afterCritic: boolean;
  hasRecommendation: boolean;
  heading: string;
  answer: string;
};
export type SegmentState = "noHandoff" | "noImpl" | "noEnd" | "complete";
export type Segment = {
  project: string;
  sessionPath: string;
  startTs: number;
  handoff?: { ts: number; complexity: string; slug: string };
  implTs?: number;
  endTs?: number;
  state: SegmentState;
  questions: Question[];
  waitMin: number;
  /** Waiting after the last handoff and before /impl: real waiting, but outside the plan wall clock. */
  postHandoffWaitMin: number;
  planActiveMin?: number;
  implMin?: number;
  criticTs?: number;
  implToolInputChars: number;
  planStateInputChars: number;
  targetChanged: number;
};

function isReply(e: Ev): boolean {
  return e.type === "user" && e.userText !== null && !e.sidechain && !e.meta &&
    !NOT_A_REPLY.test(e.userText);
}

function skillUse(e: Ev, skill: string): boolean {
  return e.toolUses.some((t) => t.name === "Skill" && t.input.skill === skill);
}

function startsPlan(e: Ev): boolean {
  return (e.userText?.includes(PLAN_CMD) ?? false) || skillUse(e, "plan");
}

function startsImpl(e: Ev): boolean {
  return (e.userText?.includes(IMPL_CMD) ?? false) || skillUse(e, "impl");
}

function isCriticDispatch(t: ToolUse): boolean {
  if (t.name !== "Agent") return false;
  const desc = String(t.input.description ?? "");
  const prompt = String(t.input.prompt ?? "").slice(0, 400);
  return CRITIC_DESC.test(desc) || ADVERSARIAL_DESC.test(desc) ||
    CRITIC_PROMPT.test(prompt) || ADVERSARIAL_PROMPT.test(prompt);
}

/** One segment per `/plan` start; a later `/plan` in the same session closes the previous one. */
export function findPlanSegments(
  session: Session,
  opts: { fromMs: number; untimed?: { count: number } },
): Segment[] {
  const segs: Segment[] = [];
  const ev = session.events;
  const starts: number[] = [];
  for (const e of ev) if (startsPlan(e)) starts.push(e.i);
  for (let k = 0; k < starts.length; k++) {
    const from = starts[k];
    const to = k + 1 < starts.length ? starts[k + 1] : ev.length;
    const start = ev[from];
    if (Number.isNaN(start.ts)) {
      if (opts.untimed) opts.untimed.count++;
      continue;
    }
    if (start.ts < opts.fromMs) continue;
    const seg: Segment = {
      project: session.project,
      sessionPath: session.path,
      startTs: start.ts,
      state: "noHandoff",
      questions: [],
      waitMin: 0,
      postHandoffWaitMin: 0,
      implToolInputChars: 0,
      planStateInputChars: 0,
      targetChanged: 0,
    };
    let lastAsk: Ev | undefined;
    let handoffIdx = -1;
    // Waiting after a handoff only belongs to the plan wall clock if another handoff follows.
    let pendingWait = 0;
    for (let i = from + 1; i < to; i++) {
      const e = ev[i];
      if (seg.criticTs === undefined && e.toolUses.some(isCriticDispatch)) {
        seg.criticTs = e.ts;
      }
      if (seg.implTs === undefined) {
        if (e.assistantText && HANDOFF.test(e.assistantText)) {
          seg.handoff = {
            ts: e.ts,
            complexity: COMPLEXITY.exec(e.assistantText)?.[1] ?? "?",
            slug: SLUG.exec(e.assistantText)?.[1] ?? "",
          };
          handoffIdx = i;
          seg.waitMin += pendingWait;
          pendingWait = 0;
          lastAsk = e;
          continue;
        }
        if (e.assistantText) lastAsk = e;
        else if (isReply(e) && lastAsk) {
          const waitMin = (e.ts - lastAsk.ts) / 60000;
          // A reply after the handoff (a correction before /impl) is waiting time, not a question turn.
          if (handoffIdx < 0) {
            seg.waitMin += waitMin;
            seg.questions.push({
              askTs: lastAsk.ts,
              answerTs: e.ts,
              waitMin,
              afterCritic: seg.criticTs !== undefined &&
                lastAsk.ts > seg.criticTs,
              hasRecommendation: RECOMMENDATION.test(
                lastAsk.assistantText ?? "",
              ),
              heading: (lastAsk.assistantText?.match(/^###\s+(.*)$/m)?.[1] ??
                lastAsk.assistantText?.split("\n")[0] ?? "").trim(),
              answer: (e.userText ?? "").trim().split("\n")[0].slice(0, 60),
            });
          } else pendingWait += waitMin;
          lastAsk = undefined;
        }
        if (seg.handoff && startsImpl(e)) seg.implTs = e.ts;
        continue;
      }
      if (seg.endTs !== undefined) continue;
      for (const t of e.toolUses) {
        const chars = JSON.stringify(t.input).length;
        seg.implToolInputChars += chars;
        if (
          t.name === "Bash" &&
          String(t.input.command ?? "").includes("plan-state.ts")
        ) seg.planStateInputChars += chars;
      }
      for (const r of e.toolResults) {
        if (
          r.isError && r.text.includes("target changed during verification")
        ) seg.targetChanged++;
      }
      if (
        seg.endTs === undefined && e.assistantText &&
        IMPL_END.test(e.assistantText)
      ) seg.endTs = e.ts;
    }
    seg.postHandoffWaitMin = pendingWait;
    if (seg.handoff) {
      seg.planActiveMin = (seg.handoff.ts - seg.startTs) / 60000 - seg.waitMin;
      seg.state = seg.implTs === undefined
        ? "noImpl"
        : seg.endTs === undefined
        ? "noEnd"
        : "complete";
      if (seg.implTs !== undefined && seg.endTs !== undefined) {
        seg.implMin = (seg.endTs - seg.implTs) / 60000;
      }
    }
    segs.push(seg);
  }
  return segs;
}

export type AgentKind = "critic" | "adversarial" | "other" | "unparsed";

/** Description first (it is what the parent typed), then the template's own opening line; critic before adversarial because the critic template also says "adversarial". */
export function classifyKind(description: string, prompt: string): AgentKind {
  if (CRITIC_DESC.test(description)) return "critic";
  if (ADVERSARIAL_DESC.test(description)) return "adversarial";
  if (CRITIC_PROMPT.test(prompt)) return "critic";
  if (ADVERSARIAL_PROMPT.test(prompt)) return "adversarial";
  if (TEMPLATE_REF.test(prompt)) return "unparsed";
  return "other";
}

export type Subagent = {
  id: string;
  kind: AgentKind;
  description: string;
  toolUseId: string;
  startTs: number;
  durMin: number;
  out: number;
  cacheRead: number;
  tools: number;
  report: string;
  errorResults: string[];
};

export type SubagentJoin = {
  agents: Subagent[];
  unparsedKind: number;
  badLines: number;
  missing: number;
  badMeta: number;
};

export async function joinSubagents(session: Session): Promise<SubagentJoin> {
  const dir = join(session.path.replace(/\.jsonl$/, ""), "subagents");
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => /^agent-.*\.jsonl$/.test(n));
  } catch {
    return { agents: [], unparsedKind: 0, badLines: 0, missing: 0, badMeta: 0 };
  }
  const agents: Subagent[] = [];
  let unparsedKind = 0, badLines = 0, missing = 0, badMeta = 0;
  for (const name of names) {
    const id = basename(name, ".jsonl").replace(/^agent-/, "");
    let meta:
      | { agentType?: string; description?: string; toolUseId?: string }
      | null = null;
    try {
      meta = JSON.parse(
        await readFile(join(dir, `agent-${id}.meta.json`), "utf8"),
      );
    } catch {
      meta = null;
    }
    let sub: Session;
    try {
      sub = await readSession(join(dir, name), session.project);
    } catch {
      missing++;
      continue;
    }
    if (meta === null) badMeta++;
    badLines += sub.badLines;
    const first = sub.events.find((e) => !Number.isNaN(e.ts));
    const last = [...sub.events].reverse().find((e) => !Number.isNaN(e.ts));
    let out = 0, cacheRead = 0, tools = 0, report = "", prompt = "";
    for (const e of sub.events) {
      if (e.type === "user" && !prompt && e.userText) prompt = e.userText;
      if (e.type !== "assistant") continue;
      out += e.outputTokens;
      cacheRead += e.cacheRead;
      tools += e.toolUses.length;
      for (const t of e.toolUses) {
        if (t.name === "SubagentHandback") {
          report = String(t.input.message ?? "");
        }
      }
      if (!report && e.assistantText && e.assistantText.length > 400) {
        report = e.assistantText;
      }
    }
    if (!report) {
      report = [...sub.events].reverse().find((e) =>
        e.assistantText
      )?.assistantText ?? "";
    }
    const description = typeof meta?.description === "string"
      ? meta.description
      : "";
    const kind = classifyKind(description, prompt);
    if (kind === "unparsed") unparsedKind++;
    agents.push({
      id,
      kind,
      description,
      toolUseId: typeof meta?.toolUseId === "string" ? meta.toolUseId : "",
      startTs: first?.ts ?? NaN,
      durMin: first && last ? (last.ts - first.ts) / 60000 : 0,
      out,
      cacheRead,
      tools,
      report,
      errorResults: sub.events.flatMap((e) =>
        e.toolResults.filter((r) => r.isError).map((r) => r.text)
      ),
    });
  }
  return { agents, unparsedKind, badLines, missing, badMeta };
}

/** `/gate --diff-only` appears as a slash command (user text) or a Skill tool_use; both are counted once by their own id. */
export function countDiffOnlyCalls(session: Session): number {
  const ids = new Set<string>();
  for (const e of session.events) {
    if (e.userText?.includes(GATE_CMD) && e.userText.includes("--diff-only")) {
      ids.add(`u:${e.uuid || e.i}`);
    }
    for (const t of e.toolUses) {
      if (
        t.name === "Skill" && t.input.skill === "gate" &&
        String(t.input.args ?? "").includes("--diff-only")
      ) ids.add(`t:${t.id || e.i}`);
    }
  }
  return ids.size;
}

/** Only failed tool results: the same strings also appear when a skill or script source is read. */
export function errorResultTexts(session: Session): string[] {
  return session.events.flatMap((e) =>
    e.toolResults.filter((r) => r.isError).map((r) => r.text)
  );
}

/** Sidecar names start with the plan's local creation time (`YYYYMMDDTHHmm`, +09:00). */
export function sidecarTime(name: string): number | null {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})/.exec(name);
  if (!m) return null;
  return Date.parse(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:00+09:00`);
}
