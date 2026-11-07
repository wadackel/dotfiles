import { assertEquals, assertRejects, assertThrows } from "@std/assert";
import { test } from "bun:test";
import {
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseProcesses } from "../shared/agent-presence.ts";
import { stringCells } from "./cell_width.ts";
import {
  buildSnapshot,
  escapeArg,
  filesToPrune,
  generationFiles,
  generationLine,
  insideByAncestry,
  isConfirmed,
  isNoServerError,
  isSameStart,
  layoutChecksum,
  listLines,
  parseCliArgs,
  parseEtime,
  parseRestoringFlag,
  parseSnapshot,
  resumeCommand,
  type Snapshot,
  SnapshotSchema,
  tiledLayout,
  tmuxArgs,
  WINDOW_FORMAT,
  writeSnapshotFile,
} from "./restore.ts";

const US = "\x1f";
const CLAUDE_ID = "2a27164a-e95b-479b-8626-85430aea9cb3";
const CODEX_ID = "11111111-1111-4111-8111-111111111111";

interface PaneFields {
  paneId?: string;
  session?: string;
  windowIndex?: number;
  paneIndex?: number;
  command?: string;
  path?: string;
  agent?: string;
  sessionId?: string;
  prompt?: string;
  cwd?: string;
  userLabel?: string;
  userLabelSession?: string;
  active?: boolean;
  title?: string;
}

// One line of `list-panes -F PANE_SNAPSHOT_FORMAT`, field for field.
function paneLine(f: PaneFields = {}): string {
  const session = f.session ?? "0";
  const windowIndex = String(f.windowIndex ?? 1);
  const row = Array<string>(23).fill("");
  row[0] = f.paneId ?? "%1";
  row[1] = `${session}:${windowIndex}.${f.paneIndex ?? 1}`;
  row[2] = f.command ?? "zsh";
  row[3] = f.path ?? "/Users/me/dotfiles";
  row[4] = f.agent ?? "";
  row[7] = f.cwd ?? "";
  row[10] = f.prompt ?? "";
  row[13] = f.sessionId ?? "";
  row[21] = f.userLabel ?? "";
  row[22] = f.userLabelSession ?? "";
  const tail = [
    "4242",
    "@1",
    session,
    windowIndex,
    f.active === false ? "0" : "1",
    "1793630000",
    f.title ?? "",
  ];
  return [...row, ...tail].join(US);
}

interface WindowFields {
  session?: string;
  lastAttached?: string;
  index?: number;
  width?: number;
  height?: number;
  automaticRename?: boolean;
  zoomed?: boolean;
  active?: boolean;
  layout?: string;
  name?: string;
}

function windowLine(f: WindowFields = {}): string {
  return [
    f.session ?? "0",
    f.lastAttached ?? "1793630000",
    String(f.index ?? 1),
    String(f.width ?? 200),
    String(f.height ?? 50),
    f.automaticRename ? "1" : "0",
    f.zoomed ? "1" : "0",
    f.active === false ? "0" : "1",
    f.layout ?? "c5dd,200x50,0,0,1",
    f.name ?? "dot",
  ].join(US);
}

function build(paneLines: string[], windowLines: string[]): Snapshot {
  const snapshot = buildSnapshot({
    paneLines,
    windowLines,
    startTime: 1792629045,
    nowSec: 1793631893,
  });
  if (snapshot === null) throw new Error("buildSnapshot saved nothing");
  return snapshot;
}

const TWO_PANE_LAYOUT = "8aca,200x50,0,0{100x50,0,0,1,99x50,101,0,2}";

test("WINDOW_FORMAT keeps the free-form name last so it cannot shift a field", () => {
  assertEquals(WINDOW_FORMAT.endsWith("#{window_name}"), true);
});

test("tmuxArgs puts -u first", () => {
  assertEquals(tmuxArgs(["list-panes", "-a"]), ["-u", "list-panes", "-a"]);
});

test("buildSnapshot: maps windows, panes and agents from tmux output", () => {
  const snapshot = build(
    [
      paneLine({
        paneId: "%1",
        windowIndex: 1,
        command: ".claude-wrapped",
        agent: "claude",
        sessionId: CLAUDE_ID,
        prompt: "復元を相談",
        userLabel: "parked",
        userLabelSession: CLAUDE_ID,
      }),
      paneLine({
        paneId: "%2",
        windowIndex: 4,
        paneIndex: 1,
        active: false,
        path: "/Users/me/a",
      }),
      paneLine({
        paneId: "%3",
        windowIndex: 4,
        paneIndex: 2,
        command: "just",
        path: "/Users/me/b",
      }),
    ],
    [
      windowLine({ index: 1, name: "dot", lastAttached: "1793630000" }),
      windowLine({
        index: 4,
        name: "da\x1fxial",
        layout: TWO_PANE_LAYOUT,
        zoomed: true,
        active: false,
        automaticRename: true,
      }),
    ],
  );
  assertEquals(snapshot.savedAtSec, 1793631893);
  assertEquals(snapshot.serverStartTime, 1792629045);
  assertEquals(snapshot.sessions.length, 1);
  const [session] = snapshot.sessions;
  assertEquals([session.name, session.lastAttachedSec], ["0", 1793630000]);
  assertEquals(session.windows.map((w) => w.index), [1, 4]);
  const [first, second] = session.windows;
  assertEquals(first.panes[0].agent, {
    kind: "claude",
    sessionId: CLAUDE_ID,
    prompt: "復元を相談",
    userLabel: "parked",
  });
  assertEquals(second.name, "da\x1fxial");
  assertEquals(
    [second.zoomed, second.active, second.automaticRename],
    [true, false, true],
  );
  assertEquals([second.width, second.height], [200, 50]);
  assertEquals(
    second.panes.map((p) => [p.index, p.path, p.command, p.active, p.agent]),
    [
      [1, "/Users/me/a", "zsh", false, null],
      [2, "/Users/me/b", "just", true, null],
    ],
  );
});

test("buildSnapshot: a session never attached has null lastAttachedSec", () => {
  const snapshot = build([paneLine()], [windowLine({ lastAttached: "" })]);
  assertEquals(snapshot.sessions[0].lastAttachedSec, null);
});

test("buildSnapshot: pane_current_path wins over @pane_cwd", () => {
  const snapshot = build(
    [
      paneLine({
        command: ".claude-wrapped",
        agent: "claude",
        sessionId: CLAUDE_ID,
        path: "/Users/me/repo",
        cwd: "/private/tmp/scratchpad/wt-c",
      }),
    ],
    [windowLine()],
  );
  assertEquals(snapshot.sessions[0].windows[0].panes[0].path, "/Users/me/repo");
});

test("buildSnapshot: an agent that has exited leaves no agent entry", () => {
  const snapshot = build(
    [
      paneLine({
        command: "zsh",
        agent: "claude",
        sessionId: CLAUDE_ID,
        prompt: "stale",
      }),
    ],
    [windowLine()],
  );
  assertEquals(snapshot.sessions[0].windows[0].panes[0].agent, null);
});

test("buildSnapshot: a starting Codex is not trusted with its stale session id", () => {
  const snapshot = build(
    [
      paneLine({
        command: "codex",
        agent: "codex",
        sessionId: "22222222-2222-4222-8222-222222222222",
        title: `codex | ${CODEX_ID.slice(0, 29)}... | project`,
      }),
    ],
    [windowLine()],
  );
  assertEquals(snapshot.sessions[0].windows[0].panes[0].agent, null);
});

test("buildSnapshot: a registered Codex keeps its session id", () => {
  const snapshot = build(
    [
      paneLine({
        command: "codex",
        agent: "codex",
        sessionId: CODEX_ID,
        title: `codex | ${CODEX_ID.slice(0, 29)}... | project`,
      }),
    ],
    [windowLine()],
  );
  assertEquals(
    snapshot.sessions[0].windows[0].panes[0].agent?.sessionId,
    CODEX_ID,
  );
});

test("buildSnapshot: an id unsafe to type after --resume leaves no agent entry", () => {
  const ids = [
    "../escape",
    "a b",
    "x".repeat(129),
    "",
    "--dangerously-skip-permissions",
    "-x",
  ];
  for (const sessionId of ids) {
    const snapshot = build(
      [paneLine({ command: "claude", agent: "claude", sessionId })],
      [windowLine()],
    );
    assertEquals(snapshot.sessions[0].windows[0].panes[0].agent, null);
  }
});

test("buildSnapshot: a label left by another session stays empty", () => {
  const snapshot = build(
    [
      paneLine({
        command: "claude",
        agent: "claude",
        sessionId: CLAUDE_ID,
        userLabel: "parked",
        userLabelSession: "other",
      }),
    ],
    [windowLine()],
  );
  assertEquals(snapshot.sessions[0].windows[0].panes[0].agent?.userLabel, "");
});

test("buildSnapshot: an unparsable pane line fails the whole snapshot", () => {
  assertThrows(() => build(["not a pane line"], [windowLine()]));
});

test("buildSnapshot: the failure names the pane and not its prompt", () => {
  const error = assertThrows(
    () => build(["%9\x1fsecret prompt"], [windowLine()]),
    Error,
    "%9",
  );
  assertEquals(error.message.includes("secret"), false);
  const bare = assertThrows(() => build(["secret prompt"], [windowLine()]));
  assertEquals((bare as Error).message.includes("secret"), false);
});

test("buildSnapshot: a pane with no window fails the whole snapshot", () => {
  assertThrows(() => build([paneLine({ windowIndex: 2 })], [windowLine()]));
});

test("buildSnapshot: a window with no pane fails the whole snapshot", () => {
  assertThrows(() =>
    build([paneLine()], [windowLine(), windowLine({ index: 2 })])
  );
});

test("buildSnapshot: a layout whose leaves disagree with the panes fails", () => {
  assertThrows(() =>
    build([paneLine()], [windowLine({ layout: TWO_PANE_LAYOUT })])
  );
});

test("buildSnapshot: the blank line after the last pane is not a parse failure", () => {
  const snapshot = build([paneLine(), ""], [windowLine(), ""]);
  assertEquals(snapshot.sessions[0].windows.length, 1);
});

// Layouts as tmux next-3.8 printed them: two splits and a floating pane, and the
// same window zoomed, where every pane reports itself as not floating.
const FLOATING_LAYOUT =
  "f334,120x40,0,0[120x20,0,0,0,120x19,0,21,1,60x10,4,2,2]<60x10,4,2,2>";
const ZOOMED_FLOATING_LAYOUT =
  "189f,120x40,0,0{60x40,0,0,0,59x40,61,0[59x20,61,0,1,59x19,61,21,2," +
  "60x10,4,2,3,60x10,8,4,4]}";

// Each pair is a layout with floating panes and the one tmux printed after those
// panes were killed.
const TMUX_PAIRS: [string, string][] = [
  [FLOATING_LAYOUT, "baaa,120x40,0,0[120x20,0,0,0,120x19,0,21,1]"],
  [
    "3515,120x40,0,0[120x40,0,0,0,60x10,4,2,1]<60x10,4,2,1>",
    "aafd,120x40,0,0,0",
  ],
  [
    "64c4,120x40,0,0{60x40,0,0,1,60x10,4,2,4,59x40,61,0[59x20,61,0,2," +
    "59x19,61,21,3]}<60x10,4,2,4>",
    "d6e5,120x40,0,0{60x40,0,0,1,59x40,61,0[59x20,61,0,2,59x19,61,21,3]}",
  ],
];

test("tiledLayout: drops floating panes the way tmux does, checksum included", () => {
  for (const [layout, expected] of TMUX_PAIRS) {
    assertEquals(tiledLayout(layout, false)?.layout, expected);
  }
});

test("tiledLayout: a zoomed window's floating panes are found by position", () => {
  const tiled = tiledLayout(ZOOMED_FLOATING_LAYOUT, true);
  assertEquals([...tiled?.floating ?? []], ["3", "4"]);
  const body = "120x40,0,0{60x40,0,0,0,59x40,61,0[59x20,61,0,1,59x19,61,21,2]}";
  assertEquals(tiled?.layout, `${layoutChecksum(body)},${body}`);
});

test("tiledLayout: several floating panes in the trailer", () => {
  const tiled = tiledLayout(
    "0000,120x40,0,0[120x20,0,0,0,120x19,0,21,1,60x10,4,2,2,60x10,8,4,3]" +
      "<60x10,8,4,3,60x10,4,2,2>",
    false,
  );
  assertEquals([...tiled?.floating ?? []].toSorted(), ["2", "3"]);
  assertEquals(tiled?.layout, "baaa,120x40,0,0[120x20,0,0,0,120x19,0,21,1]");
});

test("tiledLayout: a layout without floating panes is returned as it was", () => {
  assertEquals(tiledLayout(TWO_PANE_LAYOUT, false)?.layout, TWO_PANE_LAYOUT);
});

test("tiledLayout: nothing but floating panes leaves no layout", () => {
  assertEquals(tiledLayout("32f1,60x10,4,2,2<60x10,4,2,2>", false), null);
});

test("buildSnapshot: a floating pane is left out and the splits keep their layout", () => {
  const snapshot = build(
    [0, 1, 2].map((i) => paneLine({ paneId: `%${i}`, paneIndex: i })),
    [windowLine({ layout: FLOATING_LAYOUT })],
  );
  const [window] = snapshot.sessions[0].windows;
  assertEquals(window.layout, "baaa,120x40,0,0[120x20,0,0,0,120x19,0,21,1]");
  assertEquals(window.panes.map((p) => p.index), [0, 1]);
});

test("buildSnapshot: a zoomed window drops its floating panes by their geometry", () => {
  const snapshot = build(
    [0, 1, 2, 3, 4].map((i) => paneLine({ paneId: `%${i}`, paneIndex: i })),
    [windowLine({ layout: ZOOMED_FLOATING_LAYOUT, zoomed: true })],
  );
  const [window] = snapshot.sessions[0].windows;
  assertEquals(
    window.layout.slice(5),
    "120x40,0,0{60x40,0,0,0,59x40,61,0[59x20,61,0,1,59x19,61,21,2]}",
  );
  assertEquals(window.panes.map((p) => p.index), [0, 1, 2]);
});

test("buildSnapshot: a window of floating panes only is not saved", () => {
  const snapshot = build(
    [
      paneLine({ paneId: "%1", windowIndex: 1 }),
      paneLine({ paneId: "%2", windowIndex: 2 }),
    ],
    [
      windowLine({ index: 1 }),
      windowLine({ index: 2, layout: "32f1,60x10,4,2,2<60x10,4,2,2>" }),
    ],
  );
  assertEquals(snapshot.sessions[0].windows.map((w) => w.index), [1]);
});

test("buildSnapshot: nothing but floating panes saves nothing", () => {
  const snapshot = buildSnapshot({
    paneLines: [paneLine({ paneId: "%1" })],
    windowLines: [windowLine({ layout: "3f2f,58x8,5,3,1<58x8,5,3,1>" })],
    startTime: 1792629045,
    nowSec: 1793631893,
  });
  assertEquals(snapshot, null);
});

test("buildSnapshot: a backslash tmux stored doubled is saved as typed", () => {
  const snapshot = build(
    [paneLine({ session: "se\\\\ss" })],
    [windowLine({ session: "se\\\\ss", name: "a\\\\b" })],
  );
  const [session] = snapshot.sessions;
  assertEquals([session.name, session.windows[0].name], ["se\\ss", "a\\b"]);
});

test("parseSnapshot: round-trips what buildSnapshot produced", () => {
  const snapshot = build([paneLine()], [windowLine()]);
  assertEquals(parseSnapshot(JSON.stringify(snapshot)), snapshot);
});

test("parseSnapshot: refuses a resume id, kind or label outside the schema", () => {
  const base = build(
    [paneLine({ command: "claude", agent: "claude", sessionId: CLAUDE_ID })],
    [windowLine()],
  );
  const mutate = (fn: (agent: Record<string, unknown>) => void): string => {
    const copy = structuredClone(base);
    fn(copy.sessions[0].windows[0].panes[0].agent as Record<string, unknown>);
    return JSON.stringify(copy);
  };
  assertEquals(parseSnapshot(mutate(() => {})), base);
  assertThrows(() =>
    parseSnapshot(mutate((a) => {
      a.sessionId = "x; rm -rf ~";
    }))
  );
  assertThrows(() =>
    parseSnapshot(mutate((a) => {
      a.sessionId = "--dangerously-skip-permissions";
    }))
  );
  assertThrows(() =>
    parseSnapshot(mutate((a) => {
      a.kind = "gemini";
    }))
  );
  assertThrows(() =>
    parseSnapshot(mutate((a) => {
      a.userLabel = "bogus";
    }))
  );
  assertThrows(() => parseSnapshot("{"));
});

test("SnapshotSchema: a window with no panes is rejected", () => {
  const copy = structuredClone(build([paneLine()], [windowLine()]));
  copy.sessions[0].windows[0].panes = [];
  assertEquals(SnapshotSchema.safeParse(copy).success, false);
});

test("parseCliArgs: accepts the four forms", () => {
  assertEquals(parseCliArgs(["--snapshot"]), { kind: "snapshot" });
  assertEquals(parseCliArgs(["--restore"]), { kind: "restore", generation: 1 });
  assertEquals(parseCliArgs(["--restore", "2"]), {
    kind: "restore",
    generation: 2,
  });
  assertEquals(parseCliArgs(["--restore", "--list"]), { kind: "list" });
});

test("parseCliArgs: refuses everything else", () => {
  for (
    const argv of [
      ["--restore", "abc"],
      ["--restore", "0"],
      ["--restore", "01"],
      ["--restore", "-1"],
      ["--restore", "--list", "3"],
      ["--restore", "1", "2"],
      ["--list", "--restore"],
      ["--snapshot", "--restore"],
      ["--dashboard", "--restore"],
      ["--snapshot", "1"],
      ["--snapshot", "--list"],
      [],
    ]
  ) {
    assertEquals(parseCliArgs(argv), null, argv.join(" "));
  }
});

test("generationFiles: newest first, numerically, without the current server", () => {
  assertEquals(
    generationFiles(
      ["900.json", "1000.json", "1100.json", "x.json", "9.json.42.tmp"],
      "1100",
    ),
    ["1000.json", "900.json"],
  );
  assertEquals(generationFiles(["5.json"], null), ["5.json"]);
});

test("filesToPrune: keeps ten past generations and the current server", () => {
  const names = Array.from({ length: 12 }, (_, i) => `${100 + i}.json`);
  assertEquals(filesToPrune([...names, "note.txt"], "111"), ["100.json"]);
  assertEquals(filesToPrune(names.slice(0, 10), "111"), []);
});

test("escapeArg: doubles # and escapes only a trailing ;", () => {
  assertEquals(escapeArg("a#{pid}b"), "a##{pid}b");
  assertEquals(escapeArg("name;"), "name\\;");
  assertEquals(escapeArg("mid;dle"), "mid;dle");
  assertEquals(escapeArg("plain"), "plain");
  assertEquals(escapeArg("#;"), "##\\;");
});

test("resumeCommand: one command per agent", () => {
  const agent = { sessionId: "abc-1", prompt: "", userLabel: "" as const };
  assertEquals(
    resumeCommand({ ...agent, kind: "claude" }),
    "claude --resume abc-1",
  );
  assertEquals(
    resumeCommand({ ...agent, kind: "codex" }),
    "codex resume abc-1",
  );
  assertEquals(
    resumeCommand({ ...agent, kind: "opencode" }),
    "opencode --session abc-1",
  );
});

function listSnapshot(): Snapshot {
  return build(
    [
      paneLine({
        windowIndex: 1,
        command: ".claude-wrapped",
        agent: "claude",
        sessionId: CLAUDE_ID,
        prompt: "復元を相談",
        path: "/Users/me/dotfiles",
      }),
      paneLine({
        windowIndex: 2,
        command: "just",
        path: "/Users/me/develop/github.com/alice/a-very-long-repository-name",
      }),
      paneLine({
        windowIndex: 4,
        paneIndex: 1,
        active: false,
        path: "/gone",
      }),
      paneLine({ windowIndex: 4, paneIndex: 2, path: "/Users/me" }),
    ],
    [
      windowLine({ index: 1, name: "dot" }),
      windowLine({ index: 2, name: "mf" }),
      windowLine({ index: 4, name: "daxial", layout: TWO_PANE_LAYOUT }),
    ],
  );
}

const listOpts = {
  home: "/Users/me",
  columns: 100,
  pathExists: (path: string) => path !== "/gone",
};

test("listLines: header, aligned columns and missing directories", () => {
  const lines = listLines(listSnapshot(), listOpts);
  assertEquals(lines[0].includes("（3 ウィンドウ、エージェント 1）"), true);
  assertEquals(lines[0].startsWith("保存: "), true);
  const rows = lines.slice(1, 4);
  assertEquals(rows[0].startsWith(" 1 dot     ~/dotfiles"), true);
  assertEquals(rows[0].includes("claude"), true);
  assertEquals(rows[0].endsWith("復元を相談"), true);
  assertEquals(rows[1].includes("~/.../a-very-long-reposito…"), true);
  assertEquals(rows[1].includes("just"), true);
  assertEquals(rows[2].includes("+1 ペイン"), true);
  // Every row starts its directory at the same cell.
  const dirColumn = " 1 ".length + "daxial".length + 2;
  assertEquals(rows[0].indexOf("~"), dirColumn);
  assertEquals(rows[1].indexOf("~"), dirColumn);
  assertEquals(rows[2].indexOf("~"), dirColumn);
  assertEquals(lines.includes("! daxial.1: /gone がありません"), true);
});

test("listLines: a shell is not shown as a command", () => {
  const lines = listLines(listSnapshot(), listOpts);
  assertEquals(lines[3].includes("zsh"), false);
});

test("listLines: a long line stops at the terminal width", () => {
  const lines = listLines(listSnapshot(), { ...listOpts, columns: 30 });
  assertEquals(lines[1].endsWith("…"), true);
  assertEquals(stringCells(lines[1]), 30);
});

test("listLines: control bytes in names and prompts become spaces", () => {
  const snapshot = listSnapshot();
  const [window] = snapshot.sessions[0].windows;
  window.name = "a\x1b[31mb";
  window.panes[0].agent!.prompt = "p\x1b]0;title\x07q";
  const [, row] = listLines(snapshot, listOpts);
  assertEquals(row.includes("\x1b"), false);
  assertEquals(row.includes("\x07"), false);
});

test("listLines: a long window name stops at the name column", () => {
  const snapshot = listSnapshot();
  snapshot.sessions[0].windows[0].name = "a-window-name-past-twelve-cells";
  const [, row] = listLines(snapshot, listOpts);
  assertEquals(row.startsWith(" 1 a-window-na…  ~/dotfiles"), true);
});

test("listLines: an agent in an inactive pane speaks for its window", () => {
  const snapshot = build(
    [
      paneLine({ paneIndex: 0, path: "/Users/me/shell" }),
      paneLine({
        paneIndex: 1,
        active: false,
        command: "claude",
        agent: "claude",
        sessionId: CLAUDE_ID,
        prompt: "ここ",
        path: "/Users/me/agent",
      }),
    ],
    [windowLine({ layout: TWO_PANE_LAYOUT })],
  );
  const [, row] = listLines(snapshot, listOpts);
  assertEquals(row.includes("~/agent"), true);
  assertEquals(row.endsWith("ここ"), true);
});

test("listLines: a heading per session only when there are several", () => {
  const one = listLines(listSnapshot(), listOpts);
  assertEquals(one.some((l) => l.startsWith("[")), false);
  const two = build(
    [paneLine({ session: "work" }), paneLine({ session: "side" })],
    [
      windowLine({ session: "work", name: "a" }),
      windowLine({ session: "side", name: "b" }),
    ],
  );
  const lines = listLines(two, listOpts);
  assertEquals(lines.includes("[work]"), true);
  assertEquals(lines.includes("[side]"), true);
});

async function withTempDir(fn: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "agentower-restore-"));
  try {
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true });
  }
}

test("writeSnapshotFile: names the file after the server, private, no leftovers", async () => {
  await withTempDir(async (dir) => {
    const target = join(dir, "state/snapshots");
    await writeSnapshotFile(target, listSnapshot());
    assertEquals(await readdir(target), ["1792629045.json"]);
    const file = join(target, "1792629045.json");
    assertEquals((await stat(file)).mode & 0o777, 0o600);
    assertEquals((await stat(target)).mode & 0o777, 0o700);
    assertEquals(parseSnapshot(await readFile(file, "utf8")), listSnapshot());
  });
});

test("writeSnapshotFile: replaces the server's previous file", async () => {
  await withTempDir(async (dir) => {
    await writeSnapshotFile(dir, listSnapshot());
    const next = { ...listSnapshot(), savedAtSec: 1793631999 };
    await writeSnapshotFile(dir, next);
    assertEquals(await readdir(dir), ["1792629045.json"]);
    const saved = await readFile(join(dir, "1792629045.json"), "utf8");
    assertEquals(parseSnapshot(saved).savedAtSec, 1793631999);
  });
});

test("writeSnapshotFile: a value outside the schema leaves the old file alone", async () => {
  await withTempDir(async (dir) => {
    const file = join(dir, "1792629045.json");
    await writeFile(file, "previous");
    const bad = { ...listSnapshot(), sessions: [] };
    await assertRejects(() => writeSnapshotFile(dir, bad));
    assertEquals(await readFile(file, "utf8"), "previous");
    assertEquals(await readdir(dir), ["1792629045.json"]);
  });
});

test("isNoServerError: both messages of a missing server, and nothing else", () => {
  assertEquals(
    isNoServerError("no server running on /private/tmp/tmux-501/default\n"),
    true,
  );
  assertEquals(
    isNoServerError(
      "error connecting to /private/tmp/tmux-501/default (No such file or directory)\n",
    ),
    true,
  );
  assertEquals(
    isNoServerError(
      "error connecting to /private/tmp/tmux-501/default (Permission denied)\n",
    ),
    false,
  );
  assertEquals(isNoServerError("server exited unexpectedly\n"), false);
});

test("isConfirmed: y and yes in any case, everything else is no", () => {
  for (const answer of ["y", "Y", "yes", "YES", " y \n"]) {
    assertEquals(isConfirmed(answer), true, answer);
  }
  for (const answer of ["", "n", "no", "ye", "yy", "y n"]) {
    assertEquals(isConfirmed(answer), false, answer);
  }
});

test("generationLine: counts windows and agents, and flags an unreadable file", () => {
  const line = generationLine(2, listSnapshot());
  assertEquals(line.startsWith(" 2 "), true);
  assertEquals(line.endsWith("3 ウィンドウ、エージェント 1"), true);
  assertEquals(generationLine(3, null), " 3 読めません");
});

test("restoringFlag: etime in all three shapes, and nothing else", () => {
  assertEquals(parseEtime("05:07"), 307);
  assertEquals(parseEtime("01:02:03"), 3723);
  assertEquals(parseEtime(" 2-01:02:03\n"), 2 * 86400 + 3723);
  assertEquals(parseEtime(""), null);
  assertEquals(parseEtime("木 10/22"), null);
});

test("restoringFlag: a pid and a start, never pid 1 or the old value 1", () => {
  assertEquals(parseRestoringFlag("4242:1793630000"), {
    pid: 4242,
    startSec: 1793630000,
  });
  assertEquals(parseRestoringFlag("1"), null);
  assertEquals(parseRestoringFlag("1:1793630000"), null);
  assertEquals(parseRestoringFlag("abc"), null);
  assertEquals(parseRestoringFlag(""), null);
});

test("restoringFlag: one process within two seconds, a reused pid outside", () => {
  assertEquals(isSameStart(1793630000, 1793630001), true);
  assertEquals(isSameStart(1793630000, 1793629998), true);
  assertEquals(isSameStart(1793630000, 1793630003), false);
});

// pid ppid comm, as `ps -A -o pid=,ppid=,comm=` prints them.
const PROCS = parseProcesses([
  "    1     0 /sbin/launchd",
  "  500     1 tmux",
  "  510   500 -zsh",
  "  520   510 bun",
  "  530   500 sh",
  "  600     1 Ghostty",
  "  610   600 -zsh",
  "  620   610 bun",
].join("\n"));

test("insideByAncestry: a pane's or a popup's child of the server is inside", () => {
  assertEquals(insideByAncestry(PROCS, 520, 500), true);
  assertEquals(insideByAncestry(PROCS, 530, 500), true);
});

test("insideByAncestry: a terminal outside tmux is not", () => {
  assertEquals(insideByAncestry(PROCS, 620, 500), false);
});

test("insideByAncestry: a process missing from the table counts as inside", () => {
  assertEquals(insideByAncestry(PROCS, 999, 500), true);
});
