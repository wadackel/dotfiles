#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null
// Removes the given linked worktrees that hold no uncommitted work and lists the rest.
// Usage: remove-clean-worktrees.ts <worktree>...

import { existsSync } from "node:fs";
import { readFile, realpath } from "node:fs/promises";
import { run } from "../../../../agents/lib/proc.ts";

export type Outcome =
  | { path: string; removed: true }
  | { path: string; removed: false; reason: string };

type Entry = { path: string; locked: string | null };

const IN_PROGRESS = [
  "rebase-merge",
  "rebase-apply",
  "MERGE_HEAD",
  "CHERRY_PICK_HEAD",
  "REVERT_HEAD",
  "BISECT_LOG",
  "sequencer",
];

const git = (cwd: string, args: string[]) => run("git", ["-C", cwd, ...args]);

const firstLine = (text: string) => text.trim().split("\n")[0] ?? "";

// From `git worktree list --porcelain -z`: without -z, git quotes a path or a lock reason
// that holds special characters.
function parseWorktreeList(porcelain: string): Entry[] {
  const entries: Entry[] = [];
  for (const block of porcelain.split("\0\0")) {
    const lines = block.split("\0").filter(Boolean);
    const head = lines.find((l) => l.startsWith("worktree "));
    if (!head) continue;
    const lock = lines.find((l) => l === "locked" || l.startsWith("locked "));
    entries.push({
      path: head.slice("worktree ".length),
      locked: lock === undefined ? null : lock.slice("locked ".length),
    });
  }
  return entries;
}

async function realMainOf(dir: string): Promise<string | null> {
  const list = await git(dir, ["worktree", "list", "--porcelain", "-z"]);
  const main = list.code === 0 ? parseWorktreeList(list.stdout)[0] : undefined;
  return main ? realpath(main.path).catch(() => main.path) : null;
}

async function removeOne(given: string, home: string | null): Promise<Outcome> {
  const kept = (reason: string): Outcome => ({
    path: given,
    removed: false,
    reason,
  });

  const path = await realpath(given).catch(() => null);
  if (path === null) return kept("no such directory");

  const top = await git(path, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return kept("not inside a git worktree");
  if ((await realpath(top.stdout.trim())) !== path) {
    return kept(`not the top of a worktree (that is ${top.stdout.trim()})`);
  }

  const list = await git(path, ["worktree", "list", "--porcelain", "-z"]);
  if (list.code !== 0) {
    return kept(`git worktree list failed: ${firstLine(list.stderr)}`);
  }
  // git lists a worktree by the path it was added with, which may go through a symlink.
  const entries = await Promise.all(
    parseWorktreeList(list.stdout).map(async (e) => ({
      ...e,
      real: await realpath(e.path).catch(() => e.path),
    })),
  );
  const [main, ...linked] = entries;
  if (!main || main.real === path) return kept("the main worktree");
  const entry = linked.find((e) => e.real === path);
  if (!entry) return kept("not listed by git worktree list");
  if (main.real !== home) {
    return kept(
      "a worktree of another repository than the current directory's",
    );
  }
  // A worktree inside this one often sits under an ignored directory, which status does
  // not look into, and removing the parent would take its work along.
  const nested = linked.find((e) => e.real.startsWith(`${path}/`));
  if (nested) return kept(`holds the worktree ${nested.path}`);

  // Untracked files count as work; ignored ones (build output, caches) do not. The flag
  // overrides a status.showUntrackedFiles=no in the repository's config.
  const status = await git(path, [
    "status",
    "--porcelain",
    "--untracked-files=normal",
    "--ignore-submodules=none",
  ]);
  if (status.code !== 0) {
    return kept(`git status failed: ${firstLine(status.stderr)}`);
  }
  const changes = status.stdout.split("\n").filter(Boolean);
  if (changes.length > 0) {
    const shown = changes.slice(0, 3).join(", ");
    const more = changes.length > 3 ? `, and ${changes.length - 3} more` : "";
    return kept(`${changes.length} uncommitted (${shown}${more})`);
  }
  // Status does not compare a file marked assume-unchanged (lowercase tag) or
  // skip-worktree (S), so a change to one would go unseen.
  const flagged = await git(path, ["ls-files", "-v"]);
  if (flagged.code !== 0) {
    return kept(`git ls-files failed: ${firstLine(flagged.stderr)}`);
  }
  const hidden = flagged.stdout.split("\n").filter((l) =>
    /^([a-z]|S) /.test(l)
  );
  if (hidden.length > 0) {
    return kept(
      `${hidden.length} files git status does not compare (${hidden[0] ?? ""})`,
    );
  }

  // A clean status still hides two kinds of work removal would lose: a paused rebase,
  // merge, cherry-pick, revert, sequence or bisect, and commits on a detached HEAD no
  // ref contains.
  for (const marker of IN_PROGRESS) {
    const p = await git(path, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      marker,
    ]);
    if (p.code === 0 && existsSync(p.stdout.trim())) {
      return kept(`${marker} in progress`);
    }
  }
  const onBranch = await git(path, ["symbolic-ref", "-q", "HEAD"]);
  if (onBranch.code !== 0) {
    const holders = await git(path, [
      "for-each-ref",
      "--count=1",
      "--contains",
      "HEAD",
    ]);
    if (holders.code !== 0 || holders.stdout.trim() === "") {
      return kept("detached HEAD with commits no ref contains");
    }
  }

  // The lock file holds the reason as written; git's listing trims it.
  let reason: string | null = null;
  if (entry.locked !== null) {
    const file = await git(path, [
      "rev-parse",
      "--path-format=absolute",
      "--git-path",
      "locked",
    ]);
    reason = file.code === 0
      ? await readFile(file.stdout.trim(), "utf8")
        .then((t) => t.replace(/\n$/, ""))
        .catch(() => entry.locked)
      : entry.locked;
    const unlock = await git(main.path, ["worktree", "unlock", entry.path]);
    if (unlock.code !== 0) {
      return kept(`unlock failed: ${firstLine(unlock.stderr)}`);
    }
  }
  // No --force: git checks for modified and untracked files again at removal, so work
  // written after the status above still stops it (untracked files only where the
  // config does not hide them from status).
  const remove = await git(main.path, ["worktree", "remove", entry.path]);
  if (remove.code === 0) return { path: given, removed: true };
  const refused = `git worktree remove refused: ${firstLine(remove.stderr)}`;
  if (reason !== null) {
    const lock = await git(main.path, [
      "worktree",
      "lock",
      ...(reason === "" ? [] : ["--reason", reason]),
      entry.path,
    ]);
    if (lock.code !== 0) {
      return kept(`${refused}; left UNLOCKED: ${firstLine(lock.stderr)}`);
    }
  }
  return kept(refused);
}

// One at a time, each outcome printed as it is known: a run cut short by a timeout still
// reports the removals it made.
export async function* removeCleanWorktrees(
  paths: string[],
): AsyncGenerator<Outcome> {
  // Only worktrees of the repository the caller stands in: a report line naming another
  // repository's worktree is listed instead of acted on.
  const home = await realMainOf(process.cwd());
  for (const path of paths) {
    yield await removeOne(path, home).catch((e: unknown): Outcome => ({
      path,
      removed: false,
      reason: `failed: ${e instanceof Error ? e.message : String(e)}`,
    }));
  }
}

if (import.meta.main) {
  const paths = process.argv.slice(2);
  if (paths.length === 0 || paths.some((p) => p.startsWith("-"))) {
    console.error("usage: remove-clean-worktrees.ts <worktree>...");
    process.exit(2);
  }
  for await (const o of removeCleanWorktrees(paths)) {
    console.log(
      o.removed ? `removed ${o.path}` : `kept ${o.path}: ${o.reason}`,
    );
  }
}
