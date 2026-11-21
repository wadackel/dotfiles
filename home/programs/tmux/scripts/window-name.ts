#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null
// Writes a short name for every automatically named window into its
// @short-name option, which automatic-rename-format shows. Names are computed
// for a whole session at once because telling windows apart needs the other
// windows' names, which a tmux format cannot see.
import { homedir } from "node:os";
import { basename, dirname } from "node:path";
import { run } from "../../agents/lib/proc.ts";

export const MAX_LENGTH = 4;
export const OPTION = "@short-name";

/** Where a window's first pane is, as far as naming is concerned. */
export type Place = {
  /** Same key, same place: such windows share a name and are not told apart. */
  key: string;
  /** The repository name, or the directory name outside a repository. */
  label: string;
  /** The directory above the repository (its owner under github.com/). */
  parent: string;
  /** The repository's main checkout; undefined outside a repository. */
  root?: string;
  /** The worktree's directory name when this is not the main checkout. */
  worktree?: string;
  /** The home directory itself, outside any repository. */
  home?: boolean;
};

export type NamedWindow = { id: string; session: string; place: Place };

export function words(label: string): string[] {
  const parts = label
    .replace(/\.(nvim|vim|me|com|dev)$/i, "")
    .toLowerCase()
    .split(/[-_.\s]+/)
    .filter(Boolean);
  // 02_Notes: the number orders the directory, the word names it.
  if (parts.length > 1 && /^\d+$/.test(parts[0])) parts.shift();
  return parts;
}

const shortWord = (word: string) =>
  word.length <= MAX_LENGTH ? word : word.slice(0, 3);

// A first word that fits is what the name is called by (vim, zmk). One that
// has to be cut (sto for storycap-testrun) reads as another word and drops
// the rest, so the letters go to every word instead: stt, owc.
function baseName(place: Place): string {
  if (place.home) return "~";
  const ws = words(place.label);
  if (ws.length === 0) return place.label.slice(0, MAX_LENGTH);
  if (ws.length === 1 || ws[0].length <= MAX_LENGTH) return shortWord(ws[0]);
  if (ws.length === 2) return ws[0].slice(0, 2) + ws[1][0];
  return ws.slice(0, 3).map((w) => w[0]).join("");
}

// The shortest head of `word` (3 or 4 letters, or the whole word when it fits)
// that no rival starts with.
function distinctHead(word: string, rivals: string[]): string | undefined {
  if (word.length <= MAX_LENGTH && !rivals.includes(word)) return word;
  for (let n = 3; n <= MAX_LENGTH; n++) {
    const head = word.slice(0, n);
    if (!rivals.some((rival) => rival.slice(0, n) === head)) return head;
  }
}

function commonWords(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && a[n] === b[n]) n++;
  return n;
}

// Within windows of different repositories that share a name: when the first
// words already differ (vitest / vitant), lengthen the first word; otherwise
// the last word is the one that tells them apart (zmk-config-dax5 / -dax6).
function nameByLabel(label: string, rivals: string[]): string | undefined {
  const mine = words(label);
  const theirs = rivals.map(words);
  const shared = Math.max(...theirs.map((other) => commonWords(mine, other)));
  const pick = (ws: string[]) =>
    (shared === 0 ? ws[0] : ws[ws.length - 1]) ?? "";
  return distinctHead(pick(mine), theirs.map(pick));
}

function groupBy<T>(items: T[], key: (item: T) => string): T[][] {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    groups.set(key(item), [...(groups.get(key(item)) ?? []), item]);
  }
  return [...groups.values()];
}

/** Names for one session's windows, keyed by window id, in window order. */
export function sessionNames(windows: NamedWindow[]): Map<string, string> {
  const places = groupBy(windows, (w) => w.place.key).map((ws) => ws[0].place);
  const name = new Map(places.map((p) => [p.key, baseName(p)]));

  for (const group of groupBy(places, (p) => name.get(p.key)!)) {
    const labels = [...new Set(group.map((p) => p.label))];
    if (labels.length < 2) continue;
    for (const p of group) {
      const found = nameByLabel(p.label, labels.filter((l) => l !== p.label));
      if (found) name.set(p.key, found);
    }
  }

  for (const group of groupBy(places, (p) => name.get(p.key)!)) {
    if (group.length < 2) continue;
    const next = new Map<string, string>();
    for (const p of group) {
      const sameRepo = group.filter((o) =>
        o !== p && o.root && o.root === p.root
      );
      if (sameRepo.length > 0) {
        if (!p.worktree) continue;
        const rivals = sameRepo.map((o) => o.worktree ?? o.label);
        next.set(
          p.key,
          nameByLabel(p.worktree, rivals) ??
            p.worktree.toLowerCase().slice(0, MAX_LENGTH),
        );
      } else {
        // reg-viz/storycap-testrun and wadackel/storycap-testrun
        const initial = p.parent.toLowerCase().slice(0, 1);
        next.set(p.key, (initial + name.get(p.key)!).slice(0, MAX_LENGTH));
      }
    }
    // An initial two owners share separates nothing; leave those to the numbers.
    const taken = groupBy([...next], ([, n]) => n);
    for (const same of taken) {
      if (same.length === 1) name.set(same[0][0], same[0][1]);
    }
  }

  for (const group of groupBy(places, (p) => name.get(p.key)!)) {
    if (group.length < 2) continue;
    group.forEach((p, i) =>
      name.set(p.key, name.get(p.key)!.slice(0, MAX_LENGTH - 1) + (i + 1))
    );
  }

  return new Map(windows.map((w) => [w.id, name.get(w.place.key)!]));
}

// git answers where a path's repository and main checkout are, which also
// covers ~/dotfiles and worktrees outside a *-worktrees directory.
async function placeOf(path: string, home: string): Promise<Place> {
  const git = await run("git", [
    "-C",
    path,
    "rev-parse",
    "--path-format=absolute",
    "--show-toplevel",
    "--git-common-dir",
  ]);
  const [top, common] = git.stdout.trim().split("\n");
  if (git.code === 0 && top && common && basename(common) === ".git") {
    const root = dirname(common);
    return {
      key: top,
      label: basename(root),
      parent: basename(dirname(root)),
      root,
      worktree: top === root ? undefined : basename(top),
    };
  }
  return {
    key: path,
    label: basename(path) || path,
    parent: basename(dirname(path)),
    home: path === home,
  };
}

const SEP = "\x1f";

type Row = { session: string; id: string; current: string; path: string };

async function listWindows(): Promise<Row[]> {
  const listed = await run("tmux", [
    "list-panes",
    "-a",
    "-f",
    "#{&&:#{==:#{pane_index},#{pane-base-index}},#{automatic-rename}}",
    "-F",
    ["#{session_id}", "#{window_id}", `#{${OPTION}}`, "#{pane_current_path}"]
      .join(SEP),
  ]);
  if (listed.code !== 0) {
    throw new Error(`tmux list-panes: ${listed.stderr.trim()}`);
  }
  return listed.stdout.split("\n").filter(Boolean).map((line) => {
    const [session, id, current, path] = line.split(SEP);
    return { session, id, current, path };
  });
}

async function nameWindows(rows: Row[]): Promise<void> {
  const home = homedir();
  const places = new Map<string, Promise<Place>>();
  for (const row of rows) {
    if (!places.has(row.path)) places.set(row.path, placeOf(row.path, home));
  }
  const windows: NamedWindow[] = await Promise.all(
    rows.map(async (row) => ({
      id: row.id,
      session: row.session,
      place: await places.get(row.path)!,
    })),
  );

  const args: string[] = [];
  for (const session of groupBy(windows, (w) => w.session)) {
    for (const [id, name] of sessionNames(session)) {
      if (rows.find((row) => row.id === id)?.current === name) continue;
      if (args.length > 0) args.push(";");
      args.push("set-option", "-w", "-t", id, OPTION, name);
      // tmux re-evaluates automatic-rename-format only on pane output or when
      // the option is set, so an idle window would keep its old name. The
      // check keeps a rename-window that landed after the listing.
      args.push(
        ";",
        "if-shell",
        "-F",
        "-t",
        id,
        "#{automatic-rename}",
        `set-option -w -t ${id} automatic-rename on`,
      );
    }
  }
  if (args.length === 0) return;
  const set = await run("tmux", args);
  if (set.code !== 0) throw new Error(`tmux set-option: ${set.stderr.trim()}`);
}

const layout = (rows: Row[]) =>
  rows.map((r) => [r.session, r.id, r.path].join(SEP)).join("\n");

// Hooks start runs side by side (a restore opens windows in a burst), so a
// run that read the windows earlier can finish last. Reading them again after
// writing and starting over on a change leaves the latest state written.
async function main(): Promise<void> {
  let rows = await listWindows();
  for (let attempt = 0; attempt < 5; attempt++) {
    await nameWindows(rows);
    const now = await listWindows();
    if (layout(now) === layout(rows)) return;
    rows = now;
  }
}

if (import.meta.main) await main();
