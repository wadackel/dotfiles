#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

// Entry point for the vocabulary ontology in the Obsidian vault. The library
// (`vocab-lib.ts`) is shared with the memo scripts and the Hermes task runner;
// only this entry reads the environment.

import { text as readText } from "node:stream/consumers";
import { parseArgs } from "@std/cli/parse-args";
import { repoNameFor } from "./memo-shared.ts";
import {
  apply,
  buildDigest,
  effectiveEntries,
  hookOutput,
  init,
  lint,
  loadNotes,
  loadProposals,
  loadSchema,
  sanitizeFileName,
  symmetricRelations,
  vaultPaths,
  writeProposal,
} from "./vocab-lib.ts";
import {
  AUTO_ORIGINS,
  AUTO_PENDING_LIMIT,
  weeklyProposals,
} from "./vocab-propose.ts";

const USAGE = `Usage:
  vocab.ts init
  vocab.ts lint
  vocab.ts digest (--cwd <dir> | --repo <name>) [--repo-only]
  vocab.ts hook <claude|codex>          # SessionStart JSON on stdin
  vocab.ts apply
  vocab.ts propose --weekly               # deterministic proposals, then the week's material for drafting
  vocab.ts add <term> [--kind <kind>] [--definition <text>] [--alias <a>]... [--rel <relation>=<term>]... [--refers-to <path>]... [--path <repo path>] [--draft] [--origin explicit|weekly]   # always a pending proposal`;

const today = () => new Date().toLocaleDateString("sv-SE");

function paths() {
  const home = process.env.HOME;
  if (!home) throw new Error("HOME is empty or not set");
  return vaultPaths(home);
}

export async function digestFor(
  repo: string | null,
  includeGlobal: boolean,
): Promise<string> {
  const p = paths();
  const { schema } = await loadSchema(p);
  return buildDigest(
    effectiveEntries(await loadNotes(p), await loadProposals(p)),
    { repo, includeGlobal, symmetric: symmetricRelations(schema) },
  );
}

async function hook(agent: string): Promise<void> {
  if (agent !== "claude" && agent !== "codex") {
    throw new Error(`unknown agent: ${agent}`);
  }
  if (process.env.VOCAB_DIGEST === "off") return;
  const raw = await readText(process.stdin);
  let cwd = process.cwd();
  try {
    const input = JSON.parse(raw);
    if (typeof input.cwd === "string" && input.cwd) cwd = input.cwd;
  } catch {
    // An unreadable payload still gets the global terms.
  }
  const text = await digestFor(await repoNameFor(cwd), true);
  if (text) console.log(hookOutput(text));
}

function relations(
  values: string[],
  known: Set<string>,
): Record<string, string[]> | string {
  const out: Record<string, string[]> = {};
  for (const v of values) {
    const [rel, target] = v.split("=", 2);
    if (!rel || !target) return `--rel は <relation>=<term>: ${v}`;
    if (!known.has(rel)) return `_schema.md にない関係: ${rel}`;
    (out[rel] ??= []).push(target);
  }
  return out;
}

// Every field ends up in the digest, where a line break would start a line of
// its own that reads like part of the header.
const CONTROL = /[\u0000-\u001f\u007f]/;

export async function main(args: string[]): Promise<number> {
  const [command, ...rest] = args;
  const flags = parseArgs(rest, {
    string: ["cwd", "repo", "kind", "definition", "origin", "path"],
    boolean: ["repo-only", "draft", "weekly"],
    collect: ["alias", "rel", "refers-to"],
  });
  switch (command) {
    case "init": {
      for (const f of await init(paths())) console.log(`created: ${f}`);
      return 0;
    }
    case "lint": {
      const findings = await lint(paths());
      for (const f of findings) console.log(`[${f.level}] ${f.message}`);
      const errors = findings.filter((f) => f.level === "error").length;
      console.log(`${errors} errors, ${findings.length - errors} warnings`);
      return errors ? 1 : 0;
    }
    case "digest": {
      const repo = flags.repo ??
        (flags.cwd ? await repoNameFor(flags.cwd) : null);
      if (repo === null) {
        console.error(USAGE);
        return 2;
      }
      const text = await digestFor(repo, !flags["repo-only"]);
      if (text) console.log(text);
      return 0;
    }
    case "hook": {
      // A failing hook must never stop the session it runs in.
      try {
        await hook(String(flags._[0] ?? ""));
      } catch (e) {
        console.error(`vocab hook: ${e}`);
      }
      return 0;
    }
    case "apply": {
      for (const line of await apply(paths(), today())) console.log(line);
      return 0;
    }
    case "add": {
      const term = String(flags._[0] ?? "");
      const p = paths();
      const exists = (await loadNotes(p)).some((n) =>
        n.name === sanitizeFileName(term)
      );
      const { schema } = await loadSchema(p);
      const rels = relations(
        ((flags.rel ?? []) as string[]).map(String),
        new Set(Object.keys(schema.relations)),
      );
      if (typeof rels === "string") {
        console.error(rels);
        return 2;
      }
      const aliases = ((flags.alias ?? []) as string[]).map(String);
      const fields = [
        term,
        flags.definition ?? "",
        flags.path ?? "",
        ...aliases,
        ...Object.values(rels).flat(),
        ...((flags["refers-to"] ?? []) as string[]).map(String),
      ];
      if (fields.some((f) => CONTROL.test(f))) {
        console.error("改行や制御文字を含む値は書かない");
        return 2;
      }
      if (
        !term ||
        (!exists && (!flags.kind || !flags.definition)) ||
        (exists && !flags.definition && !Object.keys(rels).length &&
          !aliases.length)
      ) {
        console.error(USAGE);
        return 2;
      }
      const origin = flags.origin ?? "explicit";
      if (origin !== "explicit" && origin !== "weekly") {
        console.error(USAGE);
        return 2;
      }
      if (origin === "weekly") {
        const waiting = (await loadProposals(p)).filter((x) =>
          x.status === "pending" &&
          AUTO_ORIGINS.has(x.origin)
        ).length;
        if (waiting >= AUTO_PENDING_LIMIT) {
          console.error(
            `承認待ちの自動提案が ${waiting} 件あるため書かない（上限 ${AUTO_PENDING_LIMIT}）`,
          );
          return 1;
        }
      }
      // Every addition waits for the owner's approval in the Bases view, even
      // one the owner dictated: this command is allowed without a prompt, so a
      // direct write would let injected text become approved vocabulary.
      // An approved vocab-definition replaces the note's refers_to when it
      // carries one, so an empty list here would erase the existing paths.
      const refs = ((flags["refers-to"] ?? []) as string[]).map(String);
      const kind = !exists
        ? "vocab-new"
        : flags.definition
        ? "vocab-definition"
        : Object.keys(rels).length
        ? "vocab-relation"
        : "vocab-alias";
      const path = await writeProposal(
        p,
        {
          origin,
          kind,
          term,
          vocab_kind: flags.kind,
          definition: flags.definition,
          vocab_aliases: aliases,
          relations: rels,
          ...(refs.length ? { refers_to: refs } : {}),
          ...(flags.path ? { path: flags.path } : {}),
        },
        [
          origin === "weekly"
            ? "週次の材料からエージェントが起こした定義"
            : flags.draft
            ? "ユーザーの明示の依頼（定義はエージェントが起こした）"
            : "ユーザーが自分で述べた定義",
        ],
        today(),
      );
      if (!path) {
        console.error("提案を書けなかった（連番の衝突が続いた）");
        return 1;
      }
      console.log(path);
      return 0;
    }
    case "propose": {
      if (!flags.weekly) {
        console.error(USAGE);
        return 2;
      }
      const home = process.env.HOME;
      if (!home) throw new Error("HOME is empty or not set");
      const { report, packet } = await weeklyProposals({
        home,
        now: new Date(),
        today: today(),
      });
      console.log([...report, "", packet].join("\n"));
      return 0;
    }
    default:
      console.error(USAGE);
      return 2;
  }
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
