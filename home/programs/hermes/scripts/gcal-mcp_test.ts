import {
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import { buildEvent } from "./gcal-mcp.ts";

const base = { summary: "課題の締切", source_message_id: "m1" };

Deno.test("an all-day event without end lasts one day (exclusive end)", () => {
  const ev = buildEvent({ ...base, start: "2026-09-30" });
  assertEquals(ev.start, { date: "2026-09-30" });
  assertEquals(ev.end, { date: "2026-10-01" });
});

Deno.test("a timed event without end lasts 30 minutes in Asia/Tokyo", () => {
  const ev = buildEvent({ ...base, start: "2026-09-30T09:45" });
  assertEquals(ev.start, {
    dateTime: "2026-09-30T09:45:00",
    timeZone: "Asia/Tokyo",
  });
  assertEquals(ev.end, {
    dateTime: "2026-09-30T10:15:00",
    timeZone: "Asia/Tokyo",
  });
});

Deno.test("timed events always carry seconds, which Calendar requires", () => {
  const ev = buildEvent({
    ...base,
    start: "2026-10-03T17:00:30",
    end: "2026-10-03T18:00",
  });
  assertEquals(ev.start, {
    dateTime: "2026-10-03T17:00:00",
    timeZone: "Asia/Tokyo",
  });
  assertEquals(ev.end, {
    dateTime: "2026-10-03T18:00:00",
    timeZone: "Asia/Tokyo",
  });
});

Deno.test("the description always points back to the source mail", () => {
  assertStringIncludes(
    buildEvent({ ...base, start: "2026-09-30" }).description,
    "message m1",
  );
  const ev = buildEvent({
    ...base,
    start: "2026-09-30",
    description: "レポート提出",
  });
  assertStringIncludes(ev.description, "レポート提出\n\nCreated by Hermes");
});

Deno.test("invalid or mixed times are rejected", () => {
  assertThrows(() => buildEvent({ ...base, start: "明日" }));
  assertThrows(() => buildEvent({ ...base, start: "2026-09-30T10:00+09:00" }));
  assertThrows(() =>
    buildEvent({ ...base, start: "2026-09-30", end: "2026-09-30T12:00" })
  );
  assertThrows(() => buildEvent({ ...base, start: "2026-09-30T23:45" }));
});
