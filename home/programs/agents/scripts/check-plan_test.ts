import { assert, assertEquals, assertStringIncludes } from "jsr:@std/assert@1";

import type { Finding } from "./check-plan.ts";

const SCRIPT = new URL("./check-plan.ts", import.meta.url).pathname;

type Outcome = { code: number; stdout: string; stderr: string };

async function runOn(content: string, extra: string[] = []): Promise<Outcome> {
  const dir = await Deno.makeTempDir({ prefix: "check-plan-test-" });
  try {
    const path = `${dir}/plan.md`;
    await Deno.writeTextFile(path, content);
    return await runPath(path, extra);
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

async function runPath(path: string, extra: string[] = []): Promise<Outcome> {
  const out = await new Deno.Command(Deno.execPath(), {
    args: ["run", "--allow-read", SCRIPT, path, ...extra],
    stdout: "piped",
    stderr: "piped",
  }).output();
  return {
    code: out.code,
    stdout: new TextDecoder().decode(out.stdout),
    stderr: new TextDecoder().decode(out.stderr),
  };
}

const RUC_ITEM =
  "- [live] Observe: the dialog opens / Why not autonomous: needs a signed-in browser / Needs: auth, dev server / Your steps: run `pnpm dev` and open http://localhost:3000 / Needed by: final gate";

function plan(opts: {
  sections?: string[];
  av?: string[];
  ruc?: string;
  extra?: string;
}): string {
  const sections = opts.sections ??
    ["## Context", "## Files to Change", "## Task Outline"];
  const av = opts.av ?? [
    "- [file-state] the file exists",
    "- [live] the page renders",
  ];
  const ruc = opts.ruc ?? "- None";
  return [
    "# Title",
    "",
    ...sections.flatMap((s) => [s, "", "text", ""]),
    opts.extra ?? "",
    "## Completion Criteria",
    "",
    "### Autonomous Verification",
    "",
    ...av,
    "",
    "### Requires User Confirmation",
    "",
    ruc,
    "",
    "### Baseline",
    "",
    "- `rg -c foo bar.md` is 0",
    "",
  ].join("\n");
}

Deno.test("a well-formed plan exits 0 with no findings", async () => {
  const r = await runOn(plan({}));
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "0 errors, 0 warnings");
});

Deno.test("missing section, untagged bullet, and bad Needs value are errors", async () => {
  const r = await runOn(plan({
    sections: ["## Context", "## Files to Change"],
    av: ["- the file exists", "- [live] ok"],
    ruc: RUC_ITEM.replace("Needs: auth, dev server", "Needs: none"),
  }));
  assertEquals(r.code, 1);
  assertStringIncludes(
    r.stdout,
    "0:[error] section-missing: ## Task Outline not found",
  );
  assertStringIncludes(r.stdout, "[error] av-tag-missing:");
  assertStringIncludes(r.stdout, "[error] ruc-format: Needs: must list values");
});

Deno.test("no [live] under Autonomous Verification is a warning only", async () => {
  const r = await runOn(plan({ av: ["- [file-state] the file exists"] }));
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "[warn] live-missing:");
  assertStringIncludes(r.stdout, "0 errors, 1 warnings");
});

Deno.test("the item-format section and its fenced template are ignored", async () => {
  const extra = [
    "### Requires User Confirmation item format",
    "",
    "Every item is one bullet:",
    "",
    "```",
    "- [live] Observe: <what> / Why not autonomous: <one line> / Needs: <sudo | auth> / Your steps: <cmd> / Needed by: <task N | final gate>",
    "```",
    "",
  ].join("\n");
  const r = await runOn(plan({ extra, ruc: RUC_ITEM }));
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "0 errors, 0 warnings");
});

Deno.test("--json returns findings with line, severity, rule, message", async () => {
  const r = await runOn(plan({ av: ["- untagged"] }), ["--json"]);
  assertEquals(r.code, 1);
  const findings = JSON.parse(r.stdout) as Finding[];
  assert(Array.isArray(findings) && findings.length > 0);
  const tag = findings.find((f) => f.rule === "av-tag-missing");
  assert(tag !== undefined);
  assertEquals(tag.severity, "error");
});

Deno.test("a missing file or a directory exits 2", async () => {
  const r = await runPath("/nonexistent/plan.md");
  assertEquals(r.code, 2);
  assertStringIncludes(r.stderr, "cannot read");
  const dir = await Deno.makeTempDir({ prefix: "check-plan-test-" });
  try {
    const d = await runPath(dir);
    assertEquals(d.code, 2);
    assertStringIncludes(d.stderr, "directory given");
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
});

Deno.test("trailing whitespace and CRLF do not break whole-line matches", async () => {
  const r = await runOn(plan({ ruc: "- None " }).replace(/\n/g, "\r\n"));
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "0 errors, 0 warnings");
});

Deno.test("continuation lines, a trailing paragraph, and slashes inside Observe are accepted", async () => {
  const ruc = [
    "- [live] Observe: the list shows done / in-flight / next in that order",
    "  and the footer stays visible / Why not autonomous: needs a real device",
    "  / Needs: device | interactive session / Your steps: open the app / Needed by: next real run (the next release)",
    "",
    "※ the release train is monthly.",
  ].join("\n");
  const r = await runOn(plan({ ruc }));
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "0 errors, 0 warnings");
});

Deno.test("`- なし` is not `- None`", async () => {
  const r = await runOn(plan({ ruc: "- なし" }));
  assertEquals(r.code, 1);
  assertStringIncludes(r.stdout, "[error] ruc-format:");
});

Deno.test("bullets inside an indented fence are ignored", async () => {
  const ruc = [
    "- None",
    "",
    "  ```",
    "  - [live] Observe: template / Needs: bogus",
    "  ```",
  ].join("\n");
  const r = await runOn(plan({ ruc }));
  assertEquals(r.code, 0, r.stdout + r.stderr);
  assertStringIncludes(r.stdout, "0 errors, 0 warnings");
});
