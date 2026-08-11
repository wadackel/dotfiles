import { assertEquals, assertStringIncludes } from "jsr:@std/assert";
import {
  denialMessage,
  hasVerdictRule,
  isReviewerAgent,
} from "./reviewer-dispatch-policy.ts";

const SCRIPT =
  new URL("./reviewer-dispatch-policy.ts", import.meta.url).pathname;

async function runHook(
  payload: unknown,
): Promise<{ code: number; stderr: string }> {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--no-prompt", SCRIPT],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode(JSON.stringify(payload)));
  await writer.close();
  const out = await child.output();
  return { code: out.code, stderr: new TextDecoder().decode(out.stderr) };
}

const RULE =
  "VERDICT: [PASS if there are no MUST_FIX and no SHOULD_FIX items (no CRITICAL and no HIGH items for the 4-tier schema), FAIL otherwise]";

const SANTA_LOOP_CONTRACT = `Return JSON:
{
  "verdict": "PASS" | "FAIL",
  "issues": []
}`;

Deno.test("isReviewerAgent matches the reviewers /subagent-review dispatches", () => {
  assertEquals(isReviewerAgent("rust-reviewer"), true);
  assertEquals(isReviewerAgent("typescript-reviewer"), true);
  assertEquals(isReviewerAgent("security-auditor"), true);
  assertEquals(isReviewerAgent("code-reviewer"), true);
  assertEquals(isReviewerAgent("Explore"), false);
  assertEquals(isReviewerAgent("Plan"), false);
  assertEquals(isReviewerAgent("code-simplifier"), false);
  assertEquals(isReviewerAgent(undefined), false);
});

Deno.test("isReviewerAgent leaves other workflows' reviewers alone", () => {
  // These end in -reviewer but belong to other workflows and have no template.
  assertEquals(isReviewerAgent("architect-reviewer"), false);
  assertEquals(isReviewerAgent("skill-guide-reviewer"), false);
});

Deno.test("hasVerdictRule detects the rule regardless of case", () => {
  assertEquals(hasVerdictRule(RULE), true);
  assertEquals(hasVerdictRule("... fail OTHERWISE]"), true);
  assertEquals(
    hasVerdictRule("最終行に VERDICT: PASS または VERDICT: FAIL"),
    false,
  );
  assertEquals(hasVerdictRule(undefined), false);
});

Deno.test("hasVerdictRule accepts the santa-loop JSON contract", () => {
  assertEquals(hasVerdictRule(SANTA_LOOP_CONTRACT), true);
});

Deno.test("denialMessage names the agent and points at the template", () => {
  const msg = denialMessage("rust-reviewer");
  assertStringIncludes(msg, "rust-reviewer");
  assertStringIncludes(msg, "domain-reviewer-prompt.md");
  assertStringIncludes(msg, "how PASS and FAIL are decided");
});

Deno.test("blocks a reviewer dispatch missing the verdict rule", async () => {
  const { code, stderr } = await runHook({
    tool_name: "Agent",
    tool_input: {
      subagent_type: "rust-reviewer",
      prompt:
        "Rust 観点でレビューしてください。最終行に VERDICT: PASS または VERDICT: FAIL",
    },
  });
  assertEquals(code, 2);
  assertStringIncludes(stderr, "reviewer-dispatch-policy");
});

Deno.test("allows a reviewer dispatch carrying the verdict rule", async () => {
  const { code } = await runHook({
    tool_name: "Agent",
    tool_input: {
      subagent_type: "rust-reviewer",
      prompt: `Rust 観点でレビューしてください。\n\n${RULE}`,
    },
  });
  assertEquals(code, 0);
});

Deno.test("allows non-reviewer subagent types", async () => {
  for (const subagent_type of ["Explore", "Plan", "code-simplifier"]) {
    const { code } = await runHook({
      tool_name: "Agent",
      tool_input: { subagent_type, prompt: "no verdict rule here" },
    });
    assertEquals(code, 0, `${subagent_type} should pass through`);
  }
});

Deno.test("ignores tools other than Agent/Task", async () => {
  const { code } = await runHook({
    tool_name: "Bash",
    tool_input: { subagent_type: "rust-reviewer", prompt: "no verdict rule" },
  });
  assertEquals(code, 0);
});

Deno.test("lets a santa-loop code-reviewer dispatch through", async () => {
  const { code } = await runHook({
    tool_name: "Agent",
    tool_input: {
      subagent_type: "code-reviewer",
      prompt: `Review the diff.\n\n${SANTA_LOOP_CONTRACT}`,
    },
  });
  assertEquals(code, 0);
});

Deno.test("lets other workflows' reviewers through", async () => {
  for (const subagent_type of ["architect-reviewer", "skill-guide-reviewer"]) {
    const { code } = await runHook({
      tool_name: "Agent",
      tool_input: { subagent_type, prompt: "no verdict rule here" },
    });
    assertEquals(code, 0, `${subagent_type} should pass through`);
  }
});

Deno.test("fails open on malformed stdin", async () => {
  const cmd = new Deno.Command("deno", {
    args: ["run", "--no-prompt", SCRIPT],
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
  });
  const child = cmd.spawn();
  const writer = child.stdin.getWriter();
  await writer.write(new TextEncoder().encode("not json"));
  await writer.close();
  const out = await child.output();
  // A guardrail must not wedge the workflow when the payload shape changes.
  assertEquals(out.code !== 2, true);
});

Deno.test("applies to the Task tool name as well", async () => {
  const { code } = await runHook({
    tool_name: "Task",
    tool_input: {
      subagent_type: "security-auditor",
      prompt: "no verdict rule",
    },
  });
  assertEquals(code, 2);
});
