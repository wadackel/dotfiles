// Stdio MCP server that gives Hermes exactly one Google Calendar capability:
// creating an event on the primary calendar.
//
// The mail job reads untrusted text, so this server deliberately offers no
// listing, editing or deleting. A prompt-injected model can at worst add a
// bogus event that points back to the mail it came from. That title is later
// read by Slack sessions through agenda-mcp.ts, marked as mail-derived.
//
// With --slack it serves Slack sessions instead, which also read web pages
// and other people's invitations. There nothing is written until the owner
// approves the exact event on an elicitation card; Hermes' own
// `trust: untrusted` gate was passed over because its card never shows the
// tool's arguments. Those events carry no Gmail trail, so agenda-mcp.ts shows
// them as the owner's own.
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

// Longer than Hermes' 300-second approval wait, so the card is always settled
// by the owner or by Hermes; the SDK's own 60-second default would give up
// first and leave a card whose button then answers the next request.
export const ELICIT_TIMEOUT_MS = 330_000;
export const SLACK_TRAIL = "Created by Hermes from a Slack request";
export const NOT_APPROVED =
  "Not added: the user did not approve this event. Do not retry unless the user asks again.";

export const mailTrail = (messageId: string) =>
  `Created by Hermes from Gmail message ${messageId}`;

export type EventInput = {
  summary: string;
  start: string;
  end?: string;
  description?: string;
};

type EventTime = { date: string } | { dateTime: string; timeZone: string };

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
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

export function buildEvent(input: EventInput, trail: string) {
  const start = toEventTime(input.start);
  let end: EventTime;
  if (input.end) {
    end = toEventTime(input.end);
    if (("date" in start) !== ("date" in end)) {
      throw new Error("start and end must both be dates or both be date-times");
    }
  } else if ("date" in start) {
    // Google treats an all-day event's end date as exclusive.
    end = { date: addDays(start.date, 1) };
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
type Created = { htmlLink?: string; confirmed?: true };

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
// there counts too: either way the event is on the calendar once. An event
// the owner asked for in Slack has no trail to match, and one of their own
// with that title and start serves the request just as well.
export async function createEventChecked(
  event: BuiltEvent,
  { call = callBridge, requireTrail = true }: {
    call?: Call;
    requireTrail?: boolean;
  } = {},
): Promise<Created> {
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
        to: addDays(day, 1),
      }) as Listed[];
    } catch {
      throw e;
    }
    if (!Array.isArray(events)) throw e;
    const found = events.some((l) =>
      l.summary === event.summary && l.organizerSelf &&
      (l.hermesTrail || !requireTrail) && sameStart(l.start, event.start)
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

function createdText(created: Created): string {
  return created.confirmed
    ? "Created: (link unavailable; confirmed on the calendar after a bridge error)"
    : `Created: ${created.htmlLink ?? "(no link)"}`;
}

// Hermes passes the card to Slack unescaped inside a code block. A newline or
// a backtick could close the block, and `<url|label>` would show only the
// label, so the card could say one thing while the event says another.
const cardText = (text: string) =>
  text.replace(/[\s`]+/g, " ").trim()
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Slack drops the buttons from a card section over 3000 characters and Hermes
// cuts the text to fit, so anything past this would be saved without being
// seen; Hermes' own header, fences and deadline line take well under 500.
const CARD_LIMIT = 2500;

function when({ start, end }: BuiltEvent): string {
  if ("date" in start && "date" in end) {
    const last = addDays(end.date, -1);
    return last === start.date ? start.date : `${start.date}–${last}`;
  }
  if ("dateTime" in start && "dateTime" in end) {
    const from = start.dateTime.slice(0, 16).replace("T", " ");
    const to = end.dateTime.slice(0, 10) === start.dateTime.slice(0, 10)
      ? end.dateTime.slice(11, 16)
      : end.dateTime.slice(0, 16).replace("T", " ");
    return `${from}–${to}`;
  }
  throw new Error("start and end must both be dates or both be date-times");
}

function approvalMessage(event: BuiltEvent, description?: string): string {
  return [
    `カレンダーに追加: ${cardText(event.summary)}`,
    `日時: ${when(event)}`,
    ...(description ? [`メモ: ${cardText(description)}`] : []),
  ].join("\n");
}

type Ask = (message: string) => Promise<string>;

// Only an explicit accept writes. A decline, a cancel, a timeout and a client
// without elicitation all end here as not approved.
export async function addApprovedEvent(
  input: EventInput,
  { ask, call = callBridge }: { ask: Ask; call?: Call },
): Promise<string> {
  // Invisible and bidi characters are dropped from what is saved, not only
  // from the card, or the calendar would show the text in another order. The
  // zero-width joiner stays: it only fuses emoji and reorders nothing.
  const clean = {
    ...input,
    summary: input.summary.replace(/[\s\p{Cc}]|(?!\u200D)\p{Cf}/gu, " ")
      .replace(/ +/g, " ").trim(),
    description: input.description?.replace(
      /(?!\u200D)\p{Cf}|(?!\n)\p{Cc}/gu,
      "",
    ),
  };
  if (!clean.summary) {
    throw new Error("the title is empty once invisible characters are removed");
  }
  const event = buildEvent(clean, SLACK_TRAIL);
  const message = approvalMessage(event, clean.description);
  if (message.length > CARD_LIMIT) {
    trace(`refused: approval card of ${message.length} characters`);
    throw new Error(
      "too long to show in full on the approval card; shorten the title or description",
    );
  }
  let action: string;
  try {
    action = await ask(message);
  } catch (e) {
    trace(`approval failed: ${e instanceof Error ? e.message : e}`);
    return NOT_APPROVED;
  }
  trace(`approval: ${action}`);
  if (action !== "accept") return NOT_APPROVED;
  return createdText(
    await createEventChecked(event, { call, requireTrail: false }),
  );
}

type ElicitInput = (
  params: {
    message: string;
    requestedSchema: { type: "object"; properties: Record<string, never> };
  },
  options: { timeout: number; signal?: AbortSignal },
) => Promise<{ action: string }>;

export function elicitApproval(
  elicitInput: ElicitInput,
  signal?: AbortSignal,
): Ask {
  return async (message) =>
    (await elicitInput(
      { message, requestedSchema: { type: "object", properties: {} } },
      { timeout: ELICIT_TIMEOUT_MS, signal },
    )).action;
}

const eventSchema = {
  summary: z.string().min(1).max(200),
  start: z.string(),
  end: z.string().optional(),
  description: z.string().max(2000).optional(),
};

if (import.meta.main) {
  startTrace();
  const server = new McpServer({ name: "gcal", version: "1.0.0" });
  if (Deno.args.includes("--slack")) {
    server.server.oninitialized = () => {
      const form = server.server.getClientCapabilities()?.elicitation?.form;
      trace(`mode slack, client elicitation: ${form ? "form" : "none"}`);
    };
    server.registerTool(
      "create_event",
      {
        description:
          "Create one event the user asked for on their primary Google Calendar (Asia/Tokyo). The user is shown the event and must approve it before anything is saved; if they do not, do not retry unless they ask again. Use a date (YYYY-MM-DD) for all-day items, or a local date-time (YYYY-MM-DDTHH:MM) for timed appointments. Omit end for a one-day all-day event or a 30-minute timed event.",
        inputSchema: eventSchema,
      },
      async (input: EventInput, extra: { signal: AbortSignal }) => ({
        content: [{
          type: "text",
          text: await addApprovedEvent(input, {
            ask: elicitApproval(
              (params, options) => server.server.elicitInput(params, options),
              extra.signal,
            ),
          }),
        }],
      }),
    );
  } else {
    server.registerTool(
      "create_event",
      {
        description:
          "Create one event on the user's primary Google Calendar (Asia/Tokyo). Use a date (YYYY-MM-DD) for all-day items such as deadlines and deliveries, or a local date-time (YYYY-MM-DDTHH:MM) for timed appointments. Omit end for a one-day all-day event or a 30-minute timed event.",
        inputSchema: {
          ...eventSchema,
          source_message_id: z.string().min(1).describe(
            "message_id of the mail this event came from",
          ),
        },
      },
      async (input: EventInput & { source_message_id: string }) => ({
        content: [{
          type: "text",
          text: createdText(
            await createEventChecked(
              buildEvent(input, mailTrail(input.source_message_id)),
            ),
          ),
        }],
      }),
    );
  }
  await server.connect(new StdioServerTransport());
}
