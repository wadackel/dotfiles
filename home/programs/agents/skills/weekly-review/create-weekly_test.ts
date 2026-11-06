import { assert, assertEquals, assertStringIncludes, assertThrows } from "@std/assert";
import { test } from "bun:test";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderWeeklyTemplate } from "./create-weekly.ts";

const tp = (fmt: string, offset: number) =>
  `<% tp.date.now("${fmt}", ${offset}, tp.file.title, "YYYY-[W]WW") %>`;

const TEMPLATE = [
  "---",
  "tags:",
  "  - weekly",
  `previous: "[[${tp("YYYY-[W]WW", -1)}]]"`,
  `next: "[[${tp("YYYY-[W]WW", 7)}]]"`,
  "---",
  "",
  "## 📝 History",
  "",
  ...[0, 1, 2, 3, 4, 5, 6].flatMap((i) => [
    `### [[${tp("YYYY-MM-DD", i)}]]`,
    "",
    `![[${tp("YYYY-MM-DD", i)}#✍️ Memo]]`,
    "",
  ]),
  `        - date >= "${tp("YYYY-MM-DD", 0)}"`,
  `        - date <= "${tp("YYYY-MM-DD", 6)}"`,
  "",
].join("\n");

test("2026-W45: prev/next links, seven history days, reading range", () => {
  const out = renderWeeklyTemplate(TEMPLATE, "2026-W45");
  assertStringIncludes(out, 'previous: "[[2026-W44]]"');
  assertStringIncludes(out, 'next: "[[2026-W46]]"');
  const days = [...out.matchAll(/^### \[\[(\d{4}-\d{2}-\d{2})\]\]$/gm)].map((m) => m[1]);
  assertEquals(days, [
    "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05",
    "2026-11-06", "2026-11-07", "2026-11-08",
  ]);
  assertStringIncludes(out, "![[2026-11-08#✍️ Memo]]");
  assertStringIncludes(out, 'date >= "2026-11-02"');
  assertStringIncludes(out, 'date <= "2026-11-08"');
  assert(!out.includes("<%"));
});

test("2026-W53: next crosses into 2027-W01, prev is W52", () => {
  const out = renderWeeklyTemplate(TEMPLATE, "2026-W53");
  assertStringIncludes(out, 'previous: "[[2026-W52]]"');
  assertStringIncludes(out, 'next: "[[2027-W01]]"');
  assertStringIncludes(out, "### [[2027-01-03]]");
});

test("an unknown Templater expression or format throws", () => {
  assertThrows(() => renderWeeklyTemplate(`${TEMPLATE}<% tp.file.title %>\n`, "2026-W45"));
  assertThrows(() => renderWeeklyTemplate(`${tp("dddd", 0)}\n`, "2026-W45"));
  assertThrows(() => renderWeeklyTemplate(`${TEMPLATE}<% tp.file.title\n`, "2026-W45"));
});

const SCRIPT = join(import.meta.dirname, "create-weekly.ts");

function run(args: string[]): Promise<{ stdout: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(SCRIPT, args, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    proc.stdout.on("data", (chunk) => (stdout += chunk));
    proc.on("error", reject);
    proc.on("close", (code) => resolve({ stdout, code }));
  });
}

async function withVault(fn: (vault: string) => Promise<void>, template?: string) {
  const vault = await mkdtemp(join(tmpdir(), "create-weekly-"));
  try {
    await mkdir(join(vault, "99_Tracking/Weekly"), { recursive: true });
    if (template !== undefined) {
      await mkdir(join(vault, "Templates"), { recursive: true });
      await writeFile(join(vault, "Templates/Weekly_Template.md"), template);
    }
    await fn(vault);
  } finally {
    await rm(vault, { recursive: true, force: true });
  }
}

const notePath = (vault: string) => join(vault, "99_Tracking/Weekly/2026-W45.md");

test("CLI creates the note and prints its path", () =>
  withVault(async (vault) => {
    const r = await run(["2026-W45", vault]);
    assertEquals(r.code, 0);
    assertEquals(r.stdout.trim(), notePath(vault));
    assertEquals(await readFile(notePath(vault), "utf8"), renderWeeklyTemplate(TEMPLATE, "2026-W45"));
  }, TEMPLATE));

test("CLI refuses an existing note and leaves it unchanged", () =>
  withVault(async (vault) => {
    await writeFile(notePath(vault), "hand-written\n");
    const r = await run(["2026-W45", vault]);
    assert(r.code !== 0);
    assertEquals(await readFile(notePath(vault), "utf8"), "hand-written\n");
  }, TEMPLATE));

test("CLI writes nothing when the template has an unknown expression", () =>
  withVault(async (vault) => {
    const r = await run(["2026-W45", vault]);
    assert(r.code !== 0);
    assert(!existsSync(notePath(vault)));
  }, `${TEMPLATE}<% tp.file.title %>\n`));

test("CLI writes nothing when the template is missing", () =>
  withVault(async (vault) => {
    const r = await run(["2026-W45", vault]);
    assert(r.code !== 0);
    assert(!existsSync(notePath(vault)));
  }));

test("CLI rejects a week the year does not have", () =>
  withVault(async (vault) => {
    const r = await run(["2027-W53", vault]);
    assert(r.code !== 0);
    assert(!existsSync(join(vault, "99_Tracking/Weekly/2027-W53.md")));
  }, TEMPLATE));
