// The screen of `agentower --restore`: the saved generations, what the selected
// one holds, and a second key to confirm. restore.ts imports it only on the
// restore path, so the minutely --snapshot never evaluates ink.

import React, { useEffect, useState } from "react";
import { Box, render, Text, useApp, useInput, useStdout } from "ink";

import { stringCells } from "./cell_width.ts";
import {
  Card,
  CARD_CHROME_COLS,
  chipTokens,
  clampUsageTokens,
  DOGRUN,
  ENTER_ICON,
  HINT_GAP,
  type UsageToken,
} from "./components.tsx";
import { type Agent, USER_LABEL_META, type UserLabel } from "./pane_row.ts";
import { formatElapsed, formatSavedAt, plural } from "./format_helpers.ts";

export interface WindowView {
  index: number;
  name: string;
  dir: string;
  // The agent's kind, or the command when it is not a shell.
  running: string;
  agent: Agent | null;
  userLabel: UserLabel;
  // Panes besides the one the row shows.
  morePanes: number;
  prompt: string;
  active: boolean;
}

export interface SessionView {
  name: string;
  windows: WindowView[];
}

export interface MissingDir {
  target: string;
  path: string;
}

export interface GenerationView {
  n: number;
  // null for a file that does not parse: it keeps its number but cannot restore.
  savedAtSec: number | null;
  windows: number;
  agents: number;
  sessions: SessionView[];
  missing: MissingDir[];
}

export interface PickerOptions {
  generations: GenerationView[];
  initial: number;
  running?: { windows: number; agents: number };
  nowSec: number;
}

type Line = UsageToken[];

const GAP = "  ";

function cells(line: Line): number {
  return line.reduce((n, t) => n + stringCells(t.text), 0);
}

function padTo(line: Line, width: number, backgroundColor?: string): Line {
  const room = width - cells(line);
  return room > 0
    ? [...line, { text: " ".repeat(room), color: DOGRUN.fg, backgroundColor }]
    : line;
}

function generationRow(
  view: GenerationView,
  opts: { nowSec: number; selected: boolean; nChars: number; width: number },
): Line {
  const band = opts.selected ? DOGRUN.band : undefined;
  const marker: Line = [{
    text: opts.selected ? "▌ " : "  ",
    color: DOGRUN.accent,
  }];
  const n: Line = [{
    text: String(view.n).padStart(opts.nChars),
    color: opts.selected ? DOGRUN.accent : DOGRUN.fgDim,
  }];
  const body: Line = view.savedAtSec === null
    ? [{ text: GAP + "unreadable", color: DOGRUN.err }]
    : [
      { text: GAP + formatSavedAt(view.savedAtSec), color: DOGRUN.fg },
      {
        text: GAP +
          `${formatElapsed(view.savedAtSec, opts.nowSec)} ago`.padEnd(7),
        color: DOGRUN.fgDim,
      },
      {
        text: GAP + plural(view.windows, "window").padEnd(11),
        color: DOGRUN.fg,
      },
      {
        text: GAP + plural(view.agents, "agent"),
        color: view.agents > 0 ? DOGRUN.ok : DOGRUN.muted,
      },
    ];
  const line = clampUsageTokens([...marker, ...n, ...body], opts.width).map((
    t,
  ) => ({ ...t, backgroundColor: band }));
  return padTo(line, opts.width, band);
}

// The agent column: a user label's icon when any window has one, then the agent
// as a chip, or a command that is not a shell as plain text.
function runningCell(window: WindowView, labelled: boolean): Line {
  const label: Line = labelled
    ? [{
      text: `${USER_LABEL_META[window.userLabel].icon} `,
      color: USER_LABEL_META[window.userLabel].color,
    }]
    : [];
  if (window.agent !== null) {
    return [
      ...label,
      ...chipTokens(window.agent, DOGRUN.fgChip, DOGRUN.bgChip),
    ];
  }
  return [...label, { text: window.running, color: DOGRUN.sandy }];
}

export function detailLines(view: GenerationView, width: number): Line[] {
  if (view.savedAtSec === null) {
    return [[{
      text: "This file does not parse and cannot be restored.",
      color: DOGRUN.err,
    }]];
  }
  const windows = view.sessions.flatMap((s) => s.windows);
  const indexChars = Math.max(...windows.map((w) => String(w.index).length));
  const nameCells = Math.min(
    12,
    Math.max(...windows.map((w) => stringCells(w.name))),
  );
  const dirCells = Math.max(...windows.map((w) => stringCells(w.dir)));
  const labelled = windows.some((w) => w.userLabel !== "");
  const runningCells = Math.max(
    ...windows.map((w) => cells(runningCell(w, labelled))),
  );
  const moreCells = Math.max(
    ...windows.map((w) =>
      w.morePanes > 0 ? `+${plural(w.morePanes, "pane")}`.length : 0
    ),
  );

  const row = (w: WindowView): Line => {
    const more = w.morePanes > 0 ? `+${plural(w.morePanes, "pane")}` : "";
    const name = clampUsageTokens(
      [{ text: w.name, color: w.active ? DOGRUN.fg : DOGRUN.fgDim }],
      nameCells,
    );
    const line: Line = [
      {
        text: String(w.index).padStart(indexChars) + " ",
        color: DOGRUN.muted,
      },
      ...padTo(name, nameCells),
      { text: GAP, color: DOGRUN.fg },
      ...padTo([{ text: w.dir, color: DOGRUN.fgDim }], dirCells),
      { text: GAP, color: DOGRUN.fg },
      ...padTo(runningCell(w, labelled), runningCells),
      ...(moreCells > 0
        ? [
          { text: GAP, color: DOGRUN.fg },
          ...padTo([{ text: more, color: DOGRUN.muted }], moreCells),
        ]
        : []),
      { text: GAP + w.prompt, color: DOGRUN.fg },
    ];
    return clampUsageTokens(line, width);
  };

  const lines: Line[] = [];
  for (const session of view.sessions) {
    if (view.sessions.length > 1) {
      lines.push([
        { text: "▸ ", color: DOGRUN.muted },
        { text: session.name, color: DOGRUN.accent },
      ]);
    }
    lines.push(...session.windows.map(row));
  }
  for (const missing of view.missing) {
    lines.push(clampUsageTokens([
      { text: "! ", color: DOGRUN.warn },
      { text: `${missing.target}  ${missing.path}`, color: DOGRUN.warn },
      { text: "  is gone; the pane opens in ~", color: DOGRUN.fgDim },
    ], width));
  }
  return lines;
}

// Keeps the frame inside the terminal: the last visible line says how many
// lines did not fit rather than letting the terminal scroll the top away.
function fitLines(lines: Line[], max: number): Line[] {
  if (lines.length <= max) return lines;
  const shown = Math.max(0, max - 1);
  return [
    ...lines.slice(0, shown),
    [{ text: `… ${lines.length - shown} more`, color: DOGRUN.muted }],
  ];
}

function keyTokens(keys: [string, string][]): Line {
  const out: Line = [];
  keys.forEach(([key, label], i) => {
    if (i > 0) out.push({ text: HINT_GAP, color: DOGRUN.muted });
    out.push(...chipTokens(key, DOGRUN.accent, DOGRUN.bgChip));
    out.push({ text: " " + label, color: DOGRUN.fgDim });
  });
  return out;
}

const Tokens: React.FC<{ line: Line }> = ({ line }) => (
  <Box>
    {line.map((t, i) => (
      <Text key={i} color={t.color} backgroundColor={t.backgroundColor}>
        {t.text}
      </Text>
    ))}
  </Box>
);

function useTerminalSize(): { columns: number; rows: number } {
  const { stdout } = useStdout();
  const read = () => ({
    columns: stdout.columns || 100,
    rows: stdout.rows || 30,
  });
  const [size, setSize] = useState(read);
  useEffect(() => {
    const onResize = () => setSize(read());
    stdout.on("resize", onResize);
    return () => {
      stdout.off("resize", onResize);
    };
  }, [stdout]);
  return size;
}

const Picker: React.FC<PickerOptions & { onDone: (n: number) => void }> = (
  { generations, initial, running, nowSec, onDone },
) => {
  const { exit } = useApp();
  const { columns, rows } = useTerminalSize();
  const [index, setIndex] = useState(initial - 1);
  const [confirming, setConfirming] = useState(false);
  const selected = generations[index];
  const readable = selected.savedAtSec !== null;

  useInput((input, key) => {
    if (confirming) {
      if (input === "y" || input === "Y") {
        onDone(selected.n);
        exit();
      } else {
        setConfirming(false);
      }
      return;
    }
    if (input === "q" || key.escape) {
      exit();
    } else if (input === "j" || key.downArrow) {
      setIndex((i) => Math.min(generations.length - 1, i + 1));
    } else if (input === "k" || key.upArrow) {
      setIndex((i) => Math.max(0, i - 1));
    } else if (/^[1-9]$/.test(input) && Number(input) <= generations.length) {
      setIndex(Number(input) - 1);
    } else if (key.return && readable) {
      setConfirming(true);
    }
  });

  const width = Math.max(30, columns);
  const inner = width - CARD_CHROME_COLS;
  const nChars = String(generations.length).length;
  const replaces: Line | null = running === undefined ? null : [
    { text: "! ", color: confirming ? DOGRUN.err : DOGRUN.warn },
    {
      text: `Replaces the running server: ${
        plural(running.windows, "window")
      } and ${plural(running.agents, "agent")} close`,
      color: confirming ? DOGRUN.err : DOGRUN.warn,
    },
  ];
  // Both cards' edges, the hint bar and its margin, the warning, and one row so
  // the cursor line ink leaves below the frame does not scroll it.
  const fixed = generations.length + 2 + 2 + 2 + (replaces ? 1 : 0) + 1;
  const body = fitLines(
    detailLines(selected, inner),
    Math.max(1, rows - fixed),
  );
  const hint: Line = confirming
    ? [
      { text: `Restore generation ${selected.n}?`, color: DOGRUN.fg },
      { text: HINT_GAP, color: DOGRUN.muted },
      ...keyTokens([["y", "restore"], ["n", "back"]]),
    ]
    : keyTokens([
      ...(readable ? [[ENTER_ICON, "restore"] as [string, string]] : []),
      ["j k", "move"],
      ["q", "quit"],
    ]);

  return (
    <Box flexDirection="column" width={width}>
      <Card
        title={[
          { text: "Restore", color: DOGRUN.fg },
          {
            text: `  ${plural(generations.length, "saved server")}`,
            color: DOGRUN.fgDim,
          },
        ]}
        width={width}
      >
        {generations.map((g, i) => (
          <Tokens
            key={g.n}
            line={generationRow(g, {
              nowSec,
              selected: i === index,
              nChars,
              width: inner,
            })}
          />
        ))}
      </Card>
      <Card
        title={[
          { text: `Generation ${selected.n}`, color: DOGRUN.fg },
          ...(readable
            ? [{
              text: `  saved ${formatSavedAt(selected.savedAtSec ?? 0)}`,
              color: DOGRUN.fgDim,
            }]
            : []),
        ]}
        width={width}
      >
        {body.map((line, i) => <Tokens key={i} line={line} />)}
      </Card>
      {replaces && <Tokens line={clampUsageTokens(replaces, width)} />}
      <Box marginTop={1}>
        <Tokens line={clampUsageTokens(hint, width)} />
      </Box>
    </Box>
  );
};

// Resolves to the generation confirmed with `y`, or null for q, Escape and
// Ctrl+C. ink has given the terminal back by then, as the attach that follows
// needs it.
export async function pickGeneration(
  opts: PickerOptions,
): Promise<number | null> {
  const result: { value: number | null } = { value: null };
  const { waitUntilExit } = render(
    <Picker
      {...opts}
      onDone={(n) => {
        result.value = n;
      }}
    />,
  );
  await waitUntilExit();
  // ink's unmount leaves Bun reading the tty. With that read still open, the
  // attach's client printed `server exited unexpectedly` on the first key
  // while the server stayed up (S92, 4 runs in 5).
  process.stdin.pause();
  return result.value;
}
