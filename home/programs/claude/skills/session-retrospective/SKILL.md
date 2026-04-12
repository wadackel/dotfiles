---
name: session-retrospective
description: Review the current session to extract learnings and propose improvements to CLAUDE.md files and skills. Run at the end of a session or when asked to reflect on what was learned. Routes project-specific learnings to the project CLAUDE.md, universal patterns to the global ~/.claude/CLAUDE.md, and repeated workflows to skill creation/modification proposals. Triggers include "retrospective", "session retro", "振り返って", "何を学んだ？", "セッションの学び", "what did we learn?", "improve from this session".
---

# Session Retrospective

Review the current session to extract learnings and propose improvements to CLAUDE.md files and skills, making Claude more autonomous with each session.

## Overview

This skill analyzes the conversation history to identify learnings that should be codified into:
- **Project CLAUDE.md** — Project-specific patterns, commands, and conventions (team-shared, checked into git)
- **Project-local personal CLAUDE.md** (`~/.claude/projects/<hash>/CLAUDE.md`) — Project-specific patterns that are personal (not shared with team via git)
- **Global ~/.claude/CLAUDE.md** — Universal coding styles, Claude behaviors, and cross-project patterns
- **Skills** — Multi-step workflows worth automating (the most valuable output)

Skill proposals are the highest-value output of a retrospective. A single well-designed skill saves more future time than a dozen CLAUDE.md entries. Actively hunt for skill opportunities — do not default to CLAUDE.md when a skill would be more appropriate.

Unlike `/revise-claude-md` which focuses on missing context, this skill provides broader analysis including corrected approaches, skill opportunity detection, and skill improvement opportunities.

## Quick Start

```
/session-retrospective
```

No arguments needed. The skill analyzes the current session context automatically.

## Workflow

### Phase 1: Analyze Session

Gather full session data and reflect on it:

1. **Extract full transcript history** (includes content lost to compaction):
   **Note**: Run from the monorepo root. The script uses `Deno.cwd()` to locate the transcript directory, so running from a sub-package directory will fail to find files.
   ```bash
   cd $(git rev-parse --show-toplevel)
   ~/.claude/skills/session-retrospective/extract-session-history.ts
   ```
   Read the file path printed to stdout using the Read tool.

2. **Build an evidence list** by extracting concrete observations from the transcript. **Do not summarize into categories yet.** For each potential learning, record:

   - **What happened**: 1 sentence summary
   - **Evidence**: direct quote from transcript (1-3 lines) OR turn number OR file path with line number

   Record "at turn 42 the user said 'no, use Y instead' (quote)" — not an abstract "user prefers Y". Abstract summarization happens in Phase 2 while referencing the evidence list.

   While building the list, scan the session as a whole through these lenses (original checklist retained):
   - Tasks performed and their outcomes
   - Errors encountered and how they were resolved
   - Questions asked to the user (signals missing context)
   - User corrections to Claude's approach
   - Repeated patterns of work
   - Tool usage patterns (see Tool Usage Summary section)
   - Compact boundaries (indicate phase transitions within the session)

3. **Git activity** (if in a git repository):
   ```bash
   git log --oneline -20
   git diff --stat HEAD~5..HEAD
   ```

4. **Current context files**:
   - Read project CLAUDE.md (if exists)
   - Read project-local personal CLAUDE.md: `~/.claude/projects/<hash>/CLAUDE.md` (if exists)
   - Read global ~/.claude/CLAUDE.md
   - List existing skills in ~/.claude/skills/

5. **Load existing instincts (for Phase 2 Recurrence Check)**:
   ```bash
   ~/.claude/skills/instinct-learner/scripts/instincts.ts list --min-confidence 0
   ```
   Reference the stdout directly (do not write to an intermediate file). The output is two lines per instinct (id/confidence/domain line + rule body line), so Phase 2's Recurrence Check scans both lines visually.

### Phase 2: Categorize & Diagnose

Classify each learning into categories, then diagnose why it occurred and where it could have been prevented. See [references/learning-categories.md](references/learning-categories.md) for detailed definitions and examples.

**Summary of categories:**

1. **Missing Context** — Information Claude needed but did not have
   - Example: "This project uses pnpm, not npm"
   - Example: "Always run nix flake check before darwin-rebuild"

2. **Corrected Approaches** — User corrections to Claude's behavior
   - Example: "User prefers Japanese commit messages"
   - Example: "Use `gh` for GitHub URLs, not WebFetch"

3. **Repeated Workflows** — Multi-step procedures performed multiple times
   - Example: "Check CI → read logs → fix → push → wait (repeated 3 times)"
   - Example: "Every nix change: edit → nix flake check → darwin-rebuild switch"

4. **Tool/Library Knowledge** — Discoveries about specific tools or APIs
   - Example: "ast-grep requires stopBy: end for relational rules"
   - Example: "Chrome DevTools MCP snapshot should be taken before interaction"

5. **Preference Patterns** — User style or preference observations
   - Example: "User prefers concise output, dislikes verbose explanations"
   - Example: "User wants draft PRs with English descriptions"

**Root Cause & Recurrence Check (always run after categorization):**

Answer three questions for each learning. The answers flow directly into Phase 2.5's scan, Phase 3's routing, and Phase 4's proposal drafting.

1. **Why did this happen?** Pick exactly one:
   - (a) Claude did not know the fact → **knowledge gap**
   - (b) Claude knew but did not apply it → **judgment/trigger gap**
   - (c) The environment allowed the mistake → **enforcement gap**

2. **Which layer could have stopped it earliest?** Pick one Rung from the Enforcement Ladder (`references/routing-logic.md`), **choosing only from Rungs 1-4**. Do NOT evaluate Rung 0 (Skill candidate) at this step — skill-candidate judgment is Phase 2.5's job and is merged into the final routing in Phase 3. If you pick Rung 4 (CLAUDE.md), you must write one line per rejected rung explaining why Rungs 1-3 do not apply.

3. **Has this recurred across sessions?** Visually scan the instinct list loaded in Phase 1 Step 5 (from the stdout of `instincts.ts list`) for matching rules. If a match exists, record the id and confidence. A repeated match is evidence that the previous layer choice was too weak → **lower the Rung number by one (escalate to stronger enforcement)**. Boundary handling:
   - Recurrence at Rung 1 → no escalation available; re-examine the Rung 1 implementation itself (tighten the bash-policy rule, strengthen the hook script's conditions)
   - Recurrence at Rung 4 → escalate to Rung 3 (skill / description fix / reference deepening)

**Notes**:
- Do not introduce a separate `Phase 2.1` sub-heading. This Root Cause & Recurrence Check lives inside Phase 2 as an in-line diagnosis step, preserving the existing Phase 2.5 / 2.6 numbering.
- **Step 2 evaluates only Rungs 1-4**: Rung 0 is deliberately deferred to Phase 2.5 so that Phase 2 → Phase 2.5 → Phase 3 remains linear. At Phase 2 time, the skill-candidate flag is not yet known.
- **Escalation direction**: Lower Rung number = stronger enforcement. "Escalate" always means "decrease the Rung number".

### Phase 2.5: Skill Opportunity Scan

After categorizing learnings, perform a dedicated scan for skill opportunities across ALL categories — not just "Repeated Workflows". See [references/skill-opportunity-detection.md](references/skill-opportunity-detection.md) for the full detection framework.

**For every learning in every category**, apply these quick checks:

1. **The /invoke test**: "Would the user type `/skill-name` for this?"
2. **The orchestration test**: "Does this involve 3+ steps with tool chaining?"
3. **The teaching test**: "Did the user describe a multi-step process?"
4. **The cross-session test**: "Did the user signal this is a recurring task?"
5. **The ecosystem test**: "Does this resemble an existing skill's structure?"
6. **The systematization test**: "Did this session consume external knowledge AND encode it into a reusable tool? (Requires 2+ indicators from Signal 6 in skill-opportunity-detection.md)"

If ANY check passes, flag the learning as a skill candidate and carry it forward to Phase 3 routing with a skill proposal bias.

**Explicit requirement**: Consider at least one skill proposal per retrospective. If no learnings pass the checks above, document why in the results ("No skill opportunities detected because: [reason]"). This forces active evaluation rather than passive defaulting to CLAUDE.md.

**Scan existing skills for modification opportunities**:
```bash
ls ~/.claude/skills/
```
For each skill that was used or relevant to the session, check:
- Was the skill missing information that was discovered during the session?
- Did the workflow deviate from what the skill prescribed?
- Would a new reference file improve the skill?

**Prevention-Layer Failure Analysis** (for the "Corrected Approaches" category):

When a user correction occurs, walk the Enforcement Ladder from the top and ask "which layer could have stopped this earliest?". Route the proposal to the failed layer, not the surface symptom:

- **Rung 1 (Hook / bash-policy)**: Could a Bash-command pattern match have blocked this? → propose a `bash-policy.yaml` rule. For non-Bash behavior, propose a new hook script.
- **Rung 2 (Permissions)**: Should the tool invocation have been denied? → propose a `permissions.deny` entry.
- **Rung 3 (Skill description)**: Did a relevant skill exist but fail to auto-load because of missing trigger phrases? → propose a skill description fix.
- **Rung 3 (Skill content)**: Did the skill load but lack sufficient guidance? → propose reference deepening.
- **Rung 4 (CLAUDE.md)**: Only when none of the above applies.

**Route the proposal to the failed layer, not to the symptom.** A description gap must not be flattened into a CLAUDE.md line addition.

#### Generalization Check

For each identified learning, also ask:
> "Is this specific to a narrow context (tool X, environment Y, one-off situation Z),
> or does it reflect a **broader methodological/behavioral principle**?"

- **If broader principle exists**: Document the **general principle** as the primary entry.
  Include the specific instance as a concrete example, not as the title/framing.
  Route to `~/.claude/CLAUDE.md` with the general principle.

- **If genuinely narrow**: Keep specific, but flag it:
  "Does this narrow symptom suggest a general principle that was missed?"

**Anti-pattern to avoid (from real sessions):**
- ✗ Extracted: "non-interactive environment debugging tip" (env-specific framing)
- ✓ Should extract: "investigation plans must include direct observation means" (general principle)
  with "non-interactive env" as one concrete example

- ✗ Extracted: "git diff in shallow clone returns incorrect results" (tool-specific fact)
- ✓ Should extract: "verify output value correctness, not just error absence" (general principle)
  with "git diff returned 16 packages instead of expected 3" as a concrete example

**Artifact Pipeline Check**: Beyond generalizing facts, also ask:
> "Did this session produce a reusable artifact? If so, is the *artifact-creation pipeline* itself generalizable across domains?"

If yes, recommend the appropriate mechanism using this routing:

```
Is the methodology a repeatable workflow the user would invoke by name?
  YES → Skill (standard). Use skill-creator to build it.
  NO → Is it background knowledge that should always be available?
    YES → Skill (user-invocable: false, Reference content).
    NO → Does it need constrained tool access (read-only analysis)?
      YES → Custom Agent (agents/*.md). Use context: fork + agent: from skills.
      NO → Does it augment an existing skill's evaluation criteria?
        YES → Reference file in existing skill's references/.
        NO → Skill (standard) as default. Most flexible option.
```

Default to Skill (standard) when uncertain — it matches the user's preference for skill-based workflows.

**Example:**
- Artifact: Evaluation agent derived from Anthropic PDF (specific instance)
- Pipeline: "Methodology document → extract criteria → create evaluation tool" (generalizable)
- Recommended: Skill (standard) — e.g., `/review-accessibility [url]`
- Alternative: Custom Agent if read-only constraint is needed

### Phase 2.6: Instinct Extraction

For learnings categorized as **Corrected Approaches** and **Repeated Workflows** in Phase 2:

Re-consult the instinct list loaded in Phase 1 Step 5 before deciding `add` vs `reinforce` for each learning.

1. Register learnings that passed the Generalization Check as instincts
2. Execute automatically without confirmation (as part of the retrospective)
3. Include instincts that reach the promotion threshold (confidence >= 0.7) in Phase 4 CLAUDE.md proposals

```bash
# Add new instinct (for each learning)
~/.claude/skills/instinct-learner/scripts/instincts.ts add \
  --rule "generalized rule statement" \
  --domain "verification|workflow|code-style|debugging|git" \
  --session "$(cat /tmp/claude-session-id 2>/dev/null || echo unknown)"

# Reinforce if matching existing instinct
~/.claude/skills/instinct-learner/scripts/instincts.ts reinforce <id>

# Check promotion candidates for Phase 4 proposals
~/.claude/skills/instinct-learner/scripts/instincts.ts promote
```

**Note**: Learnings in the Missing Context and Tool/Library Knowledge categories are routed directly to CLAUDE.md proposals (not instincts), as these are factual information that does not need confidence accumulation across sessions.

### Phase 3: Route Proposals

Merge the Rung 1-4 selected in Phase 2's Root Cause Check with the skill-candidate flag produced by Phase 2.5's Skill Opportunity Scan to determine the final routing. See [references/routing-logic.md](references/routing-logic.md) for the full Enforcement Layer Ladder and detailed sub-routing criteria.

**Final rung decision logic**:

1. If Phase 2.5 flagged the learning as a skill candidate → final rung is **Rung 3** (Rung 0 precedence fires).
2. Otherwise → use the Rung 1-4 chosen in Phase 2's Root Cause & Recurrence Check.

**Ladder quick reference** (smaller rung number = stronger enforcement):

- **Rung 1**: Hook / bash-policy (deterministic enforcement, no Claude judgment required)
- **Rung 2**: Permissions (structural tool-access restriction)
- **Rung 3**: Skill creation / description fix / reference deepening
  - Sub-priority: description fix → reference deepening → new skill creation
  - Detailed skill-proposal criteria (`/invoke` litmus, Conditions A-E, weak-justification exclusion) live in `references/routing-logic.md` under "Rules for Skill Proposals"
- **Rung 4**: CLAUDE.md (weakest layer; Rung 1-3 rejection rationale required)
  - Rung 4 internal sub-routing (Project-Specific vs Universal, Team vs Personal) lives in `references/routing-logic.md` under "Rules for Determining Project-Specific vs Universal"

**Skill opportunity identification criteria** (used by Phase 2.5 to decide whether to set the skill-candidate flag):

- Complex workflow (4+ steps with tool orchestration)
- User-taught multi-step process
- Cross-session repetition signal
- Tool orchestration pattern
- Knowledge systematization (external doc → reusable tool)

### Phase 4: Draft Proposals

For each routed learning, draft a concrete proposal:

**Falsification Gate (run BEFORE the Abstraction Test):**

For each proposal, write all three of the following. **Abstract hypotheticals are not allowed**:

1. **Two concrete counter-examples**: scenarios where following this rule would be wrong or wasteful. Each counter-example must cite a direct transcript quote, a file path, or a specific observed past-session event. Hypotheticals like "if X is ever needed in the future" do not count as counter-examples.
2. **One failure mode**: a concrete way this proposal could actively harm a future session (over-triggering, masking a real bug, locking in a premature decision).
3. **Escape hatch**: one sentence describing the condition under which Claude should ignore this rule.

If you cannot write all three with concrete citations, the proposal is underspecified — sharpen it or discard it. Vague proposals that pass because no one could think of counter-examples are the single biggest source of CLAUDE.md bloat.

**Before finalizing each proposal, apply the Abstraction Test:**

> "If I replaced the specific tool/context with a different one, would this rule still be useful?"

- YES → The proposal is at the right abstraction level
- NO → Extract the underlying principle. The specific instance becomes an example, not the rule

**Anti-patterns (from real sessions):**
- ✗ "In shallow clone, use refs/pull/N/merge instead of 2-dot git diff" → tool-specific fact
- ✓ "Output value verification: check value correctness, not just error absence" → general principle
- ✗ "Set execSync maxBuffer to 10MB" → one-off fix
- ✓ "Evidence over analysis: trust concrete evidence over reasoning when they conflict" → behavioral principle

**CLAUDE.md additions:**
- Format: One line per concept (consistent with `/revise-claude-md`)
- Show exact placement (after which section heading)
- Use diff format for clarity
- Example:
  ```diff
  ## Development Commands
  + nix flake check - Validate Nix syntax before applying changes
  ```

**New skill proposals** (use template from [references/skill-opportunity-detection.md](references/skill-opportunity-detection.md)):
- Proposed name and invocation example
- When to use (trigger scenario)
- **Why-not-CLAUDE.md justification** (mandatory — why this needs to be a skill)
- Workflow outline (numbered steps with tools used)
- Parameters (what would be parameterized)
- Similar existing skill (for calibration)
- Estimated complexity (Simple / Medium / Complex)

A skill proposal without a why-not-CLAUDE.md justification is incomplete.

**Skill modification proposals:**
- Show before/after diff of changes
- Explain rationale for the modification
- Example:
  ```diff
  ## Quick Start

  - curl -s https://api.example.com/health
  + curl -sf https://api.example.com/health - Add -f flag to fail on HTTP errors
  ```

### Phase 5: Present and Apply

Present all proposals grouped by target:

```
## Session Retrospective Results

### Project CLAUDE.md Proposals (N items)
[numbered proposals with diffs]

### Project-local Personal CLAUDE.md Proposals (N items)
[numbered proposals with diffs]

### Global CLAUDE.md Proposals (N items)
[numbered proposals with diffs]

### Skill Proposals (N items)
[new skills and modifications]

---
Which proposals would you like to apply?
(all / specific numbers like 1,3,5 / none)
```

**After user approval:**
- Apply CLAUDE.md changes with Edit tool
- Create new skills (use skill-creator toolchain or direct file creation)
- Apply skill modifications with Edit tool
- Report what was applied

## Guidelines

### What NOT to Propose

- Information Claude already knows (well-known concepts, standard library usage)
- Temporary or one-off decisions that don't generalize
- Information already present in the target CLAUDE.md or skill
- Overly specific instructions that reduce flexibility

### Proposal Quality

- Each proposal should be actionable (specific text to add, not vague suggestions)
- Each proposal should justify its token cost (high signal-to-noise ratio)
- Prefer additions that prevent future mistakes over documenting facts
- Keep proposals concise — one line per concept for CLAUDE.md entries

### Respecting Existing Content

- Read existing CLAUDE.md files before proposing additions
- Do not duplicate existing entries
- Match the style and language of the existing file (Japanese or English)
- Place additions in the appropriate section (do not append everything at the end)

### Language Matching

When proposing CLAUDE.md additions:
- Detect the primary language of the target file
- Write proposals in that language
- For mixed-language files, match the language of the relevant section

## Related Skills

- **/revise-claude-md** — Focused CLAUDE.md updates based on missing context (narrower scope)
- **skill-improver** — Evaluates and improves existing skill quality
- **skill-creator** — Creates new skills from scratch
- **skill-tester** — Validates skill behavior after modifications
