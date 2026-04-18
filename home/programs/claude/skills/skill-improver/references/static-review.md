# Static Review

Two modes of static (no-dispatch) review. The first is a mandatory pre-flight; the second is a fallback when empirical mode is unavailable.

---

## Iteration 0 Minimal

Runs **before every empirical loop**. No subagent dispatch required. Catches description-body drift that would otherwise let a dispatched subagent "reinterpret" the skill via its description and produce a false-positive accuracy score.

### What to check

1. **Description ↔ body alignment**
   - Read the target skill's frontmatter `description`. Enumerate the trigger phrases, claimed capabilities, and use cases it advertises.
   - Read the target skill's body. Enumerate the workflow steps, sections, and what it actually instructs Claude to do.
   - Pair each `description` claim with the body element that delivers it. Any claim with no body backing is **drift**.
   - Any body element not advertised in `description` is **hidden capability** — not necessarily wrong, but worth noting.

2. **Frontmatter format vs current spec**
   - `name`: lowercase, hyphens only, 1-64 chars, no leading/trailing/consecutive hyphens, matches parent directory name
   - `description`: 1-1024 chars, third person, action verb opening, includes WHAT and WHEN
   - `argument-hint`: present if the body uses `$ARGUMENTS`
   - Other optional fields (`disable-model-invocation`, `user-invocable`, `context: fork`, `agent`, `allowed-tools`) — valid format and appropriate for the skill's purpose

3. **File-reference link integrity**
   - Every `references/*.md` mentioned in SKILL.md must exist
   - Every reference file in the directory must be linked from SKILL.md (orphan check)
   - Reference paths use forward slashes, relative from skill root, one level deep

### Action on drift

- **Description claims something the body does not deliver** → tighten the description (preferred) OR add the missing body content
- **Body has hidden capability** → either advertise it in the description or remove it
- **Frontmatter format violation** → fix to spec
- **Broken / orphan link** → fix link or delete orphan

Apply fixes **before** entering Step 3 (Scenario Design). Otherwise the empirical loop measures a moving target.

---

## Full Structural Fallback

Invoked when empirical iteration cannot proceed — either because a guard trips (Guard 1 pre-flight recursion detection, or Guard 2 runtime Agent-tool dispatch failure) or because the main SKILL.md workflow explicitly routes here (e.g., the Self-application clause). This is the comprehensive 6-dimension review preserved as the structural-mode path. It is **NOT a substitute** for empirical evaluation — only a degraded mode.

### Six dimensions, each scored 1-5

#### 1. Frontmatter Quality

Checks:
- `name`: lowercase, hyphens, 1-64 chars, matches parent dir, no reserved words, gerund form preferred
- `description`: action verb start, third person, includes WHAT and WHEN, specific trigger phrases, bilingual triggers when applicable, no vague terms ("helps with", "does stuff"), 1-1024 chars
- Optional fields: `argument-hint` present if `$ARGUMENTS` used, `disable-model-invocation` appropriate, `user-invocable` appropriate, `context: fork` only when needed

Score guide:
- 5: All criteria met, description comprehensive and precise
- 4: Minor improvements possible
- 3: Meets requirements but room for improvement
- 2: Missing key elements (e.g., no WHEN)
- 1: Invalid format or severely incomplete

#### 2. Content Quality

Checks:
- Body under 500 lines
- Only context Claude doesn't already have (no explanation of well-known concepts)
- Consistent terminology
- Concrete examples
- Forward slashes for paths
- No time-sensitive information

Score guide: 5 (excellent), 4 (minor verbosity), 3 (some unnecessary content), 2 (verbose / confusing), 1 (broken).

#### 3. Progressive Disclosure

Checks:
- SKILL.md is overview/navigation, not a dump
- Reference files exist, properly linked, one level deep
- Each reference has a clear purpose stated in SKILL.md
- Long references (>100 lines) have a TOC

Score guide: 5 (perfect token efficiency), 4 (well-structured), 3 (some), 2 (limited), 1 (everything in SKILL.md).

#### 4. Workflow Design

Checks:
- Numbered, sequential steps
- Decision points explicit
- Multi-workflow skills have a Step 0 selector
- Error handling addressed
- Edge cases considered
- Skills with external deps (env vars, tools, services) validate prerequisites at Step 0
- Shell commands with side effects use safe patterns (e.g., `git status --porcelain` before staging)
- Appropriate degree of freedom (text / pseudocode / specific scripts)

Score guide: 5 (clear with appropriate detail), 4 (well-structured), 3 (basic), 2 (hard to follow), 1 (no clear workflow).

#### 5. Structure and Organization

Checks:
- Quick start near the top
- Overview / purpose clearly stated
- Workflow / usage instructions present
- Examples where helpful
- Logical section ordering
- Easy to scan

Score guide: 5 (intuitive), 4 (well-organized), 3 (basic), 2 (confusing), 1 (no structure).

#### 6. Invocation Control

Checks:
- `disable-model-invocation: true` for side-effect operations (deploy, commit, etc.)
- `user-invocable: false` for background knowledge
- `context: fork` only when isolation needed
- Frontmatter aligns with documented workflow
- No conflicting settings

Score guide: 5 (perfect for use case), 4 (appropriate), 3 (reasonable), 2 (mismatched), 1 (incorrect).

### Total assessment

Sum the six scores (max 30):
- 26-30: Excellent
- 21-25: Good
- 16-20: Functional, room for improvement
- 11-15: Significant gaps
- 6-10: Major issues, substantial rework

### Improvement priority

When proposing improvements from structural mode, prioritize:

1. **Critical** — invalid frontmatter format, broken file references, description-functionality mismatch, fundamentally broken workflow
2. **High** — missing trigger phrases, no progressive disclosure, confusing workflow, inconsistent terminology
3. **Medium** — verbose content, missing examples, suboptimal invocation control
4. **Low** — extra trigger phrases for edges, more examples, minor formatting

### Limitation reminder

Structural mode catches **format** problems. It cannot catch **executional** problems (subagent gets confused, reaches wrong conclusion, takes 15 tool calls when 3 should suffice). For those, empirical mode is required.

When falling back to structural, the user-facing message depends on which guard tripped (see SKILL.md "Guards" section):

- **Guard 1 (self-application / recursion)**: "Self-application detected — running structural review of skill-improver instead of recursive empirical evaluation."
- **Guard 2 (Agent tool dispatch unavailable at runtime)**: "Empirical evaluation skipped: Agent tool dispatch unavailable. Reporting structural review only."

Pick the message that matches the cause; do not use a hard-coded single message for all fallback paths.
