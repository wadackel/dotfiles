#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

// Prints, as JSON, what /mise-update can update: the pins in the Nix mise
// config compared with what mise has installed, what is newer, and which
// skills record a tool version other than the pin.

import { readdir, readFile, realpath } from "node:fs/promises";
import { userInfo } from "node:os";
import { join, resolve } from "node:path";
import { run } from "../../../home/programs/agents/lib/proc.ts";

export const LANGUAGES = ["go", "node", "python", "rust"] as const;

const PINS_BY_USER =
  `cs: builtins.listToAttrs (map (c: let u = c.config.system.primaryUser; in { name = u; value = c.config.home-manager.users.\${u}.programs.mise.globalConfig.tools; }) (builtins.attrValues cs))`;

const SKILL_ROOTS = [
  "home/programs/agents/skills",
  "home/programs/claude/skills",
];

export type Pin = string | { version: string; components?: string[] };

export type Notice = {
  skill: string;
  tool: string;
  /** `Vendored version:` for a copied skill, `Verified version:` for one written here. */
  version: string;
  kind: "vendored" | "verified";
};

export type BumpKind = "major" | "0.x-minor" | "minor" | "patch" | "other";

export type Status = {
  languages: {
    tool: string;
    pinned: string;
    inLine: string | null;
    overall: string | null;
  }[];
  tools: { tool: string; pinned: string; latest: string; kind: BumpKind }[];
  staleSkills: {
    tool: string;
    pinned: string;
    recorded: string;
    kind: Notice["kind"];
    skills: string[];
  }[];
  pinMismatch: { tool: string; pinned: string; active: string | null }[];
  /** NOTICE `Tool:` values that name no pinned tool, so their skills are never compared. */
  unknownTools: { tool: string; skills: string[] }[];
  upToDate: string[];
  /** Lookups that failed; the groups above may be missing a newer release. */
  errors: string[];
};

export function pinVersion(pin: Pin): string {
  return typeof pin === "string" ? pin : pin.version;
}

/** The release line a language stays on unless the user picks a line change. */
export function lineOf(tool: string, version: string): string | null {
  if (tool === "rust") return version.startsWith("nightly") ? "nightly" : null;
  const parts = version.split(".");
  if (tool === "node") return parts[0] ?? null;
  if (tool === "go" || tool === "python") {
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : null;
  }
  return null;
}

function numbers(version: string): number[] | null {
  const m = version.match(/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];
}

/**
 * Whether `to` is a later release than `from`. A pin pushed from the other machine can be
 * ahead of what this machine's mise has seen, and that must not read as an update.
 */
export function isNewer(from: string, to: string): boolean {
  if (from.startsWith("nightly-") && to.startsWith("nightly-")) {
    return to > from;
  }
  const a = numbers(from);
  const b = numbers(to);
  if (!a || !b) return from !== to;
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return b[i]! > a[i]!;
  }
  return false;
}

export function bumpKind(from: string, to: string): BumpKind {
  const a = numbers(from);
  const b = numbers(to);
  if (!a || !b) return "other";
  if (a[0] !== b[0]) return "major";
  if (a[1] !== b[1]) return a[0] === 0 ? "0.x-minor" : "minor";
  return "patch";
}

export function parseNotice(skill: string, text: string): Notice | null {
  const field = (name: string) =>
    text.match(new RegExp(`^${name}:[ \\t]*(\\S.*?)[ \\t]*$`, "m"))?.[1] ??
      null;
  const tool = field("Tool");
  if (!tool) return null;
  const vendored = field("Vendored version");
  const verified = field("Verified version");
  const version = vendored ?? verified;
  if (!version) return null;
  return { skill, tool, version, kind: vendored ? "vendored" : "verified" };
}

export type StatusInput = {
  pins: Record<string, Pin>;
  /** Active version per tool from `mise ls --global --json`. */
  active: Record<string, string | null>;
  /** Newest release per tool from `mise outdated --bump --json`; absent when current. */
  newest: Record<string, string>;
  /** Newest release on the pinned line per language, from `mise latest <tool>@<line>`. */
  newestInLine: Record<string, string>;
  notices: Notice[];
  errors?: string[];
};

export function buildStatus(input: StatusInput): Status {
  const status: Status = {
    languages: [],
    tools: [],
    staleSkills: [],
    pinMismatch: [],
    unknownTools: [],
    upToDate: [],
    errors: input.errors ?? [],
  };
  for (const [tool, pin] of Object.entries(input.pins)) {
    const pinned = pinVersion(pin);
    const active = input.active[tool] ?? null;
    const mismatch = active !== pinned;
    if (mismatch) status.pinMismatch.push({ tool, pinned, active });

    const newest = input.newest[tool];
    const overall = newest && isNewer(pinned, newest) ? newest : null;
    if ((LANGUAGES as readonly string[]).includes(tool)) {
      const line = input.newestInLine[tool];
      // Without the in-line lookup, a newest release on the pinned line is still in-line.
      const sameLine = overall !== null &&
        lineOf(tool, overall) === lineOf(tool, pinned);
      const inLine = tool === "rust"
        ? overall
        : line && isNewer(pinned, line)
        ? line
        : line === undefined && sameLine
        ? overall
        : null;
      if (inLine || overall) {
        status.languages.push({
          tool,
          pinned,
          inLine,
          overall: overall === inLine ? null : overall,
        });
        continue;
      }
    } else if (overall) {
      status.tools.push({
        tool,
        pinned,
        latest: overall,
        kind: bumpKind(pinned, overall),
      });
      continue;
    }
    if (!mismatch) status.upToDate.push(tool);
  }

  const byTool = new Map<string, Notice[]>();
  for (const n of input.notices) {
    byTool.set(n.tool, [...(byTool.get(n.tool) ?? []), n]);
  }
  for (const [tool, notices] of byTool) {
    const pin = input.pins[tool];
    if (pin === undefined) {
      status.unknownTools.push({
        tool,
        skills: notices.map((n) => n.skill).sort(),
      });
      continue;
    }
    const pinned = pinVersion(pin);
    const groups = new Map<string, Notice[]>();
    for (const n of notices) {
      if (n.version === pinned) continue;
      const key = `${n.kind}\0${n.version}`;
      groups.set(key, [...(groups.get(key) ?? []), n]);
    }
    for (const group of groups.values()) {
      status.staleSkills.push({
        tool,
        pinned,
        recorded: group[0]!.version,
        kind: group[0]!.kind,
        skills: group.map((n) => n.skill).sort(),
      });
    }
  }
  return status;
}

async function json(
  cmd: string,
  args: string[],
  cwd: string,
  stderrTo?: string[],
): Promise<unknown> {
  const r = await run(cmd, args, { cwd });
  if (r.code !== 0) {
    throw new Error(
      `${cmd} ${args.join(" ")} exited ${r.code}: ${r.stderr.trim()}`,
    );
  }
  // Only the lines that say a lookup failed; retries and unrelated warnings are noise.
  const err = r.stderr.split("\n").filter((l) =>
    /error|could not/i.test(l) && !/attempt \d+ failed/.test(l)
  ).join("\n");
  if (stderrTo && err) stderrTo.push(`${cmd} ${args.join(" ")}: ${err}`);
  return JSON.parse(r.stdout || "{}");
}

async function readNotices(root: string): Promise<Notice[]> {
  const seen = new Set<string>();
  const notices: Notice[] = [];
  for (const dir of SKILL_ROOTS) {
    const base = join(root, dir);
    for (const entry of await readdir(base)) {
      const real = await realpath(join(base, entry)).catch(() => null);
      if (!real || seen.has(real)) continue;
      seen.add(real);
      const text = await readFile(join(real, "NOTICE"), "utf8").catch(() =>
        null
      );
      const notice = text === null ? null : parseNotice(entry, text);
      if (notice) notices.push(notice);
    }
  }
  return notices;
}

async function main(): Promise<void> {
  const root = resolve(import.meta.dirname, "../../..");
  const user = userInfo().username;
  const errors: string[] = [];
  const [pins, ls, outdated, notices] = await Promise.all([
    // The standalone homeConfigurations do not evaluate (no `profile` argument), so read the
    // darwin profile whose primary user is the current one.
    json("nix", [
      "eval",
      "--json",
      ".#darwinConfigurations",
      "--apply",
      PINS_BY_USER,
    ], root),
    json("mise", ["ls", "--global", "--json"], root),
    // A release lookup that fails drops the tool from the output and still exits 0,
    // so anything on stderr is passed on rather than read as "up to date".
    json("mise", ["outdated", "--bump", "--json"], root, errors),
    readNotices(root),
  ]);
  const pinMap = (pins as Record<string, Record<string, Pin>>)[user];
  if (!pinMap) {
    throw new Error(`no darwin profile has ${user} as its primary user`);
  }

  const active: Record<string, string | null> = {};
  for (
    const [tool, versions] of Object.entries(
      ls as Record<
        string,
        { version: string; active?: boolean; installed?: boolean }[]
      >,
    )
  ) {
    active[tool] = versions.find((v) => v.active && v.installed)?.version ??
      null;
  }
  const newest: Record<string, string> = {};
  for (
    const [tool, o] of Object.entries(
      outdated as Record<string, { latest?: string; bump?: string }>,
    )
  ) {
    const v = o.latest ?? o.bump;
    if (v) newest[tool] = v;
  }
  const newestInLine: Record<string, string> = {};
  await Promise.all(
    LANGUAGES.filter((t) => t !== "rust" && pinMap[t] !== undefined).map(
      async (tool) => {
        const line = lineOf(tool, pinVersion(pinMap[tool]!));
        if (!line) return;
        const r = await run("mise", ["latest", `${tool}@${line}`], {
          cwd: root,
        });
        const v = r.stdout.trim();
        if (r.code === 0 && v) newestInLine[tool] = v;
        else {
          errors.push(
            `mise latest ${tool}@${line} exited ${r.code}: ${r.stderr.trim()}`,
          );
        }
      },
    ),
  );

  console.log(
    JSON.stringify(
      buildStatus({
        pins: pinMap,
        active,
        newest,
        newestInLine,
        notices,
        errors,
      }),
      null,
      2,
    ),
  );
}

if (import.meta.main) await main();
