import { test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assert } from "@std/assert";

// The 2026-09-16 rebuild of /plan and /impl grew about 2.5x in eight weeks, one
// prose fix per observed failure. A budget makes each growth a decision: raise it
// here, in the same commit, with the failure (session id) the addition answers.
// 1700 -> 2100: /do gained the breaker prompt after greenline session 1280802c,
// where reading reviewers passed two gaps only the breaker of /impl's run found.
// 2100 -> 2250: the Why / Binds / Hits file, after greenline session d07598af
// proposed an opt-out key where an existing parser rejects unknown keys.
const BUDGETS: Record<string, number> = {
  "home/programs/claude/skills/do": 2250,
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
