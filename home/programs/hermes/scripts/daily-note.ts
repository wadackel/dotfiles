// Pure helpers for the daily note Hermes prepares every morning.
//
// The output must match what Templates/Daily_Template.md renders in the vault:
// the Stop hook inserts memo entries before `## 📕 Reading`, and daily-mining
// and /weekly-review find sections by these exact heading strings.

import { MONTHLY_EMOTION } from "./monthly-emotion.ts";

export const HEADINGS = {
  today: "## 🌅 Today",
  todo: "## 📝 To-Do",
  tasks: "## 🧑‍💻 Tasks",
  memo: "## ✍️ Memo",
  reading: "## 📕 Reading",
  notes: "## 🐾 Today's Notes",
} as const;

// Dates are plain YYYY-MM-DD strings handled in UTC so that no local-time
// offset can shift a day.
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 || day === 6;
}

// Mirrors moment's `YYYY-[W]WW` in the template: calendar year with the ISO
// week number, including its quirk around New Year.
export function weeklyNoteName(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() + 3 - ((d.getUTCDay() + 6) % 7));
  const yearStart = Date.UTC(thursday.getUTCFullYear(), 0, 1);
  const week = Math.ceil(
    ((thursday.getTime() - yearStart) / 86_400_000 + 1) / 7,
  );
  return `${date.slice(0, 4)}-W${String(week).padStart(2, "0")}`;
}

// Returns the body between `heading` and the next `## ` heading, trimmed, or
// undefined when the heading is absent.
export function getSection(note: string, heading: string): string | undefined {
  const lines = note.split("\n");
  const start = lines.findIndex((l) => l === heading);
  if (start === -1) return undefined;
  let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end).join("\n").trim();
}

const CHECKBOX = /^(\s*)- \[(.)\] /;

function indentOf(line: string): number {
  return line.match(/^\s*/)![0].length;
}

// Drops every `[x]` item together with the lines nested under it. Open `[ ]`,
// in-progress `[-]` and plain lines are kept untouched.
export function cleanChecklist(body: string): string {
  const out: string[] = [];
  let skipDeeperThan: number | undefined;
  for (const line of body.split("\n")) {
    if (skipDeeperThan !== undefined) {
      if (line.trim() === "" || indentOf(line) > skipDeeperThan) continue;
      skipDeeperThan = undefined;
    }
    const m = line.match(CHECKBOX);
    if (m && m[2].toLowerCase() === "x") {
      skipDeeperThan = m[1].length;
      continue;
    }
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function bases(date: string): { reading: string; notes: string } {
  return {
    reading: [
      "```base",
      "views:",
      "  - type: table",
      "    name: Table",
      "    filters:",
      "      and:",
      '        - file.hasTag("memo/web")',
      `        - date == "${date}"`,
      "```",
    ].join("\n"),
    notes: [
      "```base",
      "views:",
      "  - type: table",
      "    name: Table",
      "    filters:",
      "      and:",
      `        - '!file.hasTag("memo/web")'`,
      `        - file.ctime == "${date}"`,
      `        - file.name != "${date}"`,
      "```",
    ].join("\n"),
  };
}

export type RenderInput = {
  date: string;
  // Present on working days; undefined renders a weekend/holiday note.
  checklists?: { todo: string; tasks: string };
};

export function renderNote({ date, checklists }: RenderInput): string {
  const { reading, notes } = bases(date);
  const parts = [
    [
      "---",
      "tags:",
      "  - daily",
      `weekly: "[[${weeklyNoteName(date)}]]"`,
      `previous: "[[${addDays(date, -1)}]]"`,
      `next: "[[${addDays(date, 1)}]]"`,
      "commute: false",
      "emotion: 0",
      "---",
    ].join("\n"),
  ];
  if (checklists) {
    parts.push(
      HEADINGS.todo,
      checklists.todo || "- [ ] tba",
      HEADINGS.tasks,
      checklists.tasks || "- tba",
    );
  }
  parts.push(HEADINGS.memo, HEADINGS.reading, reading, HEADINGS.notes, notes);
  if (date.slice(8) === "01") parts.push(MONTHLY_EMOTION);
  return parts.join("\n\n") + "\n";
}

function itemKey(line: string): string {
  return line.replace(CHECKBOX, "").trim();
}

// For each open top-level To-Do of the newest note, counts how many
// consecutive working-day notes (newest first) contain it.
export function staleTodos(
  todoSections: string[],
  minDays: number,
): { item: string; days: number }[] {
  if (todoSections.length === 0) return [];
  const topLevel = (body: string) =>
    body.split("\n").filter((l) => /^- \[[ -]\] /.test(l)).map(itemKey);
  const history = todoSections.map((s) => new Set(topLevel(s)));
  return topLevel(todoSections[0])
    .map((item) => {
      let days = 0;
      while (days < history.length && history[days].has(item)) days++;
      return { item, days };
    })
    .filter((s) => s.days >= minDays);
}

// Places `## 🌅 Today` right above the checklists (or Memo on days without
// them), replacing an earlier briefing if one exists.
export function upsertBriefing(note: string, briefing: string): string {
  const lines = note.split("\n");
  const block = [HEADINGS.today, "", briefing.trim(), ""];
  const start = lines.findIndex((l) => l === HEADINGS.today);
  if (start !== -1) {
    let end = lines.findIndex((l, i) => i > start && l.startsWith("## "));
    if (end === -1) end = lines.length;
    lines.splice(start, end - start, ...block);
    return lines.join("\n");
  }
  let anchor = lines.findIndex((l) => l === HEADINGS.todo);
  if (anchor === -1) anchor = lines.findIndex((l) => l === HEADINGS.memo);
  if (anchor === -1) {
    throw new Error(`no ${HEADINGS.todo} or ${HEADINGS.memo} heading`);
  }
  lines.splice(anchor, 0, ...block);
  return lines.join("\n");
}

export function tokyoDate(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(
    now,
  );
}

export function dailyDir(): string {
  const home = Deno.env.get("HOME");
  if (!home) throw new Error("HOME is not set");
  return `${home}/Documents/Main/99_Tracking/Daily`;
}

// Obsidian ignores dot-files, so a half-written note is never indexed or
// picked up by Templater's on-create trigger; the rename makes it appear whole.
export async function writeNoteAtomically(
  path: string,
  content: string,
): Promise<void> {
  const dir = path.slice(0, path.lastIndexOf("/"));
  const tmp = `${dir}/.hermes-${crypto.randomUUID()}.tmp`;
  await Deno.writeTextFile(tmp, content);
  await Deno.rename(tmp, path);
}
