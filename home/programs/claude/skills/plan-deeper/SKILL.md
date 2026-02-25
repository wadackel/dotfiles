---
name: plan-deeper
description: Deepens plan quality through iterative adversarial critique and user interviews, then defines completion criteria for autonomous execution. Each round spawns a fresh critic subagent to challenge assumptions and identify weaknesses, then interviews the user on items requiring domain knowledge, and refines the plan until convergence. Finally, establishes a Definition of Done pipeline agreed upon with the user. Plan mode only. Use when asked to "反証して", "深掘り", "計画を深掘りして", "悲観的に評価して", "計画の精度を上げて", "もっと練って", "もう少し練って", "plan deeper", "challenge this plan", "deepen the plan", or when adversarial plan improvement is needed.
argument-hint: "[max-rounds]"
---

# Plan Deeper

Iteratively improves plan quality in Plan mode. Each round spawns a fresh Critic Subagent to critique the plan from an independent, bias-free perspective. Issues requiring user domain knowledge are resolved through interviews. After convergence, establishes a Definition of Done pipeline with the user to enable autonomous execution.

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

### Step 4.5: Investigation & Falsification Check

Before defining completion criteria, verify the plan addresses:

1. **Direct observation means** (if the plan involves debugging or fixing a failure)
   - Is there a concrete way to observe the actual error or behavior?
   - Examples: enabling debug logs, running a test command, capturing output
   - If missing: add it to the plan before continuing

2. **Falsification of the fix direction** (if a specific fix approach is proposed)
   - Explicitly ask: "Why could this approach be wrong?"
   - If no counter-argument applies: document "considered and ruled out"
   - If counter-arguments exist: address them in the plan

Skip this step only if the plan has no failure investigation or fix component
(e.g., pure feature additions, documentation changes).

### Step 5: Define Completion Criteria

After the plan converges, define what "done" looks like. This enables Claude to work through implementation autonomously without repeatedly asking "what should I do next?"

#### 5a. Analyze Plan for Stage Signals

Scan the finalized plan and infer which completion stages are appropriate:

| Signal in Plan | Implied Stage |
|---|---|
| Code changes described | **Implementation** |
| Test files, test commands, "add tests" | **Lightweight Verification** (tests, lint) |
| UI/visual/browser changes | **Manual Verification** (visual check) |
| API endpoints, request/response changes | **Manual Verification** (API testing) |
| Branch management, "create PR" | **PR** |
| CI pipeline, GitHub Actions referenced | **CI Pass** |
| Deployment targets, production URLs | **Deployment Verification** |

Build a candidate pipeline as an ordered sequence. "User Review" is always the final stage unless a PR+merge is the terminal action.

#### 5b. Interview User for Approval

Present the inferred pipeline via AskUserQuestion:

```
question: |
  Based on the plan, I've inferred this completion pipeline:

  1. Implementation complete
  2. Lightweight verification (run tests + lint)
  3. User review

  Does this look right?
options:
  - "Looks good"
  - "Simpler (fewer stages)"
  - "More thorough (add PR/CI)"
  - "Let me specify"
```

Adapt the pipeline based on the user's response. Ask at most one follow-up question for stage-specific details (e.g., which test command, which URL to verify).

#### 5c. Write Criteria to Plan

Append a `## Completion Criteria` section to the plan file:

```markdown
## Completion Criteria

Definition of Done for this task. Each stage must pass before proceeding to the next.

### Pipeline

- [ ] **Implementation** — [specific description of what "implemented" means for this plan]
- [ ] **Lightweight Verification** — [specific commands, e.g., `npm test && npm run lint`]
- [ ] **Manual Verification** — [specific check, e.g., "open /settings, confirm toggle renders and saves"]
- [ ] **User Review** — Present changes summary for final approval

### Notes
- [Prerequisites, ordering constraints, or caveats specific to this plan]
```

Each stage description must be **concrete and plan-specific**. Never write generic placeholders like "tests pass" — specify which test command, which URL, which behavior to verify.

### Step 6: Result Report

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

The Critic evaluates the plan across 6 axes. See [references/critic-prompt.md](references/critic-prompt.md) for the full prompt template and dimension definitions.

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

**Why define and negotiate completion criteria after convergence:**
The plan must be stable before committing to a Definition of Done, or criteria risk being invalidated by subsequent rounds. Autonomous execution also requires explicit user agreement on scope — Claude infers likely stages from plan signals, but the user decides whether "CI pass" or "deployment verification" is actually required.

## Tips

- Run `/plan-deeper` after writing an initial draft for maximum effectiveness
- Not all Critic issues are valid — the main agent uses conversation context to decide what to accept or reject
- For complex plans, use `/plan-deeper 5` for thorough review
- User interviews are key to accuracy — items requiring domain knowledge are faster and more accurate when asked directly
- Combine with the **qa-planner** skill (Mode A) to proceed from plan deepening straight to test case design
