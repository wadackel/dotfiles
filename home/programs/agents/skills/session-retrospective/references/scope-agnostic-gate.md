# Scope-Agnostic Gate

Gate used by Phase 2 Extract & Drill (before Phase 3 Pair Design) to filter **tool-specific facts** from **generalizable principles**. Runs on every learning after the 5-whys drill, before routing.

The failure mode this gate prevents: learnings like "`git diff` in shallow clone returns wrong count" landing on Rung 4 as a one-line CLAUDE.md rule. That rule is frozen at the specific tool and stops being reusable the moment git changes behavior or the scenario shifts to jj / hg / a different command.

The cure is to force every proposal past a substitution test. If the rule survives swapping the tool / project / domain, it is a principle. If not, it is an example that belongs under a principle that has not been written yet.

## When to run

Run AFTER the 5-whys drill has produced a Root Cause. Run BEFORE Phase 3 Routing.

Mandatory for every non-preference learning — the same scope as `five-whys-drill.md` (Behavioral correction, Workflow candidate, Discovered fact). SKILL.md Phase 2 Extract & Drill (before Phase 3 Pair Design) invokes this gate on all such learnings before routing.

Skip this gate for **Preference (one-shot, non-archetype)** — preferences are inherently tied to the user, not to a system, so the substitution test yields no signal.

## The substitution test

For each learning, form the **rule candidate** as one sentence. Then perform three substitutions:

1. **Tool substitution**: replace the tool / command / library with a comparable alternative. Does the rule still hold?
   - `git` → `jj`, `hg`, or "any VCS"
   - `npm` → `pnpm`, `yarn`, or "any package manager"
   - `darwin-rebuild` → "any system rebuild tool"

2. **Project substitution**: replace the project context with a different one. Does the rule still help?
   - This dotfiles repo → any Nix project
   - This dotfiles repo → any Node project
   - This dotfiles repo → a greenfield TypeScript codebase

3. **Domain substitution**: replace the domain-specific noun with a sibling. Does the rule still make sense?
   - "shallow clone" → "sparse checkout" → "partial fetch"
   - "lint errors" → "type errors" → "test failures"

A rule is **scope-agnostic** when all three substitutions preserve the rule's usefulness.

A rule is **scope-specific** when one or more substitutions break it. Scope-specific rules are not wrong — they just belong to a lower abstraction level.

## Required output per learning

### Two concrete counter-examples

To prevent the Abstraction Test from being waved through, always write **two concrete counter-examples** where applying the rule would be wrong or wasteful. Each counter-example must cite one of:

- a direct transcript quote from a past session
- a file path and line number from this repo or a related one
- a specific tool-version / environment detail that changes the rule's applicability

Hypothetical "maybe in the future" counter-examples are disallowed. If you cannot write two with concrete citations, the rule is underspecified — either strip its scope down or promote its abstraction up.

### Keep-principle vs keep-instance verdict

After the substitution test and counter-examples, pick one:

- **Keep principle**: write the rule at the principle level. The specific tool / project / domain becomes an example, not the rule itself. This is what enters Phase 3 Routing.
- **Keep instance**: the rule is genuinely scope-specific and does not generalize. Route to Rung 4 (Project-Specific CLAUDE.md) only. Global CLAUDE.md, skills, and hooks are excluded.
- **Discard**: the rule fails the substitution test AND you cannot find two concrete counter-examples. Drop it and record in the Rejection Log.

## Template

```
### <learning label>

**Rule candidate**: <one sentence>

**Substitution test**:
- Tool: <original> → <substitute> — still holds? YES / NO — <one line why>
- Project: <original> → <substitute> — still holds? YES / NO — <one line why>
- Domain: <original> → <substitute> — still holds? YES / NO — <one line why>

**Counter-example 1**: <concrete citation + how the rule would mislead>
**Counter-example 2**: <concrete citation + how the rule would mislead>

**Verdict**: keep-principle | keep-instance | discard
**Rewritten rule** (if keep-principle): <general statement, with original as example>
```

## Example (keep-principle)

**Rule candidate**: "`git diff` in shallow clone returns wrong file count — use `refs/pull/N/merge` instead"

**Substitution test**:
- Tool: `git` → `jj` — NO, jj does not have shallow clones in the same form. The rule does not transfer verbatim.
- Project: shallow-clone CI in this repo → shallow-clone CI in any repo — YES, the rule transfers.
- Domain: file count → line count → hunk count — YES, the underlying problem (output value correctness, not error absence) transfers.

**Counter-example 1**: When the CI already unshallows (`fetch-depth: 0`), the rule is wasteful and adds unnecessary plumbing. File: `.github/workflows/ci.yml:15`.
**Counter-example 2**: Hooks that run `git diff` on the dev machine (local, never shallow) would follow the rule unnecessarily. File: `~/.claude/scripts/*.ts` uses local git diff.

**Verdict**: keep-principle
**Rewritten rule**: "Verify output value correctness, not just error absence. In CI with shallow fetch, a command may succeed while returning meaningless values — define the expected output up front and compare." `git diff` in shallow clone is ONE concrete example; the principle covers shallow fetch, sparse checkout, and any partial-data scenario.

## Example (keep-instance)

**Rule candidate**: "This dotfiles repo's `darwin-rebuild switch` must use `.#private` or `.#work` flake output"

**Substitution test**:
- Tool: `darwin-rebuild` → `nixos-rebuild` — NO, different flake output conventions.
- Project: this dotfiles → a different Nix-darwin project — NO, flake outputs are named differently.
- Domain: `darwin-rebuild` → `home-manager switch` — NO, different command structure.

**Counter-example 1**: Any other Nix-darwin config uses different output names. This rule does not apply cross-project. File: `flake.nix:1-50` of this repo has profile-specific names not found elsewhere.
**Counter-example 2**: A NixOS rebuild on Linux would not have `.#private` / `.#work` flake outputs at all.

**Verdict**: keep-instance
**Routing**: Rung 4 (Project CLAUDE.md of this dotfiles repo only). Not Global CLAUDE.md. Not a skill.

## Anti-patterns

- **Waving the substitution test** with "this is obviously general" — do the substitutions explicitly.
- **Accepting hypothetical counter-examples** — "if someone ever switches to jj" does not count. Cite real code / real sessions / real tool-version behavior.
- **Promoting every rule to principle level** — some rules are genuinely scope-specific. keep-instance is a valid verdict; forcing principle-level rewrites produces vague aphorisms.
- **Keeping a rule that fails both substitution AND counter-example sourcing** — that rule is speculation. Discard and record.

## Relationship to existing SKILL.md content

This gate owns the detailed procedure. The SKILL.md body's Abstraction Test and Generalization Check retain only a 1-2 line pointer ("see `references/scope-agnostic-gate.md`") — the full substitution / counter-example / verdict workflow lives here to avoid duplication drift.
