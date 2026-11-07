#!/usr/bin/env -S bun --no-env-file --no-install --config=/dev/null

import { readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { computeIsoWeekDates, isoWeekOf } from "./iso-week.ts";

const TEMPLATE_PATH = "Templates/Weekly_Template.md";
const WEEKLY_DIR = "99_Tracking/Weekly";
const TP_DATE =
  /<%\s*tp\.date\.now\("([^"]+)",\s*(-?\d+),\s*tp\.file\.title,\s*"YYYY-\[W\]WW"\)\s*%>/g;

/** Templater の週次テンプレートを、指定した ISO 週の値で展開する */
export function renderWeeklyTemplate(
  template: string,
  isoWeek: string,
): string {
  const monday = computeIsoWeekDates(isoWeek).dates[0];
  const out = template.replace(TP_DATE, (_, fmt: string, offset: string) => {
    const d = new Date(`${monday}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + Number(offset));
    const date = d.toISOString().slice(0, 10);
    if (fmt === "YYYY-MM-DD") return date;
    if (fmt === "YYYY-[W]WW") return isoWeekOf(date);
    throw new Error(`unsupported date format in template: ${fmt}`);
  });
  const left = out.indexOf("<%");
  if (left !== -1) {
    throw new Error(
      `unsupported Templater expression: ${out.slice(left, left + 60)}`,
    );
  }
  return out;
}

/** テンプレートから weekly note を作る。既存のノートは上書きしない */
export async function createWeeklyNote(
  { isoWeek, vaultRoot }: { isoWeek: string; vaultRoot: string },
): Promise<string> {
  const template = await readFile(join(vaultRoot, TEMPLATE_PATH), "utf8");
  const content = renderWeeklyTemplate(template, isoWeek);
  const path = join(vaultRoot, WEEKLY_DIR, `${isoWeek}.md`);
  await writeFile(path, content, { flag: "wx" });
  return path;
}

if (import.meta.main) {
  const [isoWeek, vaultRoot = join(homedir(), "Documents/Main")] = process.argv
    .slice(2);
  try {
    console.log(await createWeeklyNote({ isoWeek: isoWeek ?? "", vaultRoot }));
  } catch (e) {
    console.error((e as Error).message);
    process.exit(1);
  }
}
