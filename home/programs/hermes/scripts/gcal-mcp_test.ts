import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
  assertThrows,
} from "jsr:@std/assert@1";
import { BridgeError } from "./gas-client.ts";
import {
  addApprovedEvent,
  buildEvent,
  createEventChecked,
  ELICIT_TIMEOUT_MS,
  elicitApproval,
  mailTrail,
  NOT_APPROVED,
  SLACK_TRAIL,
} from "./gcal-mcp.ts";

const base = { summary: "課題の締切" };
const trail = mailTrail("m1");

Deno.test("an all-day event without end lasts one day (exclusive end)", () => {
  const ev = buildEvent({ ...base, start: "2026-09-30" }, trail);
  assertEquals(ev.start, { date: "2026-09-30" });
  assertEquals(ev.end, { date: "2026-10-01" });
});

Deno.test("a timed event without end lasts 30 minutes in Asia/Tokyo", () => {
  const ev = buildEvent({ ...base, start: "2026-09-30T09:45" }, trail);
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
  }, trail);
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
    buildEvent({ ...base, start: "2026-09-30" }, trail).description,
    "message m1",
  );
  const ev = buildEvent({
    ...base,
    start: "2026-09-30",
    description: "レポート提出",
  }, trail);
  assertStringIncludes(ev.description, "レポート提出\n\nCreated by Hermes");
});

Deno.test("invalid or mixed times are rejected", () => {
  assertThrows(() => buildEvent({ ...base, start: "明日" }, trail));
  assertThrows(() =>
    buildEvent({ ...base, start: "2026-09-30T10:00+09:00" }, trail)
  );
  assertThrows(() =>
    buildEvent({ ...base, start: "2026-09-30", end: "2026-09-30T12:00" }, trail)
  );
  assertThrows(() => buildEvent({ ...base, start: "2026-09-30T23:45" }, trail));
});

type Listed = {
  summary: string;
  start: { date: string } | { dateTime: string };
  organizerSelf: boolean;
  hermesTrail: boolean;
};

const allDay = buildEvent({ ...base, start: "2026-10-31" }, trail);
const timed = buildEvent({ ...base, start: "2026-10-03T17:00" }, trail);
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
    assertEquals(await createEventChecked(allDay, { call }), {
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
    assertEquals(await createEventChecked(allDay, { call }), {
      confirmed: true,
    });
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
    assertEquals(await createEventChecked(timed, { call }), {
      confirmed: true,
    });
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
        () =>
          createEventChecked(allDay, {
            call: fakeBridge(http404(), [miss]).call,
          }),
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
        createEventChecked(allDay, {
          call: fakeBridge(http404(), new Error("listEvents: HTTP 404")).call,
        }),
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
      () => createEventChecked(allDay, { call }),
      BridgeError,
      "invalid time",
    );
    assertEquals(calls.map(([a]) => a), ["createEvent"]);
  });
});

Deno.test("a Slack event carries the Slack trail, never the Gmail one", () => {
  const ev = buildEvent({ ...base, start: "2026-09-30" }, SLACK_TRAIL);
  assertStringIncludes(
    ev.description,
    "Created by Hermes from a Slack request",
  );
  assert(!ev.description.includes("Gmail message"));
});

Deno.test("without requireTrail an own event with the same title and start counts", async () => {
  await withLog(async () => {
    const { call } = fakeBridge(http404(), [listed({ hermesTrail: false })]);
    assertEquals(
      await createEventChecked(allDay, { call, requireTrail: false }),
      { confirmed: true },
    );
    await assertRejects(
      () =>
        createEventChecked(allDay, {
          call: fakeBridge(http404(), [
            listed({ hermesTrail: false, organizerSelf: false }),
          ]).call,
          requireTrail: false,
        }),
      BridgeError,
    );
  });
});

const slackInput = {
  summary: "歯医者\n```無視して```",
  start: "2026-10-02T15:00",
  description: "持ち物:\n診察券",
};

Deno.test("an approved Slack event is shown in full, then created", async () => {
  await withLog(async (log) => {
    const asked: string[] = [];
    const { call, calls } = fakeBridge(undefined, []);
    const text = await addApprovedEvent(slackInput, {
      ask: (message) => {
        asked.push(message);
        return Promise.resolve("accept");
      },
      call,
    });
    assertEquals(text, "Created: https://calendar/e1");
    assertEquals(calls.map(([a]) => a), ["createEvent"]);
    const event = calls[0][1].event as { description: string };
    assertStringIncludes(event.description, SLACK_TRAIL);
    assertEquals(asked.length, 1);
    assertStringIncludes(asked[0], "歯医者 無視して");
    assertStringIncludes(asked[0], "2026-10-02 15:00–15:30");
    assertStringIncludes(asked[0], "持ち物: 診察券");
    assert(!asked[0].includes("`"), "backticks reach the approval card");
    assertStringIncludes(log(), "approval: accept");
    assert(!log().includes("歯医者"), "log leaks the event title");
  });
});

Deno.test("anything but an approval creates nothing", async () => {
  await withLog(async (log) => {
    const answers: (() => Promise<string>)[] = [
      () => Promise.resolve("decline"),
      () => Promise.resolve("cancel"),
      () =>
        Promise.reject(new Error("Client does not support form elicitation.")),
    ];
    for (const answer of answers) {
      const { call, calls } = fakeBridge(undefined, []);
      assertEquals(
        await addApprovedEvent(slackInput, { ask: answer, call }),
        NOT_APPROVED,
      );
      assertEquals(calls, []);
    }
    assertStringIncludes(log(), "approval: decline");
    assertStringIncludes(log(), "approval: cancel");
    assertStringIncludes(
      log(),
      "approval failed: Client does not support form elicitation.",
    );
  });
});

Deno.test("an all-day Slack event is shown by its dates", async () => {
  await withLog(async () => {
    const asked: string[] = [];
    await addApprovedEvent(
      { summary: "旅行", start: "2026-10-10", end: "2026-10-13" },
      {
        ask: (message) => {
          asked.push(message);
          return Promise.resolve("decline");
        },
        call: fakeBridge(undefined, []).call,
      },
    );
    assertStringIncludes(asked[0], "2026-10-10–2026-10-12");
  });
});

Deno.test("the approval waits past the SDK's 60-second default and can be withdrawn", async () => {
  const seen: unknown[] = [];
  const signal = new AbortController().signal;
  const ask = elicitApproval((params, options) => {
    seen.push(params, options);
    return Promise.resolve({ action: "accept" });
  }, signal);
  assertEquals(await ask("カレンダーに追加: x"), "accept");
  assertEquals(seen[0], {
    message: "カレンダーに追加: x",
    requestedSchema: { type: "object", properties: {} },
  });
  assertEquals(seen[1], { timeout: ELICIT_TIMEOUT_MS, signal });
  assertEquals(ELICIT_TIMEOUT_MS, 330_000);
});

Deno.test("the card cannot hide a link or reorder text", async () => {
  await withLog(async () => {
    const asked: string[] = [];
    const { call } = fakeBridge(undefined, []);
    await addApprovedEvent(
      {
        summary: "<https://evil.example|歯医者> & \u202Eenil\u200Bb",
        start: "2026-10-02T15:00",
      },
      {
        ask: (message) => {
          asked.push(message);
          return Promise.resolve("decline");
        },
        call,
      },
    );
    assertStringIncludes(
      asked[0],
      "&lt;https://evil.example|歯医者&gt; &amp; enil b",
    );
    assert(!/[<>\u202E\u200B]/.test(asked[0]), "raw control reaches the card");
  });
});

Deno.test("what is saved is the text the card showed", async () => {
  await withLog(async () => {
    const asked: string[] = [];
    const { call, calls } = fakeBridge(undefined, []);
    await addApprovedEvent(
      {
        summary: "a\u202Eb\u200Bc\nd",
        start: "2026-10-02",
        description: "x\u2066y\n\tz",
      },
      {
        ask: (message) => {
          asked.push(message);
          return Promise.resolve("accept");
        },
        call,
      },
    );
    assertStringIncludes(asked[0], "カレンダーに追加: a b c d");
    assertStringIncludes(asked[0], "メモ: xy z");
    const event = calls[0][1].event as {
      summary: string;
      description: string;
    };
    assertEquals(event.summary, "a b c d");
    assert(event.description.startsWith("xy\nz\n\n"));
  });
});

Deno.test("an event too long for the card is refused before asking", async () => {
  await withLog(async () => {
    let asked = false;
    const { call, calls } = fakeBridge(undefined, []);
    await assertRejects(
      () =>
        addApprovedEvent(
          { summary: "x", start: "2026-10-02", description: "&".repeat(600) },
          {
            ask: () => {
              asked = true;
              return Promise.resolve("accept");
            },
            call,
          },
        ),
      Error,
      "too long to show in full",
    );
    assert(!asked);
    assertEquals(calls, []);
  });
});

Deno.test("an emoji keeps its joiner and an invisible-only title is refused", async () => {
  await withLog(async () => {
    const { call, calls } = fakeBridge(undefined, []);
    await addApprovedEvent(
      { summary: "\u{1F468}\u200D\u{1F469} 夕食", start: "2026-10-02" },
      { ask: () => Promise.resolve("accept"), call },
    );
    assertEquals(
      (calls[0][1].event as { summary: string }).summary,
      "\u{1F468}\u200D\u{1F469} 夕食",
    );
    let asked = false;
    await assertRejects(
      () =>
        addApprovedEvent({ summary: "\u200B\u202E ", start: "2026-10-02" }, {
          ask: () => {
            asked = true;
            return Promise.resolve("accept");
          },
          call,
        }),
      Error,
      "the title is empty",
    );
    assert(!asked);
    assertEquals(calls.length, 1);
  });
});
