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
  model: "sonnet"
  prompt: [built from references/critic-prompt.md template]
```

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
4. **Design Questions** → interview user if needed

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

### Step 6: Define Completion Criteria

After the plan converges, define what "done" looks like. This enables Claude to work through implementation autonomously without repeatedly asking "what should I do next?"

#### 6a. Analyze Plan for Stage Signals

Scan the finalized plan and infer which completion stages are appropriate:

| Signal in Plan | Implied Stage |
|---|---|
| Code changes described | **Implementation** |
| Test files, test commands, "add tests" | **Lightweight Verification** (tests, lint) |
| UI/visual/browser changes | **Manual Verification** (visual check) |
| API endpoints, request/response changes | **Manual Verification** (API testing) |
| CLI behavior changes, command output changes | **Manual Verification** (CLI smoke test) |
| Plan has a "Verification" or "Manual Testing" section | **Manual Verification** (execute those steps) |
| Branch management, "create PR" | **PR** |
| CI pipeline, GitHub Actions referenced | **CI Pass** |
| Deployment targets, production URLs | **Deployment Verification** |
| Any implementation task | **Final Verification** (`/verification-before-completion`) |

Build a candidate pipeline as an ordered sequence. "User Review" is always the final stage unless a PR+merge is the terminal action.

#### 6b. Interview User for Approval

Present the inferred pipeline via AskUserQuestion:

Present the **actually inferred** pipeline (not a fixed template). The example below includes Manual Verification — include or omit stages based on what 6a actually inferred:

```
question: |
  Based on the plan, I've inferred this completion pipeline:

  1. Implementation complete
  2. Lightweight verification (cargo test + just check)
  3. Manual verification (run `ofsht add` with failing hook, confirm warning + cd works)
  4. Final verification (/verification-before-completion)

  Does this look right?
options:
  - "Looks good"
  - "Simpler (fewer stages)"
  - "More thorough (add PR/CI)"
  - "Let me specify"
```

**Important**: Always present what 6a inferred — do not fall back to a minimal default pipeline. If 6a inferred Manual Verification, it must appear in this question.

Adapt the pipeline based on the user's response. Ask at most one follow-up question for stage-specific details (e.g., which test command, which URL to verify).

#### 6c. Write Criteria to Plan

Append a `## Completion Criteria` section to the plan file:

```markdown
## Completion Criteria

Definition of Done for this task. Each stage must pass before proceeding to the next.

### Pipeline

- [ ] **Implementation** — [specific description of what "implemented" means for this plan]
- [ ] **Lightweight Verification** — [specific commands, e.g., `npm test && npm run lint`]
- [ ] **Manual Verification** — [specific check, e.g., "open /settings, confirm toggle renders and saves"]
- [ ] **Final Verification** — Run `/verification-before-completion` Gate Function against all completion claims
- [ ] **User Review** — Present changes summary for final approval

### Notes
- [Prerequisites, ordering constraints, or caveats specific to this plan]
```

Each stage description must be **concrete and plan-specific**. Never write generic placeholders like "tests pass" — specify which test command, which URL, which behavior to verify.

### Step 7: Result Report

```
## Plan Deepening Complete

**Rounds**: N (convergence reason)
**Critical issues resolved**: X
**Improvements applied**: Y

### Changes Summary
[Major changes made to the plan]

### Completion Criteria
[Summary of the agreed pipeline, e.g.:]
Implementation → Lightweight Verification (tests + lint) → Manual Verification → User Review

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

## Tips

- Run `/plan-deeper` after writing an initial draft for maximum effectiveness
- Not all Critic issues are valid — the main agent uses conversation context to decide what to accept or reject
- For complex plans, use `/plan-deeper 5` for thorough review
- User interviews are key to accuracy — items requiring domain knowledge are faster and more accurate when asked directly
- Combine with the **qa-planner** skill (Mode A) to proceed from plan deepening straight to test case design
