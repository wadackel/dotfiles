# Routing Logic

This document provides the complete decision tree for routing session learnings to the appropriate target: project CLAUDE.md, global ~/.claude/CLAUDE.md, or skill proposals.

## Mechanism-Signature Pre-routing

Before running the Enforcement Layer Ladder below, run the 4-question pre-routing in [mechanism-signature.md](mechanism-signature.md). That heuristic narrows the starting Rung so Phase 3 Pair Design does not default to Rung 4 (CLAUDE.md) by reflex.

The Ladder still runs after pre-routing to confirm the choice. Pre-routing only decides **where to start**; the Ladder decides **where to land**.

**Archetype bias** (from [learning-categories.md](learning-categories.md)):

- Behavioral correction → Rung 1 (hook) or Rung 2 (permissions)
- Workflow candidate → Rung 3 (skill)
- Discovered fact → Rung 4 (claude_md), only if strengthened bar passes

This is a starting hint, not a verdict. The Ladder overrides when mechanism-signature signals otherwise.

## Enforcement Layer Ladder

For each learning, walk down this ladder and stop at the **first rung that applies**. Higher rungs rely less on Claude's judgment and enforce the rule more strongly.

**Meaning of rung numbers**: Rung 1 is the strongest (deterministic enforcement by the harness). Rung 4 is the weakest (depends on Claude reading and voluntarily following a written rule). "Escalate" always means "decrease the rung number" (e.g., Rung 4 → Rung 3).

**Rung 0: SKILL CANDIDATE PRECEDENCE** (set by Phase 2 Extract & Drill archetype = Workflow candidate, consumed in Phase 3 Pair Design)
  If Phase 2 classified the learning as a Workflow candidate (via the Signals 1-6 in `skill-opportunity-detection.md`), Phase 3 Pair Design starts at Rung 3 as the default target (skipping Rungs 1-2). This precedence preserves the anti-bias mechanism: evaluating skill candidates before CLAUDE.md prevents the "path of least resistance" bias toward CLAUDE.md.
  Other archetypes (Behavioral correction / Discovered fact) enter Phase 3 without the Rung 0 flag and walk the ladder from the mechanism-signature pre-routing starting rung.

**Rung 1: DETERMINISTIC ENFORCEMENT (Hook / Policy)**
  When to use: the behavior is deterministic and the harness can enforce it without Claude's cooperation.
  In this dotfiles repo, `bash-policy.ts` already runs as a PreToolUse hook, so blocking or redirecting a Bash-command pattern is cheapest via **adding a rule to `bash-policy.yaml`**. Non-Bash enforcement (other tool calls, user-prompt monitoring) goes into **a new hook script under `~/.claude/scripts/`**.
  - Sub-option A: Add a rule to `~/.claude/scripts/bash-policy.yaml` (Bash patterns only)
  - Sub-option B: Add a new PreToolUse / PostToolUse / UserPromptSubmit hook script under `~/.claude/scripts/`
  Example: "Use pnpm, not npm" → Sub-option A
  Example: "Force /verification-loop to run before declaring complete" → Sub-option B

**Rung 2: PERMISSIONS** (`~/.claude/settings.json` permissions.deny/allow)
  When to use: tool access should be structurally restricted.
  Example: "Never WebFetch github.com" → permissions.deny

**Rung 3: SKILL CREATION / DESCRIPTION FIX / REFERENCE DEEPENING**
  When to use: a multi-step workflow worth automating, an existing skill that failed to auto-load (description gap), or an existing skill whose references are too shallow.

  **Sub-option priority (cheapest first)**:
  1. **Description fix** (lowest cost): only when a matching skill already exists but its trigger phrases miss the scenario. 1-2 line edit to the SKILL.md frontmatter.
  2. **Reference deepening** (medium cost): the existing skill loads correctly but its guidance is insufficient. Add or extend a `references/*.md` file.
  3. **New skill creation** (highest cost): neither of the above applies and the workflow passes the `/invoke` litmus test.

  Always ask "is there a nearby existing skill?" first. If so, prefer description fix or reference deepening to avoid proliferating skills.

  **Mandatory TDD Gate**: every Rung 3 proposal (new creation, reference deepening, description fix) must first pass [skill-tdd-gate.md](skill-tdd-gate.md)'s RED test (reproduce the failure from transcript evidence without the proposed skill). If RED is not reproducible, demote to Rung 4 or discard. This prevents skill proposals that look reasonable on paper but would never have fired in the first place.

**Rung 4: CLAUDE.md ADDITION**
  When to use: only when Rungs 0-3 do not apply. This layer depends on Claude reading and obeying a written rule — the weakest form of prevention.
  A proposal landing on Rung 4 MUST include one line per rejected rung explaining why Rungs 0-3 do not apply.

  **Rung 4 acceptance bar (strengthened)** — the proposal MUST satisfy BOTH conditions below:

  1. **(a) Past-session evidence — mandatory**: cite at least one concrete past-session event (turn number, verbatim quote, or file:line) where this line would have prevented the misbehavior. Hypothetical "if someone ever does X" does not count. Without past-session evidence, Rung 4 is unjustified — discard the proposal.

  2. **(b) Expiry OR redundancy check — either one**:
     - **(b1) Expiry condition**: a one-sentence trigger for when this line can be removed ("remove when the skill's description adds the phrase X", "remove when library Y reaches version Z"). Prevents CLAUDE.md from accreting rules that outlive their cause.
     - **(b2) Redundancy check**: confirm by grep that no existing CLAUDE.md line, instinct at confidence ≥0.7, or skill body already covers the same rule. If coverage exists and did not prevent the recurrence, escalate to the layer that failed (description fix, reference deepening, or hook) rather than adding a second written rule.

  Sub-routing inside Rung 4 (Project-Specific vs Universal, Team vs Personal) uses the existing rules below (see "Rules for Determining Project-Specific vs Universal"). Those rules are unchanged by this ladder.

**Execution-mode change (outside the ladder, referenced only)**:
  Redefining a `~/.claude/agents/*.md` SubAgent is an "execution mode change", not a prevention layer. Consider it only when a specific class of task should run with different tool access (e.g., read-only). It does not have a rung assignment.

## Rules for Determining Project-Specific vs Universal

### Project-Specific Indicators

A learning is **project-specific** if it:

**Contains project-specific references:**
- Mentions specific file paths in the project (e.g., "src/components/", "config/database.yml")
- References project directory structure
- Mentions project-specific module or package names

**Uses project-specific tools or commands:**
- Build commands unique to this project (e.g., "pnpm workspace:build")
- Test commands with project-specific flags (e.g., "npm run test:e2e -- --env=staging")
- Deployment commands for this project's infrastructure

**Describes project-specific conventions:**
- Naming conventions used only in this project
- File organization patterns specific to this codebase
- Project-specific code style or architecture

**Relates to project-specific technology versions:**
- Framework versions used only in this project (e.g., "React 19 is used in this project")
- Library versions specific to this project's dependencies

**Examples:**
- ✅ "This repository uses pnpm workspaces, not npm"
- ✅ "Tests run with `npm run test:unit` in this project"
- ✅ "The API server runs on port 3001 (not 3000)"
- ✅ "Always run `nix flake check` before `darwin-rebuild switch` in this dotfiles repo"

### Project-Specific: Team vs Personal

After determining a learning is project-specific, further classify:

**Team convention** (→ Project CLAUDE.md, git-managed):
- Build commands, test commands, project structure
- Coding standards the team agreed upon
- Architecture decisions documented in ADRs
- Example: "Always run `task format` after modifying proto files"

**Personal preference** (→ Project-local personal CLAUDE.md, `~/.claude/projects/<hash>/CLAUDE.md`):
- Individual workflow optimizations
- Personal coding checklist items
- Preferences not mandated by the team
- Example: "Check useMemo consistency after adding memoization"
- Example: "Always create Stories for new components matching existing patterns"

**Heuristic:** Ask "Would a new team member need to follow this rule?"
- If YES → Team convention (Project CLAUDE.md)
- If NO → Personal preference (Project-local personal CLAUDE.md)

### Universal/Cross-Project Indicators

A learning is **universal** if it:

**Applies to the user's general coding style:**
- Code formatting preferences (e.g., "Prefer named exports over default exports")
- Commenting style (e.g., "Add JSDoc for all exported functions")
- Design patterns (e.g., "Use composition over inheritance")

**Relates to tools used across all projects:**
- git usage patterns (e.g., "Always check git status before commits")
- GitHub CLI preferences (e.g., "Use `gh` for GitHub URLs, not WebFetch")
- Editor or IDE preferences (e.g., "Use Neovim for text editing")

**Describes Claude's general behavior:**
- When to use subagents (e.g., "Use Explore subagent for codebase exploration")
- Communication preferences (e.g., "User prefers concise responses")
- Tool selection patterns (e.g., "Use Edit tool for file modifications, not sed")

**Applies to general programming knowledge:**
- Language-agnostic best practices (e.g., "Validate input at system boundaries")
- Security principles (e.g., "Never commit secrets to git")
- Performance patterns (e.g., "Prefer iteration over recursion for large datasets")

**Examples:**
- ✅ "Use `gh` CLI for GitHub URLs instead of WebFetch (private repos)"
- ✅ "Always use Explore subagent for codebase exploration, not direct Grep"
- ✅ "User prefers Japanese for user-facing text, English for code"
- ✅ "Commit messages should be in Japanese, not English"

## Rules for Skill Proposals

### When to Propose a New Skill

Propose a new skill when ANY of the following conditions are met:

**Condition A: Complex workflow observed (even once)**
- 4+ distinct steps in a consistent sequence
- Multiple tool types involved
- Clear parameterization points exist
- Non-obvious step ordering (outputs feed into next steps)

**Condition B: User taught a multi-step process**
- User correction included 3+ specific sequential steps
- User described conditional logic within the workflow
- User provided a complete recipe, not just a preference

**Condition C: Cross-session repetition signal**
- User explicitly stated this is a recurring task
- Workflow relates to a recurring development lifecycle phase
- Task maps to something the user does in every project/session

**Condition D: Tool orchestration pattern**
- 2+ external tools chained in a non-obvious sequence
- Specific flags or configurations required for correct execution
- Output of one tool feeds as input to the next

**Condition E: Repeated within session (original criterion)**
- Workflow performed 2+ times in the session
- Each occurrence followed the same structure

**All conditions also require:**
- Involves 3+ distinct steps
- Generalizable (can be parameterized for different inputs)
- No existing skill covers it
- Passes the /invoke litmus test ("Would the user type `/skill-name` for this?")

**Examples of skill-worthy learnings by condition:**
- (A) "Parse Google Doc URL → download as docx → convert with pandoc → extract images → report"
- (B) User: "When fixing CI, always: check status → read logs → identify root cause → fix → push → wait"
- (C) User: "I always need to convert docs to markdown for my project"
- (D) "gog export → pandoc conversion with media extraction → cleanup"
- (E) "Edit nix → check → rebuild" repeated 3 times in session

**Examples that should NOT be skills:**
- "Use pnpm instead of npm" (preference, no orchestration → CLAUDE.md)
- "Port 3001, not 3000" (fact, no workflow → CLAUDE.md)
- "Prefer named exports" (code style → CLAUDE.md)
- "Read file → make one edit → save" (too simple, fewer than 3 meaningful steps)

### When to Propose Skill Modification

Propose a skill modification when:

**Existing skill was used but missing information:**
- Skill was invoked during the session
- Claude had to look up additional information not in the skill
- The missing information would have helped

**Existing skill's workflow needed adjustment:**
- Skill's steps were correct but incomplete
- User corrected the skill's approach
- A better workflow pattern was discovered

**Existing skill's description didn't trigger properly:**
- User had to manually invoke the skill when it should have triggered
- Description is missing key trigger phrases
- Skill's use case wasn't clear from description

**Tool-specific knowledge applies to existing skill:**
- Learning is about a tool that an existing skill uses
- The knowledge would improve the skill's effectiveness
- Adding it to the skill is better than CLAUDE.md

**Examples of skill modification proposals:**
- ✅ skill-improver: Add "スキルを改善して" trigger phrase
- ✅ qa-planner: Add note about WebApp timing caveat
- ✅ gemini-research: Clarify that it's for research only, not implementation
- ❌ Generic git usage: Not specific to any skill, goes to CLAUDE.md

## Edge Cases and Ambiguity

### Learning Could Go to Multiple Targets

**General rule:** Choose the most specific, most actionable target.

**Example 1:** "Use Explore subagent for codebase exploration"
- Could be: Global CLAUDE.md (general Claude behavior)
- Could be: Multiple skill modifications (any skill that explores code)
- **Decision:** Global CLAUDE.md (broader applicability, affects all workflows)

**Example 2:** "Chrome DevTools MCP requires take_snapshot before interaction"
- Could be: Global CLAUDE.md (tool knowledge)
- Could be: qa-planner skill modification (tool-specific)
- **Decision:** qa-planner skill modification (more specific, users already using the skill will benefit)

**Example 3:** "Always run nix flake check before darwin-rebuild"
- Could be: Project CLAUDE.md (this is a Nix project)
- Could be: New skill proposal (repeated workflow)
- **Decision:** Both! Add to project CLAUDE.md AND propose skill if workflow was repeated

### Uncertain if Project-Specific or Universal

**Default to project-specific** when uncertain:
- It's easier to generalize later than to make specific
- Project CLAUDE.md is read when working in that project
- Global CLAUDE.md should only have truly universal patterns

**Heuristic:** If in doubt, ask:
- "Would this apply to a completely different project/codebase?"
- If NO → Project-specific
- If YES → Universal

### Uncertain if Workflow is Generalizable

**Default to requiring clear generalizability:**
- If the workflow involved very project-specific steps → Don't propose a skill
- If unsure whether it would apply to other cases → Don't propose a skill

Note: Single occurrence alone is NOT a disqualifier. A complex workflow done once
can be a valid skill candidate if it meets Conditions A-D. Only default to "don't
propose" if the workflow also lacks orchestration, parameterization, or cross-session
relevance.

**Heuristic:** A workflow is generalizable if:
- You can imagine parameterizing it (e.g., "file path", "target environment")
- It would be useful in different projects
- The steps are transferable, not hard-coded to this specific case

## Language Matching for CLAUDE.md Additions

When proposing additions to CLAUDE.md files:

**Read the target file first:**
- Determine the primary language (Japanese or English)
- Note if different sections use different languages

**Match the language:**
- If file is primarily Japanese → Write proposal in Japanese
- If file is primarily English → Write proposal in English
- If file is mixed → Match the language of the relevant section

**Examples:**
- User's ~/.claude/CLAUDE.md is in Japanese → Proposals in Japanese
- Project CLAUDE.md is in English → Proposals in English
- Project CLAUDE.md has Japanese headers but English content → Match section language

## Validation Checklist

Before finalizing routing decisions, verify:

- [ ] Read the target CLAUDE.md file (if proposing addition)
- [ ] Confirmed the learning doesn't already exist in the target
- [ ] Checked ~/.claude/skills/ for potentially related skills
- [ ] Applied the decision tree consistently
- [ ] Language of proposal matches target file
- [ ] Proposal is concise (one line for CLAUDE.md entries)
- [ ] Placement in target file is specified (after which section)

## Routing Summary Table (3-archetype, v3)

| Archetype | Default Target (Rung) | Skill Route Possible? | Skill Condition |
|-----------|-----------------------|----------------------|-----------------|
| Behavioral correction | Rung 1 (hook / bash-policy) or Rung 2 (permissions) | Only if the correction names a multi-step procedure | Condition B + must pass skill-tdd-gate RED |
| Workflow candidate | Rung 3 (skill creation / description fix / reference deepening) | Always (that is the archetype's definition) | Condition A / C / D / E / Signal 6 + skill-tdd-gate RED |
| Discovered fact | Rung 4 (CLAUDE.md) — only if strengthened bar passes | Rarely; typically reference-deepening on an existing skill | When the fact is structural and the skill would be permanent |
