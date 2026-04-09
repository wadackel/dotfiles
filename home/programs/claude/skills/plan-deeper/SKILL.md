---
name: plan-deeper
description: Deepens plan quality through iterative adversarial critique, code-level falsification, and user interviews, then defines completion criteria for autonomous execution. Each round spawns a fresh critic subagent to challenge assumptions and identify weaknesses, then interviews the user on items requiring domain knowledge, and refines the plan until convergence. After convergence, an Adversarial Falsification round verifies factual claims against actual code. Finally, establishes a Definition of Done pipeline agreed upon with the user. Plan mode only. Use when asked to "反証して", "深掘り", "計画を深掘りして", "悲観的に評価して", "計画の精度を上げて", "もっと練って", "もう少し練って", "plan deeper", "challenge this plan", "deepen the plan", or when adversarial plan improvement is needed.
argument-hint: "[max-rounds]"
---

# Plan Deeper

Iteratively improves plan quality in Plan mode. Each round spawns a fresh Critic Subagent to critique the plan from an independent, bias-free perspective. Issues requiring user domain knowledge are resolved through interviews. After convergence, an Adversarial Falsification round independently verifies the plan's factual claims against actual code. Finally, establishes a Definition of Done pipeline with the user to enable autonomous execution.

**Plan mode only.** Focused exclusively on plan refinement — does not perform implementation.

## Quick Start

```
/plan-deeper        # Default: max 3 rounds
/plan-deeper 5      # Max 5 rounds
```

## Workflow

### Step 1: Context Collection

1. Retrieve the current plan (from plan file or conversation context)
2. Read the project CLAUDE.md (for codebase alignment reference)
3. Parse `$ARGUMENTS` for max rounds (default: 3, cap: 5)

### Step 2: Critic Subagent (Each Round)

**Spawn a fresh subagent every round.** Continuing the same subagent carries over prior-round context and accumulates confirmation bias.

```
Task:
  subagent_type: "Plan"
  model: "opus"   # Round 1 only. Round 2+ uses "sonnet"
  prompt: [built from references/critic-prompt.md template]
```

**Model selection by round:**
- **Round 1**: `model: "opus"` — Round 1 detects the majority of issues. Investing higher reasoning quality here reduces detection gaps and can lower the total number of rounds needed.
- **Round 2+**: `model: "sonnet"` — Subsequent rounds focus on verifying fixes and finding secondary issues. Sonnet is sufficient for this confirmation role.

Pass to the Critic:
- Full plan text
- Project context (summary of CLAUDE.md)
- Round number
- Deepening Log from prior rounds (if any)

The Critic returns:
- Structured critique across 6 evaluation dimensions
- Critical Issues (must-fix) list
- Improvement Suggestions (should-consider) list
- Verdict: `ITERATE` (continue) or `CONVERGED` (done)

### Step 3: Process Critique, Interview User, Update Plan

Process the Critic's response:

1. Extract Critical Issues and Improvement Suggestions
2. Classify each into one of three categories:
   - **Self-resolvable**: Main agent resolves based on codebase context
   - **Needs user input**: Unverified assumptions, trade-off choices, ambiguous requirements
   - **Reject**: Irrelevant or inapplicable given the actual context
3. If user-input items exist, interview via AskUserQuestion:
   - Unverified assumptions: "Is this assumption correct?"
   - Alternative approaches: "Which approach do you prefer?"
   - Scope questions: "Is this feature in scope?"
   - Ambiguous behavior: "What is the expected behavior here?"
4. Update the plan based on user answers and self-resolutions
5. Append a Deepening Log entry to the plan:

```markdown
## Deepening Log

### Round N
- **Accepted**: [list of changes applied]
- **User Clarified**: [items confirmed with user and their answers]
- **Rejected**: [items rejected and why]
- **Verdict**: ITERATE | CONVERGED
```

**Interview principles:**
- Only ask what the user uniquely knows — skip obvious technical decisions
- Limit to max 4 questions per round (AskUserQuestion constraint)
- Prioritize by impact; defer lower-priority items to next round if needed
- User answers are incorporated into the plan and passed to subsequent Critics
- When presenting interview questions, include a summary of self-resolved items from the same round as a "以下を自己解決しました:" block before the questions. This gives the user an opportunity to flag disagreements with self-resolutions alongside their answers

### Step 4: Convergence Check

Stop when any condition is met:

| Condition | Action |
|---|---|
| Critic verdict is `CONVERGED` | Stop — plan is sufficiently robust |
| Max rounds reached | Stop — report remaining open items |
| Same issues repeat from prior round | Stop — escalate to user |
| Zero Critical Issues | Stop — plan is ready |

If none apply, return to Step 2 with a fresh subagent.

### Step 5: Adversarial Falsification Round

After the standard Critic converges, spawn one final subagent with a fundamentally different mandate: **try to BREAK the plan by finding concrete code-level evidence that specific claims are false.**

This is distinct from the standard Critic (which evaluates quality across dimensions). The Adversarial Falsification agent reads actual code to disprove specific factual claims in the plan.

**When to run:** Always run after convergence, unless the plan contains no verifiable technical claims (e.g., documentation-only changes, renames, comment additions).

Decision criteria:
- Does the plan claim specific code paths, function behaviors, or system interactions?
- Does the plan assert "if X is configured, Y will happen"?
- If neither applies, skip this step.

**Spawn:**

```
Task:
  subagent_type: "Explore"
  prompt: [built from references/adversarial-prompt.md template]
```

Pass to the agent:
- Full plan text
- Project context (CLAUDE.md summary)
- File paths referenced in the plan (the agent reads and explores code independently)

The agent returns findings classified as:
- **Falsified**: A specific claim in the plan is demonstrably wrong (code evidence cited)
- **Unverified**: A claim could not be confirmed — needs runtime/integration testing
- **Verified**: A claim was tested against code and held up (with evidence)
- **Design Questions**: Legitimate alternatives surfaced during investigation

**Processing results:**
1. **Falsified** items → must-fix before implementation (update plan immediately)
2. **Unverified** items → add to plan as explicit risks with mitigation/test strategy
3. **Verified** items → append to Deepening Log as confidence evidence
4. **Design Questions** → add to pending user judgment list (do not interview at this point — deferred to consolidated interview in Step 7)

Append results to Deepening Log:

```markdown
### Round N (Adversarial Falsification)
- **Falsified (CRITICAL)**: [claims disproved with code evidence]
- **Unverified**: [claims that need runtime/integration testing]
- **Verified**: [claims confirmed with evidence]
- **Design Questions**: [alternatives surfaced]
- **Verdict**: CONVERGED | ITERATE
```

If any Falsified items are found, update the plan and mark verdict as `ITERATE`. The main agent applies fixes directly — no additional Critic round is needed (fixes are recorded in the Deepening Log for traceability).

### Step 6: Simplify Review

After Adversarial Falsification confirms the plan is factually correct, check whether the plan is also *minimal*. Each round of critique and falsification can accumulate defensive complexity — extra error handling, speculative abstractions, "just in case" patterns. This step counterbalances that tendency.

**When to run:** Always, unless:
- The plan has 3 or fewer implementation steps (already lean)
- The user explicitly says "skip simplify review" or equivalent

**Execution:**

Run `/simplify-review plan` via the Skill tool. The skill spawns a fresh SubAgent that sees only the plan and the original user request — no knowledge of the design journey. This clean perspective naturally surfaces complexity that feels justified to the author but isn't justified by the requirements.

**Processing results:**

| Verdict | Action |
|---|---|
| `SIMPLIFY` (has proposals) | Triage proposals by confidence (HIGH/MEDIUM/LOW). Apply HIGH-confidence simplifications directly. Add MEDIUM/LOW to pending user judgment list (do not interview at this point — deferred to consolidated interview in Step 7). Update plan and append to Deepening Log |
| `MINIMAL` (already lean) | No changes needed. Record in Deepening Log and proceed |

Append results to Deepening Log:

```markdown
### Simplify Review
- **Auto-applied (HIGH)**: [simplifications applied directly]
- **Pending user judgment (MEDIUM/LOW)**: [proposals deferred to consolidated interview in Step 7]
- **Verdict**: SIMPLIFY | MINIMAL
```

### Step 7: Design Verification Plan

After the plan converges, design what "done" looks like in observable terms. This enables Claude to work through implementation autonomously and verify completion by directly measuring outcomes.

#### 7a. Autonomous Baseline (always executed, no user approval needed)

The following are implicitly executed for every plan. They are **not** presented to the user for approval in this step:
- Implementation complete
- Tests pass (when test files exist)
- Lint / type check pass (when applicable tools exist)
- `/completion-audit`（最終ゲートで1回実行）

**Note:** "Implicit" here means plan-deeper's completion criteria step does not ask the user to approve these. The Plan Execution phase runs `/completion-audit` as the final gate task — it audits whether implementation and verification evidence are sufficient for the plan's purpose.

#### 7b. Design Observable Completion Conditions

Based on the plan's content, design specific observable conditions that prove the implementation is complete. For each change, determine the appropriate verification method (command execution, browser screenshot, environment check, etc.) and specify the exact command or interaction with its expected outcome.

Each condition must be **concrete and plan-specific**. Not "verify CLI works" but "`ofsht add '#33'` creates a worktree and `cd` switches to it".

Classify items as **Requires User Confirmation** when Claude cannot directly execute, observe, or measure the outcome (e.g., subjective evaluation, logout-required settings, next-launch behavior).

#### 7c. User Alignment (always run)

Present the designed observable conditions to the user for alignment. **Always run this step**, even when conditions seem obvious — it prevents expectation mismatches.

**Consolidation with Steps 5-6 pending items:**
If there are pending Design Questions from Step 5 (Adversarial Falsification) or MEDIUM/LOW simplification proposals from Step 6 (Simplify Review), combine them into the same AskUserQuestion to minimize blocking user waits. Omit sections that have no items.

Present in Japanese for the user:

```
question: |
  以下の観測をもって完了と判断します:

  【Adversarial Falsification — Design Questions】(omit section if none)
  - Q1: ...

  【Simplify Review — Proposals】(omit section if none)
  - Proposal 1 (MEDIUM): ...

  【自律検証】
  - `ofsht add '#33'` を実行し、worktree が作成されることを確認
  - failing hook を設定した状態で実行し、warning 表示 + cd 動作を確認

  【自律検証不可（ユーザー確認が必要）】
  - (なし)

  ※ ベースライン（tests, lint）は各タスク内で実行、/completion-audit は最終ゲートで1回実行します
options:
  - "All good"
  - "I have adjustments (will specify)"
```

**Both 【自律検証】 and 【自律検証不可】 are always shown** (show "なし" when empty). This ensures the user can flag misclassified items.

If the user selects "I have adjustments", receive their free-form input and apply corrections.

#### 7d. Write Criteria to Plan

Append a `## Completion Criteria` section to the plan file in English (consumed by task-planner for acceptance criteria and the final completion audit):

```markdown
## Completion Criteria

### Autonomous Verification
Observable conditions that Claude verifies directly:
- [ ] `ofsht add '#33'` → worktree created
- [ ] Run with failing hook → warning displayed + cd works

### Requires User Confirmation
- None

### Baseline (always executed)
tests, lint — executed within each implementation task's acceptance criteria. `/completion-audit` — runs once as the final completion audit gate task
```

Each condition in `### Autonomous Verification` uses checkbox format (`- [ ] command → expected outcome`) — task-planner embeds these as acceptance criteria within implementation tasks, and the completion-auditor checks evidence against them at the final gate.

### Step 8: Result Report

```
## Plan Deepening Complete

**Rounds**: N (convergence reason)
**Critical issues resolved**: X
**Improvements applied**: Y

### Changes Summary
[Major changes made to the plan]

### Remaining Considerations
[Unresolved items or trade-offs, if any]
```

## Evaluation Dimensions

The Critic evaluates the plan across 6 axes. See [references/critic-prompt.md](references/critic-prompt.md) for the full prompt template and dimension definitions. For the Adversarial Falsification prompt, see [references/adversarial-prompt.md](references/adversarial-prompt.md).

| # | Dimension | Focus |
|---|---|---|
| 1 | **Assumption Validity** | Are there unverified assumptions? |
| 2 | **Failure Modes** | What could go wrong? |
| 3 | **Alternative Approaches** | Is there a simpler way? |
| 4 | **Scope Appropriateness** | Over-engineered or under-scoped? |
| 5 | **Implementation Specificity** | Concrete enough to implement without ambiguity? |
| 6 | **Codebase Alignment** | Consistent with existing patterns? |

## Design Decisions

**Why spawn a fresh Plan-type subagent each round:**
Continuing the same subagent carries prior-round context, causing confirmation bias to accumulate. A fresh subagent gives the same effect as an independent reviewer. The read-only "Plan" type is used because the Critic only analyzes — no file writes needed.

**Why default 3 rounds:**
Round 1 detects most major issues, Round 2 verifies fixes and finds secondary issues, Round 3 confirms convergence. Returns diminish after round 3.

**Why append Deepening Log to the plan:**
Visualizes plan evolution for the user, and provides context for subsequent Critics — letting them verify "was the previous round's feedback actually addressed?"

**Why use an Explore subagent for Adversarial Falsification (not Plan):**
Plan-type subagents evaluate plan text analytically but cannot discover what the plan doesn't mention. Adversarial Falsification needs to explore code the plan references — and code it doesn't reference — to find missing prerequisites or incorrect assumptions. Explore subagents use Grep/Glob/Read to actively investigate the codebase. Real-world example: a Plan critic approved a sleep configuration plan, but an Explore-based falsification agent searched other ZMK keyboards' device trees and discovered a missing `wakeup-source` property that would have caused permanent system-off with no wake path.

**Why run Adversarial Falsification after convergence (not during):**
Mixing falsification into the standard Critic rounds dilutes both processes. The Critic's 6-dimension evaluation focuses on plan quality (scope, specificity, alternatives). Falsification focuses on factual correctness ("is this code claim actually true?"). Running them separately lets each agent concentrate on its distinct mandate. The sequencing also ensures the plan is structurally sound before investing in code-level verification.

**Why define and negotiate completion criteria after convergence:**
The plan must be stable before committing to a Definition of Done, or criteria risk being invalidated by subsequent rounds. Autonomous execution also requires explicit user agreement on scope — Claude infers likely stages from plan signals, but the user decides whether "CI pass" or "deployment verification" is actually required.

**Why use Opus for Round 1 and Sonnet for Round 2+:**
Round 1 detects the majority of issues — it sees the plan fresh without prior context. Investing higher reasoning quality (Opus) at this critical first pass reduces detection gaps and can lower the total number of rounds needed for convergence. Round 2+ primarily verify that fixes were applied and catch secondary issues, a confirmation role where Sonnet is sufficient. This balances quality and cost.

**Why consolidate post-convergence user interviews into one:**
Steps 5 (Adversarial Falsification), 6 (Simplify Review), and 7 (Completion Criteria) each potentially require a separate user interview. In practice, the user waits for each subagent to complete, answers questions, then waits again — creating up to 3 sequential blocking waits. By collecting all pending user judgment items from Steps 5-6 and combining them with the Completion Criteria approval in a single AskUserQuestion, the user makes all decisions in one interaction. The auto-resolvable items (Falsified fixes, HIGH simplifications) are still applied immediately without waiting.

## Tips

- Run `/plan-deeper` after writing an initial draft for maximum effectiveness
- Not all Critic issues are valid — the main agent uses conversation context to decide what to accept or reject
- For complex plans, use `/plan-deeper 5` for thorough review
- User interviews are key to accuracy — items requiring domain knowledge are faster and more accurate when asked directly
- Combine with the **qa-planner** skill (Mode A) to proceed from plan deepening straight to test case design
