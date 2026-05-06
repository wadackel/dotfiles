import { assertEquals } from "jsr:@std/assert";
import { computeIsoWeekDates } from "./iso-week.ts";

Deno.test("W10 2026: Mon 03/02 - Sun 03/08", () => {
  const r = computeIsoWeekDates("2026-W10");
  assertEquals(r.dates, [
    "2026-03-02",
    "2026-03-03",
    "2026-03-04",
    "2026-03-05",
    "2026-03-06",
    "2026-03-07",
    "2026-03-08",
  ]);
  assertEquals(r.prev, "2026-W09");
  assertEquals(r.next, "2026-W11");
});

Deno.test("W01 2026: Mon 12/29 - Sun 01/04, prev=2025-W52", () => {
  const r = computeIsoWeekDates("2026-W01");
  assertEquals(r.dates[0], "2025-12-29");
  assertEquals(r.dates[6], "2026-01-04");
  assertEquals(r.prev, "2025-W52");
  assertEquals(r.next, "2026-W02");
});

Deno.test("W52 2026: prev=W51, next=2027-W01", () => {
  const r = computeIsoWeekDates("2026-W52");
  assertEquals(r.prev, "2026-W51");
  assertEquals(r.next, "2027-W01");
});

Deno.test("W53 2020: Mon 12/28 - Sun 01/03", () => {
  const r = computeIsoWeekDates("2020-W53");
  assertEquals(r.dates[0], "2020-12-28");
  assertEquals(r.dates[6], "2021-01-03");
});

Deno.test("W09 2026: crosses Feb/Mar boundary", () => {
  const r = computeIsoWeekDates("2026-W09");
  assertEquals(r.dates[0], "2026-02-23");
  assertEquals(r.dates[6], "2026-03-01");
  assertEquals(r.prev, "2026-W08");
  assertEquals(r.next, "2026-W10");
});
