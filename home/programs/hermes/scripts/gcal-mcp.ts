// Stdio MCP server that gives Hermes exactly one Google Calendar capability:
// creating an event on the primary calendar.
//
// The mail job reads untrusted text, so this server deliberately offers no
// listing, editing or deleting. A prompt-injected model can at worst add a
// bogus event that points back to the mail it came from. That title is later
// read by Slack sessions through agenda-mcp.ts, marked as mail-derived.
//
// It does list events in one case, to settle a create whose outcome is
// unknown; what it reads there never goes back to the model.

import { McpServer } from "npm:@modelcontextprotocol/sdk@1.30.0/server/mcp.js";
import { StdioServerTransport } from "npm:@modelcontextprotocol/sdk@1.30.0/server/stdio.js";
import { z } from "npm:zod@4.6.5";
import { BridgeError, callBridge } from "./gas-client.ts";
import { startTrace, trace } from "./trace.ts";

const TIME_ZONE = "Asia/Tokyo";
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

export type EventInput = {
  summary: string;
  start: string;
  end?: string;
  description?: string;
  source_message_id: string;
};

type EventTime = { date: string } | { dateTime: string; timeZone: string };

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function toEventTime(value: string): EventTime {
  if (DATE.test(value)) return { date: value };
  // Calendar rejects RFC 3339 date-times without seconds as a Bad Request.
  if (DATE_TIME.test(value)) {
    return { dateTime: value.slice(0, 16) + ":00", timeZone: TIME_ZONE };
  }
  throw new Error(`expected YYYY-MM-DD or YYYY-MM-DDTHH:MM, got "${value}"`);
}

export function buildEvent(input: EventInput) {
  const start = toEventTime(input.start);
  let end: EventTime;
  if (input.end) {
    end = toEventTime(input.end);
    if (("date" in start) !== ("date" in end)) {
      throw new Error("start and end must both be dates or both be date-times");
    }
  } else if ("date" in start) {
    // Google treats an all-day event's end date as exclusive.
    end = { date: nextDay(start.date) };
  } else {
    const [h, m] = start.dateTime.slice(11, 16).split(":").map(Number);
    const total = h * 60 + m + 30;
    if (total >= 24 * 60) {
      throw new Error("give an explicit end for events starting after 23:30");
    }
    const hh = String(Math.floor(total / 60)).padStart(2, "0");
    const mm = String(total % 60).padStart(2, "0");
    end = {
      dateTime: `${start.dateTime.slice(0, 11)}${hh}:${mm}:00`,
      timeZone: TIME_ZONE,
    };
  }
  const trail =
    `Created by Hermes from Gmail message ${input.source_message_id}`;
  return {
    summary: input.summary,
    description: input.description ? `${input.description}\n\n${trail}` : trail,
    start,
    end,
  };
}

type BuiltEvent = ReturnType<typeof buildEvent>;
type Listed = {
  summary: string;
  start: { date?: string; dateTime?: string };
  organizerSelf: boolean;
  hermesTrail: boolean;
};
type Call = (
  action: "createEvent" | "listEvents",
  params: Record<string, unknown>,
) => Promise<unknown>;

// Listed times come back as local date-times with an offset; the first 19
// characters are the local time buildEvent sent.
function sameStart(listed: Listed["start"], sent: EventTime): boolean {
  return "date" in sent
    ? listed.date === sent.date
    : listed.dateTime?.slice(0, 19) === sent.dateTime;
}

// Apps Script has answered a create with a Google error page after saving
// the event, and a retry would then add it twice. Only an error the bridge
// reported itself proves nothing was saved; for anything else the calendar
// is asked. A Hermes event with the same title and start that was already
// there counts too: either way the event is on the calendar once.
export async function createEventChecked(
  event: BuiltEvent,
  call: Call = callBridge,
): Promise<{ htmlLink?: string; confirmed?: true }> {
  try {
    return await call("createEvent", { event }) as { htmlLink?: string };
  } catch (e) {
    if (e instanceof BridgeError && e.reported) throw e;
    const day = "date" in event.start
      ? event.start.date
      : event.start.dateTime.slice(0, 10);
    let events: Listed[];
    try {
      events = await call("listEvents", {
        from: day,
        to: nextDay(day),
      }) as Listed[];
    } catch {
      throw e;
    }
    if (!Array.isArray(events)) throw e;
    const found = events.some((l) =>
      l.summary === event.summary && l.organizerSelf && l.hermesTrail &&
      sameStart(l.start, event.start)
    );
    if (!found) throw e;
    trace(
      `createEvent failed (${
        e instanceof Error ? e.message : e
      }); confirmed on the calendar for ${day}`,
    );
    return { confirmed: true };
  }
}

if (import.meta.main) {
  startTrace();
  const server = new McpServer({ name: "gcal", version: "1.0.0" });
  server.registerTool(
    "create_event",
    {
      description:
        "Create one event on the user's primary Google Calendar (Asia/Tokyo). Use a date (YYYY-MM-DD) for all-day items such as deadlines and deliveries, or a local date-time (YYYY-MM-DDTHH:MM) for timed appointments. Omit end for a one-day all-day event or a 30-minute timed event.",
      inputSchema: {
        summary: z.string().min(1).max(200),
        start: z.string(),
        end: z.string().optional(),
        description: z.string().max(2000).optional(),
        source_message_id: z.string().min(1).describe(
          "message_id of the mail this event came from",
        ),
      },
    },
    async (input: EventInput) => {
      const created = await createEventChecked(buildEvent(input));
      return {
        content: [{
          type: "text",
          text: created.confirmed
            ? "Created: (link unavailable; confirmed on the calendar after a bridge error)"
            : `Created: ${created.htmlLink ?? "(no link)"}`,
        }],
      };
    },
  );
  await server.connect(new StdioServerTransport());
}
