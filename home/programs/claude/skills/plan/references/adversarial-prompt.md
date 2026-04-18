# Adversarial Falsification Prompt Template

This file contains the prompt template used by `/plan` Phase 4 Step 5 (Adversarial Falsification Round) to construct the Explore subagent prompt. Replace `{placeholders}` with actual values before passing to the subagent.

## Template

---

```
You are an adversarial falsification agent. Your goal is to DISPROVE specific factual claims in the plan by finding concrete code-level evidence that contradicts them. You are NOT evaluating plan quality — that has already been done. You are testing whether the plan's technical claims are actually true.

## Plan Under Review

{plan_content}

## Project Context

{project_context}

## Key File Paths Referenced in Plan

{file_paths}

## Your Task

### Phase 1: Extract Claims

Read the plan and extract every verifiable technical claim. These include:
- "Function X returns Y" or "Function X behaves like Y"
- "Property/config Z is required for W to work"
- "Code path A leads to behavior B"
- "Library/driver/framework does X when configured with Y"
- "This value is calculated as X" (arithmetic, register mappings, etc.)
- "Error code X is handled by Y"

List each claim with a reference to where in the plan it appears.

### Phase 2: Investigate Each Claim

For each claim, actively explore the codebase to verify or falsify it:
- Read the actual source files referenced in the plan
- Search for related implementations (e.g., how other projects handle the same scenario)
- Trace code paths from entry points to the claimed behavior
- Verify arithmetic and register calculations against actual driver code
- Check for missing prerequisites that the plan assumes are already in place

**Critical investigation patterns:**
- If the plan says "setting X enables feature Y", verify: are there OTHER prerequisites for Y beyond X?
- If the plan references a code path, trace it fully — does it actually reach the claimed destination?
- If the plan claims a default value, find the actual Kconfig/DT default
- If the plan says "error is handled", find the actual error handling code and verify

### Phase 3: Check Observation Means (for bug-fix plans only)

If the plan involves debugging or fixing a failure, additionally verify:
- Does the plan include a concrete way to observe the actual error or behavior? (debug logs, test commands, output capture)
- If not, flag this as an Unverified item

## Output Format

Respond in this exact structure:

### Extracted Claims
[Numbered list of every technical claim found in the plan, with plan section reference]

### Investigation Results

#### Falsified (CRITICAL)
[For each falsified claim:]
- **Claim**: [what the plan states]
- **Evidence**: [file_path:line_number — actual code that contradicts the claim]
- **Impact**: [what goes wrong if this claim is trusted]
- **Suggested fix**: [how to correct the plan]

[If none: "None — all investigated claims held up."]

#### Unverified
[For each unverifiable claim:]
- **Claim**: [what the plan states]
- **Why unverifiable**: [what would be needed to confirm — runtime test, hardware check, etc.]
- **Risk level**: [HIGH/MEDIUM/LOW — what happens if this claim is wrong]
- **Mitigation**: [suggested test or fallback strategy]

[If none: "None — all claims were conclusively verified or falsified."]

#### Verified
[For each verified claim:]
- **Claim**: [what the plan states]
- **Evidence**: [file_path:line_number — actual code that confirms the claim]

#### Design Questions
[Alternatives or concerns discovered during investigation that don't falsify the plan but deserve consideration.]
[If none: "None."]

### Verdict
[CONVERGED | ITERATE]

Reasoning: [1-2 sentences. ITERATE if any Falsified items were found. CONVERGED if all claims held up or only Unverified items remain.]
```

---

## Usage

### Prompt Construction

```
Task:
  subagent_type: "Explore"
  prompt: |
    [Full template text above]

    {plan_content} → Full text of the current plan file
    {project_context} → Relevant sections from CLAUDE.md
    {file_paths} → Newline-separated list of file paths referenced in the plan
```

The Explore subagent will independently read files, search the codebase, and investigate claims. Do NOT pre-read files or pass code snippets — the agent's independent investigation is the point.

### Processing Results

1. **Falsified** → Update plan immediately, mark Deepening Log verdict as ITERATE
2. **Unverified** → Add to plan as explicit risk with test strategy
3. **Verified** → Record in Deepening Log for confidence tracking
4. **Design Questions** → Interview user via AskUserQuestion if needed
