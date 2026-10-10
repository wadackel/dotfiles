#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

// Merges the Nix-managed settings into ~/.codex/config.toml as TOML values
// rather than as a marked text block: the ChatGPT desktop app rewrites the
// whole file and drops comments, so markers cannot survive it, and re-adding
// the block then duplicates every managed key. Keys outside the managed set
// (e.g. [projects.*] / [notice], mutated by Codex at runtime) are kept.

import { readFile, writeFile } from "node:fs/promises";
import { parse, stringify } from "smol-toml";

type Table = Record<string, unknown>;
type KeyPath = string[];

export type ApplyAction = "created" | "updated" | "noop";

export interface SpliceResult {
  next: string;
  action: ApplyAction;
  // Managed leaf paths, stored so that a key dropped from Nix can be removed on
  // the next run. Segment arrays, because TOML keys may themselves contain dots.
  paths: KeyPath[];
}

const LEGACY_START_MARKER = "# nix-managed:start\n";
const LEGACY_END_MARKER = "# nix-managed:end\n";
const PREVIOUS_NOTIFY_FLAG = "--previous-notify";

function isTable(value: unknown): value is Table {
  return typeof value === "object" && value !== null &&
    !Array.isArray(value) && !(value instanceof Date);
}

function leafPaths(table: Table, prefix: KeyPath = []): KeyPath[] {
  return Object.entries(table).flatMap(([key, value]) =>
    isTable(value) && Object.keys(value).length > 0
      ? leafPaths(value, [...prefix, key])
      : [[...prefix, key]]
  );
}

function getPath(table: Table, path: KeyPath): unknown {
  let node: unknown = table;
  for (const key of path) {
    if (!isTable(node)) return undefined;
    node = node[key];
  }
  return node;
}

function setPath(table: Table, path: KeyPath, value: unknown): void {
  let node = table;
  for (const key of path.slice(0, -1)) {
    node[key] ??= {};
    const child = node[key];
    if (!isTable(child)) {
      throw new Error(
        `cannot set ${
          path.join(".")
        }: ${key} is not a table in the current config`,
      );
    }
    node = child;
  }
  node[path[path.length - 1]] = value;
}

// Only the ancestors of the removed key are pruned when they become empty; a
// table that was already empty (e.g. [desktop]) is someone else's state.
function deletePath(table: Table, path: KeyPath): void {
  const ancestors: Table[] = [table];
  for (const key of path.slice(0, -1)) {
    const child = ancestors[ancestors.length - 1][key];
    if (!isTable(child)) return;
    ancestors.push(child);
  }
  const last = path.length - 1;
  if (!(path[last] in ancestors[last])) return;
  delete ancestors[last][path[last]];
  for (let i = last; i > 0 && Object.keys(ancestors[i]).length === 0; i--) {
    delete ancestors[i - 1][path[i - 1]];
  }
}

function parseCommand(payload: unknown): string[] | null {
  if (typeof payload !== "string") return null;
  try {
    const value = JSON.parse(payload);
    return Array.isArray(value) && value.every((v) => typeof v === "string")
      ? value
      : null;
  } catch {
    return null;
  }
}

// The desktop app wraps notify as `<client> turn-ended --previous-notify
// '<JSON of the previous notify>'` for Computer Use. Keeping the wrapper and
// swapping only its payload keeps both notifications; overwriting it would
// drop the app's until it re-wraps, and the payload goes stale on every bun
// store-path change.
function mergeNotify(current: unknown, managed: unknown): unknown {
  if (!Array.isArray(current)) return managed;
  const index = current.indexOf(PREVIOUS_NOTIFY_FLAG) + 1;
  const previous = index > 0 ? parseCommand(current[index]) : null;
  if (previous === null) return managed;
  if (JSON.stringify(previous) === JSON.stringify(managed)) return current;
  return current.with(index, JSON.stringify(managed));
}

function removeLegacyBlock(content: string): string {
  const start = content.indexOf(LEGACY_START_MARKER);
  const end = start === -1 ? -1 : content.indexOf(LEGACY_END_MARKER, start);
  if (end === -1) return content;
  return content.slice(0, start) +
    content.slice(end + LEGACY_END_MARKER.length);
}

export function spliceContent(
  current: string | null,
  managedBody: string,
  previousPaths: KeyPath[],
): SpliceResult {
  const managed = parse(managedBody);
  const paths = leafPaths(managed);

  if (current === null) {
    return { next: stringify(managed), action: "created", paths };
  }

  const unmarked = removeLegacyBlock(current);
  const doc = parse(unmarked);
  const kept = new Set(paths.map((path) => JSON.stringify(path)));
  for (const path of previousPaths) {
    if (!kept.has(JSON.stringify(path))) deletePath(doc, path);
  }
  for (const path of paths) {
    const value = getPath(managed, path);
    setPath(
      doc,
      path,
      path.length === 1 && path[0] === "notify"
        ? mergeNotify(doc.notify, value)
        : value,
    );
  }

  const next = stringify(doc);
  if (unmarked === current && next === stringify(parse(current))) {
    return { next: current, action: "noop", paths };
  }
  return { next, action: "updated", paths };
}

async function readIfExists(path: string): Promise<string | null> {
  try {
    return await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

async function readPreviousPaths(statePath: string): Promise<KeyPath[]> {
  const raw = await readIfExists(statePath);
  if (raw === null) return [];
  const { paths } = JSON.parse(raw);
  if (
    !Array.isArray(paths) ||
    !paths.every((path) =>
      Array.isArray(path) && path.every((key) => typeof key === "string")
    )
  ) {
    throw new Error(`${statePath}: expected {"paths": string[][]}`);
  }
  return paths;
}

export async function apply(
  managedPath: string,
  targetPath: string,
): Promise<ApplyAction> {
  const statePath = `${targetPath}.nix-managed.json`;
  const { next, action, paths } = spliceContent(
    await readIfExists(targetPath),
    await readFile(managedPath, "utf8"),
    await readPreviousPaths(statePath),
  );

  // The config goes first: a state file ahead of a failed config write would
  // forget keys that are still in the config.
  if (action !== "noop") await writeFile(targetPath, next);
  const state = JSON.stringify({ paths }, null, 2) + "\n";
  if (await readIfExists(statePath) !== state) {
    await writeFile(statePath, state);
  }
  return action;
}

if (import.meta.main) {
  const [managedPath, targetPath] = process.argv.slice(2);
  if (!managedPath || !targetPath) {
    console.error("usage: apply-managed.ts <managed-toml-path> <target-path>");
    process.exit(2);
  }
  const action = await apply(managedPath, targetPath);
  console.error(`[codex-config] ${action}: ${targetPath}`);
}
