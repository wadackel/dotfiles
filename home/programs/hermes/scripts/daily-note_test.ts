import { assert, assertEquals, assertThrows } from "jsr:@std/assert@1";
import {
  cleanChecklist,
  getSection,
  HEADINGS,
  renderNote,
  staleTodos,
  upsertBriefing,
  weeklyNoteName,
} from "./daily-note.ts";

Deno.test("cleanChecklist drops done items with their children and keeps the rest", () => {
  const body = [
    "- [x] Unite - 移行手順書作成",
    "    - メモ",
    "- [-] Misc - OKR 策定",
    "- [ ] Misc - 技術書典",
    "    - [x] テーマ検討",
    "    - [ ] アウトライン",
    "- 補足の行",
  ].join("\n");
  assertEquals(
    cleanChecklist(body),
    [
      "- [-] Misc - OKR 策定",
      "- [ ] Misc - 技術書典",
      "    - [ ] アウトライン",
      "- 補足の行",
    ].join("\n"),
  );
});

Deno.test("getSection returns the body up to the next heading", () => {
  const note =
    `${HEADINGS.todo}\n\n- [ ] a\n\n${HEADINGS.tasks}\n\n- b\n\n${HEADINGS.memo}\n`;
  assertEquals(getSection(note, HEADINGS.todo), "- [ ] a");
  assertEquals(getSection(note, HEADINGS.tasks), "- b");
  assertEquals(getSection(note, HEADINGS.today), undefined);
});

Deno.test("weeklyNoteName follows ISO weeks like the template", () => {
  assertEquals(weeklyNoteName("2026-09-18"), "2026-W38");
  assertEquals(weeklyNoteName("2026-09-21"), "2026-W39");
  assertEquals(weeklyNoteName("2027-01-01"), "2027-W53");
});

Deno.test("renderNote on a working day matches the template layout", () => {
  const note = renderNote({
    date: "2026-09-18",
    checklists: { todo: "- [ ] a", tasks: "- [ ] b" },
  });
  assert(
    note.startsWith(
      '---\ntags:\n  - daily\nweekly: "[[2026-W38]]"\nprevious: "[[2026-09-17]]"',
    ),
  );
  const headings = note.split("\n").filter((l) => l.startsWith("## "));
  assertEquals(headings, [
    HEADINGS.todo,
    HEADINGS.tasks,
    HEADINGS.memo,
    HEADINGS.reading,
    HEADINGS.notes,
  ]);
  assert(note.includes('        - date == "2026-09-18"'));
  assert(note.includes('        - file.name != "2026-09-18"'));
});

Deno.test("renderNote without checklists omits To-Do and Tasks; the 1st adds Monthly Emotion", () => {
  const weekend = renderNote({ date: "2026-09-19" });
  assert(!weekend.includes(HEADINGS.todo));
  assert(!weekend.includes("Monthly Emotion"));
  assert(renderNote({ date: "2026-10-01" }).includes("## 📊 Monthly Emotion"));
});

Deno.test("renderNote falls back to the template placeholders", () => {
  const note = renderNote({
    date: "2026-09-18",
    checklists: { todo: "", tasks: "" },
  });
  assertEquals(getSection(note, HEADINGS.todo), "- [ ] tba");
  assertEquals(getSection(note, HEADINGS.tasks), "- tba");
});

Deno.test("staleTodos counts consecutive days for open top-level items", () => {
  const newestFirst = [
    "- [ ] A\n- [-] B\n- [ ] C\n    - [ ] sub",
    "- [ ] A\n- [ ] B",
    "- [ ] A\n- [ ] B",
    "- [ ] A",
  ];
  assertEquals(staleTodos(newestFirst, 3), [
    { item: "A", days: 4 },
    { item: "B", days: 3 },
  ]);
});

Deno.test("upsertBriefing inserts above To-Do, falls back to Memo, and replaces", () => {
  const working = renderNote({
    date: "2026-09-18",
    checklists: { todo: "- [ ] a", tasks: "" },
  });
  const once = upsertBriefing(working, "- first");
  const lines = once.split("\n").filter((l) => l.startsWith("## "));
  assertEquals(lines.slice(0, 2), [HEADINGS.today, HEADINGS.todo]);
  const twice = upsertBriefing(once, "- second");
  assertEquals(getSection(twice, HEADINGS.today), "- second");
  assertEquals(twice.split(HEADINGS.today).length, 2);

  const weekend = upsertBriefing(renderNote({ date: "2026-09-19" }), "- x");
  assertEquals(
    weekend.split("\n").filter((l) => l.startsWith("## "))[0],
    HEADINGS.today,
  );
  assertThrows(() => upsertBriefing("no headings", "- x"));
});
