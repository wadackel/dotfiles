---
name: instinct-learner
description: Deprecated pointer. The instinct ledger is now the retrospective ledger, managed via retrospective-ledger.ts and driven by /session-retrospective. This skill only redirects the legacy trigger phrases ("instinct を抽出", "学びを蓄積", "extract instincts") to the new entry point.
---

# Instinct Learner (deprecated)

This skill has been integrated into `/session-retrospective` v3. The atomic "instinct" concept has been subsumed into the outcome-tracking **retrospective ledger**, and the CLI has moved.

If you invoked this skill expecting the previous v2 behavior, please use the replacements below.

## Replacements

**CLI path change**:

- Old: `~/.claude/skills/instinct-learner/scripts/instincts.ts`
- New: `~/.claude/skills/instinct-learner/scripts/retrospective-ledger.ts`

**Ledger file change**:

- Old: `~/.claude/instincts.jsonl`
- New: `~/.claude/retrospective-ledger.jsonl` (migrated via `migrate.ts`; source renamed to `instincts.jsonl.bak`)

**Subcommand map** (all backward-compatible):

| Old invocation | New invocation |
|---|---|
| `instincts.ts add --rule "..." --domain "..." --session "..."` | `retrospective-ledger.ts add --rule "..." --domain "..." --session "..."` |
| `instincts.ts reinforce <id>` | `retrospective-ledger.ts reinforce <id>` |
| `instincts.ts list` | `retrospective-ledger.ts list` |
| `instincts.ts prune` | `retrospective-ledger.ts prune` |
| `instincts.ts promote` | `retrospective-ledger.ts promote` |
| `instincts.ts mark-promoted <id> <section>` | `retrospective-ledger.ts mark-promoted <id> <section>` |
| (new) | `retrospective-ledger.ts record-proposal <id> --layer <L> --target <path> --plan '<JSON>'` |
| (new) | `retrospective-ledger.ts verify --transcript <path> [--dry-run]` |

All existing subcommands behave identically. The new subcommands (`record-proposal`, `verify`) are what make the ledger closed-loop — Phase 1 of `/session-retrospective` v3 uses them to check whether past proposals actually changed behavior.

## Redirect guidance

When asked to "extract instincts" or "instinct を抽出" or "学びを蓄積":

1. If the user wants the full self-improvement flow (extract from this session, propose changes, track outcomes) → run `/session-retrospective` instead. The retrospective handles instinct creation as part of Phase 4 Present & Track.

2. If the user wants to add / list / reinforce a specific ledger entry directly → use the `retrospective-ledger.ts` CLI (see the subcommand map above).

3. If the user is asking about the ledger itself (contents, confidence scores, promotion candidates) → `retrospective-ledger.ts list` / `promote`.

## Why the change

The v2 instinct-learner modeled each rule as a rule-only entry — no link to the proposals derived from it, no record of whether those proposals prevented future misbehavior. The v3 ledger extends each entry with `proposals[]` and `outcomes[]` so that `/session-retrospective` v3 Phase 1 can auto-verify and feed recurrence back into Phase 2 as escalation signals. The CLI rename reflects that the file is no longer just instincts — it is the retrospective source of truth.

See `~/.claude/skills/session-retrospective/SKILL.md` for the full v3 architecture.

## Related

- `/session-retrospective` — primary entry point
- `/cross-session-analysis` — 100+ session Gemini-based analysis (unrelated to ledger)
