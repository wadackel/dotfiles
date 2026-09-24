// Web app bridge between the Hermes host scripts and the owner's Gmail and
// Calendar. It runs as the owner, so no OAuth client or published consent
// screen is needed, and no Google credential ever reaches the Mac.
//
// The URL is public (ANYONE_ANONYMOUS), so every request must carry the shared
// secret in its body; the query string is avoided because URLs end up in logs.
// No action can send, change or delete mail, or change existing events;
// events are only listed, stripped of descriptions and guests. The built-in
// GmailApp and CalendarApp are avoided because they demand full mail and
// calendar scopes; the advanced services honour the narrow scopes in
// appsscript.json.

var MAX_MESSAGES = 20;
var MAX_LOOKBACK_SECONDS = 2 * 24 * 3600;

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply_({ error: "bad request" });
  }
  var secret = PropertiesService.getScriptProperties().getProperty("SECRET");
  if (!secret || typeof req.secret !== "string" || !safeEqual_(req.secret, secret)) {
    return reply_({ error: "unauthorized" });
  }
  try {
    if (req.action === "listNewMail") return reply_({ result: listNewMail_(req.after) });
    if (req.action === "createEvent") return reply_({ result: createEvent_(req.event) });
    if (req.action === "listHolidays") return reply_({ result: listHolidays_(req.from, req.to) });
    if (req.action === "listEvents") return reply_({ result: listEvents_(req.from, req.to) });
    return reply_({ error: "unknown action" });
  } catch (err) {
    return reply_({ error: String(err) });
  }
}

function listNewMail_(after) {
  var now = Math.floor(Date.now() / 1000);
  var since = Math.max(Number(after) || 0, now - MAX_LOOKBACK_SECONDS);
  var list = Gmail.Users.Messages.list("me", {
    q: "in:inbox after:" + since,
    maxResults: MAX_MESSAGES,
  });
  return (list.messages || []).map(function (m) {
    var msg = Gmail.Users.Messages.get("me", m.id, { format: "full" });
    return { id: msg.id, internalDate: msg.internalDate, payload: encodeBodies_(msg.payload) };
  });
}

// The advanced service hands body data back as a byte array, while the host
// parser expects the REST API's base64url strings.
function encodeBodies_(part) {
  if (part.body && part.body.data && typeof part.body.data !== "string") {
    part.body.data = Utilities.base64EncodeWebSafe(part.body.data);
  }
  (part.parts || []).forEach(encodeBodies_);
  return part;
}

function createEvent_(event) {
  if (!event || typeof event.summary !== "string" || !event.start || !event.end) {
    throw new Error("summary, start and end are required");
  }
  var created = Calendar.Events.insert(
    {
      summary: event.summary,
      description: typeof event.description === "string" ? event.description : "",
      start: pickTime_(event.start),
      end: pickTime_(event.end),
    },
    "primary",
  );
  return { htmlLink: created.htmlLink };
}

var HOLIDAY_CALENDAR = "ja.japanese#holiday@group.v.calendar.google.com";
var HERMES_TRAIL = "Created by Hermes from Gmail message";

// Dates are YYYY-MM-DD; `to` is exclusive.
function dayRange_(from, to) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    throw new Error("from and to must be YYYY-MM-DD");
  }
  return { timeMin: from + "T00:00:00+09:00", timeMax: to + "T00:00:00+09:00" };
}

// Returns the holiday dates only.
function listHolidays_(from, to) {
  var range = dayRange_(from, to);
  var res = Calendar.Events.list(HOLIDAY_CALENDAR, {
    timeMin: range.timeMin,
    timeMax: range.timeMax,
    singleEvents: true,
  });
  return (res.items || []).map(function (e) {
    return e.start.date;
  });
}

// Anyone can put an invitation on the calendar, so the description and guests
// never leave Google; only the flags the host needs to decide what to show do.
function listEvents_(from, to) {
  var range = dayRange_(from, to);
  var res = Calendar.Events.list("primary", {
    timeMin: range.timeMin,
    timeMax: range.timeMax,
    singleEvents: true,
    orderBy: "startTime",
    timeZone: "Asia/Tokyo",
    eventTypes: ["default", "fromGmail"],
  });
  return (res.items || []).map(function (e) {
    var me = (e.attendees || []).filter(function (a) {
      return a.self;
    })[0];
    return {
      summary: e.summary || "",
      location: e.location || "",
      start: listTime_(e.start),
      end: listTime_(e.end),
      organizerSelf: !!(e.organizer && e.organizer.self),
      selfResponse: me ? me.responseStatus : null,
      fromGmail: e.eventType === "fromGmail",
      hermesTrail: typeof e.description === "string" && e.description.indexOf(HERMES_TRAIL) !== -1,
    };
  });
}

function listTime_(t) {
  return t.date ? { date: t.date } : { dateTime: t.dateTime };
}

function pickTime_(t) {
  if (typeof t.date === "string") return { date: t.date };
  if (typeof t.dateTime === "string") return { dateTime: t.dateTime, timeZone: String(t.timeZone || "Asia/Tokyo") };
  throw new Error("invalid time");
}

function safeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function reply_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
