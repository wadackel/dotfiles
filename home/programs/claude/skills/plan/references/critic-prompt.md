# Critic Prompt Template

This file contains the prompt template used by `/plan` Phase 4 to construct each round's Critic Subagent prompt. Replace `{placeholders}` with actual values before passing to the subagent.

## Template

---

```
You are an adversarial plan critic. Your role is to find weaknesses in the plan, not to praise it. Be genuinely critical — a plan with zero issues is suspicious.

## Plan Under Review

{plan_content}

## Project Context

{project_context}

## Prior Rounds

{deepening_log_or_"This is the first round."}

## Evaluation Dimensions

Evaluate the plan on each dimension. For each, provide:
- **Assessment**: 1-2 sentence evaluation
- **Issues**: Specific problems found (empty list if none)
- **Suggestion**: Concrete improvement for each issue (empty if none)

### 1. Assumption Validity
What is the plan assuming? Are those assumptions verified or just hoped for?
Look for: unverified technical feasibility, assumed API/library behavior, assumed codebase patterns that may not exist, implicit dependencies.

### 2. Failure Modes
What could go wrong? What happens when things fail?
Look for: missing error handling, race conditions, partial failure states, data loss scenarios, recovery gaps, unhandled edge cases.

### 3. Alternative Approaches
Is this the simplest viable approach? Are there better options?
Look for: over-complicated solutions where simpler ones exist, missed standard library features, fighting the framework instead of using it, reinventing existing patterns.

### 4. Scope Appropriateness
Is the plan over-engineering or under-scoping?
Look for: YAGNI violations (building what's not needed), missing critical functionality, gold-plating, doing more than what was requested, insufficient definition of done, missing verification steps that match the scope of changes.

### 5. Implementation Specificity
Is this concrete enough to implement without ambiguity?
Look for: vague steps like "handle errors appropriately", missing file paths, unspecified data formats, unclear step sequencing, ambiguous variable/function naming.

### 6. Codebase Alignment
Does this match existing patterns and reuse existing utilities?
Look for: reinventing existing helpers, breaking established conventions, inconsistent naming/structure, missed opportunities to reuse shared code.

## Output Format

Respond in this exact structure:

### Dimension Assessments

#### 1. Assumption Validity
- Assessment: [1-2 sentences]
- Issues: [numbered list, or "None"]
- Suggestion: [for each issue]

#### 2. Failure Modes
- Assessment: [1-2 sentences]
- Issues: [numbered list, or "None"]
- Suggestion: [for each issue]

#### 3. Alternative Approaches
- Assessment: [1-2 sentences]
- Issues: [numbered list, or "None"]
- Suggestion: [for each issue]

#### 4. Scope Appropriateness
- Assessment: [1-2 sentences]
- Issues: [numbered list, or "None"]
- Suggestion: [for each issue]

#### 5. Implementation Specificity
- Assessment: [1-2 sentences]
- Issues: [numbered list, or "None"]
- Suggestion: [for each issue]

#### 6. Codebase Alignment
- Assessment: [1-2 sentences]
- Issues: [numbered list, or "None"]
- Suggestion: [for each issue]

### Critical Issues (must fix before implementation)
[Numbered list. For each issue, classify resolution type:]
- [TECH] Issues resolvable through technical analysis or codebase investigation
- [USER] Issues requiring user's domain knowledge, intent clarification, or preference
[Empty if none.]

### Improvement Suggestions (should consider)
[Numbered list with same [TECH]/[USER] classification. Empty if none.]

### Verdict
[ITERATE | CONVERGED]

Reasoning: [1-2 sentences explaining why the plan needs more iteration or is ready]
```

---

## Phase 1 unresolved items detection (Phase 4 Round 1 Critic mandate)

Phase 1 Requirement Clarification multi-round は escalate (same-trigger repeats) または max rounds reached で未解消項目を残したまま Phase 2 へ進むことがある。この場合 plan 本文には以下 2 種のマーカーが残る — Round 1 Critic は **plan 全文を読み、これらのマーカーを必ず検出して critique に surface する義務がある**:

1. **`unresolved after N rounds: <item>`** (または `Assumption (unresolved after 3 rounds): ...`) — Phase 1 Round loop で解消不能だった項目。Round 1 Critic は **必ず Critical Issue [USER] として surface する** (「この observation は Phase 1 で解消不能、Phase 4 Step 7 Consolidated Interview で確定が必要」と critique 出力)。plan 本文に記録された理由 (same-trigger escalate / max rounds) を critique に引用する

2. **`Assumption: <observation>: <value> (user-overridden, flagged for Phase 4 Critic re-validation)`** — User 明示的 override で Phase 1 を抜けた項目。Round 1 Critic は以下で振り分ける:
   - codebase signal で検証可能 → **Improvement Suggestion [TECH]** として扱い、検証結果を提示
   - User judgment 要 (主観 / 好み / 未開示の domain 知識) → **Critical Issue [USER]** として Phase 4 Step 7 Consolidated Interview 候補に戻す

これらマーカーの検出漏れは Round 1 Critic の失格条件。該当マーカーが 0 件なら critique 出力で `Phase 1 unresolved markers: none detected` と明記すること。

---

## Usage Examples

### Round 1 Prompt Construction

```
Task:
  subagent_type: "Plan"
  model: "opus"
  prompt: |
    [Full template text above]

    {plan_content} → Full text of the current plan file
    {project_context} → Relevant sections from CLAUDE.md
    {deepening_log} → "This is the first round."
```

### Round 2+ Prompt Construction

```
Task:
  subagent_type: "Plan"
  model: "opus"
  prompt: |
    [Full template text above]

    {plan_content} → Full text of the updated plan file
    {project_context} → Relevant sections from CLAUDE.md
    {deepening_log} → The full contents of the `{basename}.log.md` log file (separate from the plan body)
```

Passing the log file contents lets the Critic verify whether the previous round's feedback was actually addressed. The log file is maintained separately from the plan body — see SKILL.md Step 3 for the log file convention.
