import { test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert } from "@std/assert";

// The 2026-09-16 rebuild of /plan and /impl grew about 2.5x in eight weeks, one
// prose fix per observed failure. A budget makes each growth a decision: raise it
// here, in the same commit, with the failure (session id) the addition answers.
const BUDGETS: Record<string, number> = {
  // 2250 -> 3050: routes sized to what can go wrong, the pass over Hits and the
  // reviewer's conditions, after background-session evaluations (2026-11-13 to 15)
  // where a shared component was checked by its story alone, callers a type checker
  // cannot see stayed unchanged, and a one-expression replacement opened nine screens.
  // 3050 -> 3200: the question bullets name the forms that were asked back in 50
  // /plan, /impl and /do questions from 10-17 to 11-15 (options as words only, no
  // plain problem, labels coined mid-work), e.g. sessions 7faee790, f8d3c40b, c38512a1.
  // 3200 -> 3260: security-auditor's own Task paragraph. With one sentence swapped, 5 of
  // the 18 findings it shared with code-reviewer (11-13 to 19) were stale words and
  // unrecorded departures, e.g. sessions 423b48ee, 1857e656, 9e5f038b.
  "home/programs/claude/skills/do": 3260,
};

const root = join(import.meta.dirname, "../../../..");

const markdownFiles = (dir: string): string[] =>
  readdirSync(dir, { recursive: true, encoding: "utf8" })
    .filter((path) => path.endsWith(".md"))
    .map((path) => join(dir, path));

for (const [dir, budget] of Object.entries(BUDGETS)) {
  test(`${dir} stays within ${budget} words`, () => {
    const words = markdownFiles(join(root, dir))
      .map((file) =>
        readFileSync(file, "utf8").split(/\s+/).filter(Boolean).length
      )
      .reduce((sum, n) => sum + n, 0);
    assert(
      words <= budget,
      `${dir} has ${words} words, over its budget of ${budget}`,
    );
  });
}
