import { assertEquals, assertThrows } from "@std/assert";
import { test } from "bun:test";
import { computeIsoWeekDates, isoWeekOf } from "./iso-week.ts";

test("W10 2026: Mon 03/02 - Sun 03/08", () => {
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

test("W01 2026: Mon 12/29 - Sun 01/04, prev=2025-W52", () => {
  const r = computeIsoWeekDates("2026-W01");
  assertEquals(r.dates[0], "2025-12-29");
  assertEquals(r.dates[6], "2026-01-04");
  assertEquals(r.prev, "2025-W52");
  assertEquals(r.next, "2026-W02");
});

test("W52 2026: 2026 has 53 weeks, so next=2026-W53", () => {
  const r = computeIsoWeekDates("2026-W52");
  assertEquals(r.prev, "2026-W51");
  assertEquals(r.next, "2026-W53");
});

test("W53 2026: Mon 12/28, prev=W52, next=2027-W01", () => {
  const r = computeIsoWeekDates("2026-W53");
  assertEquals(r.dates[0], "2026-12-28");
  assertEquals(r.prev, "2026-W52");
  assertEquals(r.next, "2027-W01");
});

test("W01 2021: prev=2020-W53", () => {
  assertEquals(computeIsoWeekDates("2021-W01").prev, "2020-W53");
});

test("a week the year does not have throws", () => {
  assertThrows(() => computeIsoWeekDates("2027-W53"));
  assertThrows(() => computeIsoWeekDates("2026-W54"));
  assertThrows(() => computeIsoWeekDates("2026-W00"));
  assertThrows(() => computeIsoWeekDates("W08"));
});

test("isoWeekOf uses the ISO year at year boundaries", () => {
  assertEquals(isoWeekOf("2025-12-29"), "2026-W01");
  assertEquals(isoWeekOf("2027-01-03"), "2026-W53");
  assertEquals(isoWeekOf("2026-11-06"), "2026-W45");
});

test("W53 2020: Mon 12/28 - Sun 01/03", () => {
  const r = computeIsoWeekDates("2020-W53");
  assertEquals(r.dates[0], "2020-12-28");
  assertEquals(r.dates[6], "2021-01-03");
});

test("W09 2026: crosses Feb/Mar boundary", () => {
  const r = computeIsoWeekDates("2026-W09");
  assertEquals(r.dates[0], "2026-02-23");
  assertEquals(r.dates[6], "2026-03-01");
  assertEquals(r.prev, "2026-W08");
  assertEquals(r.next, "2026-W10");
});
