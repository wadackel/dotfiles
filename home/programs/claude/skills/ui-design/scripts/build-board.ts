#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null
/**
 * Builds the ui-design comparison board.
 *
 * Usage: build-board.ts <board-dir>
 *
 * Reads <board-dir>/board.json, inlines every option's HTML file (paths are
 * relative to <board-dir>), and writes <board-dir>/index.html from the
 * template in ../assets/board.html. Exits 1 with every problem listed when
 * the board is invalid.
 */
import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const STAGES = [
  "define",
  "criteria",
  "sketch",
  "style-tile",
  "refine",
  "validate",
] as const;
type Stage = (typeof STAGES)[number];

export type BoardOption = {
  id: string;
  name: string;
  axis?: string;
  tradeoff?: string;
  file: string;
  width: number;
  height: number;
};

export type BoardRound = {
  id: string;
  stage: Stage;
  question: string;
  options: BoardOption[];
};

export type Board = {
  title: string;
  target: string;
  stage: Stage;
  decisions: { stage: Stage; text: string; over?: string }[];
  rounds: BoardRound[];
  artifact?: { slug: string; version: string };
};

const ID = /^[A-Za-z0-9_-]{1,40}$/;
// The built page is published, so an option file outside variants/ would carry
// any readable file (a key, a private note) to claude.ai.
const OPTION_FILE = /^variants\/[A-Za-z0-9_.-]+\.html$/;

export function validateBoard(
  input: unknown,
): { board?: Board; errors: string[] } {
  const errors: string[] = [];
  const b = input as Partial<Board>;
  const isStage = (s: unknown): s is Stage => STAGES.includes(s as Stage);
  const stageHint = `one of ${STAGES.join(", ")}`;
  if (typeof b !== "object" || b === null) {
    return { errors: ["board.json must be a JSON object"] };
  }
  if (typeof b.title !== "string" || !b.title) {
    errors.push("title: required string");
  }
  if (typeof b.target !== "string" || !b.target) {
    errors.push("target: required string");
  }
  if (!isStage(b.stage)) {
    errors.push(`stage: got ${JSON.stringify(b.stage)}, expected ${stageHint}`);
  }
  if (!Array.isArray(b.decisions)) {
    errors.push("decisions: required array (use [] when nothing is decided)");
  } else {
    b.decisions.forEach((d, i) => {
      if (!isStage(d?.stage)) {
        errors.push(`decisions[${i}].stage: expected ${stageHint}`);
      }
      if (typeof d?.text !== "string" || !d.text) {
        errors.push(`decisions[${i}].text: required string`);
      }
    });
  }
  if (
    b.artifact !== undefined &&
    (typeof b.artifact?.slug !== "string" ||
      typeof b.artifact?.version !== "string")
  ) {
    errors.push(
      "artifact: { slug, version } strings, or leave it out before the first publish",
    );
  }
  if (!Array.isArray(b.rounds)) errors.push("rounds: required array");
  else {
    const roundIds = new Set<string>();
    b.rounds.forEach((r, i) => {
      const at = `rounds[${i}]`;
      if (typeof r?.id !== "string" || !ID.test(r.id)) {
        errors.push(`${at}.id: letters, digits, _ or -, up to 40`);
      } else if (roundIds.has(r.id)) errors.push(`${at}.id: duplicate ${r.id}`);
      else roundIds.add(r.id);
      if (!isStage(r?.stage)) errors.push(`${at}.stage: expected ${stageHint}`);
      if (typeof r?.question !== "string" || !r.question) {
        errors.push(`${at}.question: required string`);
      }
      if (!Array.isArray(r?.options) || r.options.length === 0) {
        errors.push(`${at}.options: at least one option`);
        return;
      }
      const optionIds = new Set<string>();
      r.options.forEach((o, j) => {
        const oat = `${at}.options[${j}]`;
        if (typeof o?.id !== "string" || !ID.test(o.id)) {
          errors.push(`${oat}.id: letters, digits, _ or -, up to 40`);
        } else if (optionIds.has(o.id)) {
          errors.push(`${oat}.id: duplicate ${o.id} in round ${r.id}`);
        } else optionIds.add(o.id);
        if (typeof o?.name !== "string" || !o.name) {
          errors.push(`${oat}.name: required string`);
        }
        if (typeof o?.file !== "string" || !OPTION_FILE.test(o.file)) {
          errors.push(
            `${oat}.file: got ${
              JSON.stringify(o?.file)
            }, expected variants/<name>.html`,
          );
        }
        for (const k of ["width", "height"] as const) {
          if (!Number.isInteger(o?.[k]) || o[k] < 40 || o[k] > 4000) {
            errors.push(`${oat}.${k}: integer px between 40 and 4000`);
          }
        }
      });
    });
  }
  return errors.length ? { errors } : { board: b as Board, errors };
}

// The data sits inside <script type="application/json">: a literal "</script" or
// "<!--" in a variant's HTML would end or comment out that element.
export function embedJson(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function buildBoard(
  boardDir: string,
  template: string,
): { html?: string; errors: string[] } {
  const jsonPath = join(boardDir, "board.json");
  if (!existsSync(jsonPath)) return { errors: [`${jsonPath}: not found`] };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(jsonPath, "utf8"));
  } catch (e) {
    return { errors: [`${jsonPath}: ${(e as Error).message}`] };
  }
  const { board, errors } = validateBoard(parsed);
  // Files are checked even when the schema has errors, so one run lists every problem.
  const variantsReal = join(realpathSync(boardDir), "variants");
  const htmlByOption = new Map<object, string>();
  const rawRounds = Array.isArray((parsed as Partial<Board>)?.rounds)
    ? (parsed as Board).rounds
    : [];
  for (const r of rawRounds) {
    for (const o of Array.isArray(r?.options) ? r.options : []) {
      if (typeof o?.file !== "string" || !OPTION_FILE.test(o.file)) continue;
      const at = `round ${r.id} option ${o.id}`;
      const path = resolve(boardDir, o.file);
      if (!existsSync(path)) {
        errors.push(`${at}: file ${o.file} not found (looked at ${path})`);
        continue;
      }
      const real = realpathSync(path);
      const rel = relative(variantsReal, real);
      if (
        rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel) ||
        !statSync(real).isFile()
      ) {
        errors.push(
          `${at}: ${o.file} resolves to ${real}, outside ${variantsReal} or not a regular file`,
        );
        continue;
      }
      htmlByOption.set(o, readFileSync(real, "utf8"));
    }
  }
  if (!board || errors.length) return { errors };
  const rounds = board.rounds.map((r) => ({
    ...r,
    options: r.options.map((o) => ({ ...o, html: htmlByOption.get(o) ?? "" })),
  }));
  // One pass over the template: a title containing "__BOARD_DATA__" must not receive the data.
  const fill: Record<string, () => string> = {
    __TITLE__: () => escapeText(board.title),
    __BOARD_DATA__: () => embedJson({ ...board, rounds }),
  };
  const html = template.replace(/__TITLE__|__BOARD_DATA__/g, (m) => fill[m]());
  return { html, errors };
}

function isSymlink(path: string): boolean {
  try {
    return lstatSync(path).isSymbolicLink();
  } catch {
    return false;
  }
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

if (import.meta.main) {
  const dir = process.argv[2];
  if (!dir || dir === "--help" || dir === "-h") {
    console.error(
      "usage: build-board.ts <board-dir>  (reads <board-dir>/board.json, writes <board-dir>/index.html)",
    );
    process.exit(dir ? 0 : 1);
  }
  const here = dirname(fileURLToPath(import.meta.url));
  const template = readFileSync(
    join(here, "..", "assets", "board.html"),
    "utf8",
  );
  const { html, errors } = buildBoard(resolve(dir), template);
  if (!html) {
    for (const e of errors) console.error(e);
    process.exit(1);
  }
  const out = join(resolve(dir), "index.html");
  if (isSymlink(out)) {
    console.error(`${out}: is a symbolic link; refusing to write through it`);
    process.exit(1);
  }
  writeFileSync(out, html);
  console.log(out);
}
