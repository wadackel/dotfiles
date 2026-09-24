import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import { BridgeError } from "./gas-client.ts";
import { buildEvent, createEventChecked } from "./gcal-mcp.ts";

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

type Listed = {
  summary: string;
  start: { date: string } | { dateTime: string };
  organizerSelf: boolean;
  hermesTrail: boolean;
};

const allDay = buildEvent({ ...base, start: "2026-10-31" });
const timed = buildEvent({ ...base, start: "2026-10-03T17:00" });
const listed = (over: Partial<Listed> = {}): Listed => ({
  summary: base.summary,
  start: { date: "2026-10-31" },
  organizerSelf: true,
  hermesTrail: true,
  ...over,
});
const http404 = () =>
  new BridgeError(
    "createEvent: HTTP 404",
    'final host/echo, text/html, title "x"',
  );

// Stands in for callBridge: createEvent fails with `failure`, listEvents
// answers `events` (or throws it), and every call is kept for the asserts.
function fakeBridge(failure: Error | undefined, events: Listed[] | Error) {
  const calls: [string, Record<string, unknown>][] = [];
  const call = (action: string, params: Record<string, unknown>) => {
    calls.push([action, params]);
    if (action === "createEvent") {
      return failure
        ? Promise.reject(failure)
        : Promise.resolve({ htmlLink: "https://calendar/e1" });
    }
    return events instanceof Error
      ? Promise.reject(events)
      : Promise.resolve(events);
  };
  return { call, calls };
}

async function withLog(fn: (log: () => string) => Promise<void>) {
  const home = await Deno.makeTempDir();
  const prevHome = Deno.env.get("HOME");
  Deno.env.set("HOME", home);
  await Deno.mkdir(`${home}/Library/Logs`, { recursive: true });
  try {
    await fn(() => {
      try {
        return Deno.readTextFileSync(`${home}/Library/Logs/hermes-scripts.log`);
      } catch {
        return "";
      }
    });
  } finally {
    if (prevHome) Deno.env.set("HOME", prevHome);
    await Deno.remove(home, { recursive: true });
  }
}

Deno.test("a created event is returned without listing anything", async () => {
  await withLog(async () => {
    const { call, calls } = fakeBridge(undefined, []);
    assertEquals(await createEventChecked(allDay, call), {
      htmlLink: "https://calendar/e1",
    });
    assertEquals(calls.map(([a]) => a), ["createEvent"]);
  });
});

Deno.test("an event saved before the bridge failed counts as created", async () => {
  await withLog(async (log) => {
    const { call, calls } = fakeBridge(http404(), [
      listed({ summary: "別の予定" }),
      listed(),
    ]);
    assertEquals(await createEventChecked(allDay, call), { confirmed: true });
    assertEquals(calls[1], [
      "listEvents",
      { from: "2026-10-31", to: "2026-11-01" },
    ]);
    assertStringIncludes(
      log(),
      "createEvent failed (createEvent: HTTP 404); confirmed on the calendar for 2026-10-31",
    );
    assert(!log().includes(base.summary), "log leaks the mail-derived title");
  });
});

Deno.test("a timed event matches the listed local date-time", async () => {
  await withLog(async () => {
    const { call, calls } = fakeBridge(new Error("createEvent: timed out"), [
      listed({ start: { dateTime: "2026-10-03T17:00:00+09:00" } }),
    ]);
    assertEquals(await createEventChecked(timed, call), { confirmed: true });
    assertEquals(calls[1][1], { from: "2026-10-03", to: "2026-10-04" });
  });
});

Deno.test("a near miss on the calendar is still a failure", async () => {
  await withLog(async () => {
    for (
      const miss of [
        listed({ summary: "別の予定" }),
        listed({ hermesTrail: false }),
        listed({ organizerSelf: false }),
        listed({ start: { date: "2026-11-01" } }),
        listed({ start: { dateTime: "2026-10-31T09:00:00+09:00" } }),
      ]
    ) {
      await assertRejects(
        () => createEventChecked(allDay, fakeBridge(http404(), [miss]).call),
        BridgeError,
        "createEvent: HTTP 404",
      );
    }
  });
});

Deno.test("the original error stands when listing fails too", async () => {
  await withLog(async () => {
    await assertRejects(
      () =>
        createEventChecked(
          allDay,
          fakeBridge(http404(), new Error("listEvents: HTTP 404")).call,
        ),
      BridgeError,
      "createEvent: HTTP 404",
    );
  });
});

Deno.test("an error the bridge reported is not checked against the calendar", async () => {
  await withLog(async () => {
    const reported = new BridgeError(
      "createEvent: Exception: invalid time",
      "",
      true,
    );
    const { call, calls } = fakeBridge(reported, [listed()]);
    await assertRejects(
      () => createEventChecked(allDay, call),
      BridgeError,
      "invalid time",
    );
    assertEquals(calls.map(([a]) => a), ["createEvent"]);
  });
});
