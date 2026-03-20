---
name: instinct-learner
description: Extracts atomic behavioral rules (instincts) from session learnings with confidence scoring. Integrates with session-retrospective Phase 2.6 to accumulate learnings across sessions. Instincts with high confidence (0.7+) are promoted to CLAUDE.md. Triggers include "instinct-learner", "instinct を抽出", "学びを蓄積", "extract instincts".
---

# Instinct Learner

Accumulates session learnings as atomic "instincts" (one-line rules + confidence scores), and promotes them to CLAUDE.md once sufficient confidence is reached.

## Overview

session-retrospective extracts learnings -> instinct-learner accumulates them as atomic rules -> confidence accumulates -> promoted to CLAUDE.md

```
Session A: "Didn't verify output count" → instinct created (confidence: 0.5)
Session B: "Didn't verify test result values" → same instinct reinforced (confidence: 0.6)
Session C: User corrects with "check the count" → reinforce +0.2 (confidence: 0.8)
→ confidence 0.7+ → CLAUDE.md promotion candidate
```

## When to Use

- Automatically called from `/session-retrospective` Phase 2.6
- Manually invoked as `/instinct-learner` (for instinct management)

## Instinct Format

Storage: `~/.claude/instincts.jsonl` (one instinct per line, JSON Lines)

```json
{
  "id": "inst-001",
  "rule": "Verify output value correctness (not just error absence)",
  "status": "active",
  "confidence": 0.5,
  "domain": "verification",
  "source_sessions": ["session-abc"],
  "created": "2026-03-19",
  "last_reinforced": "2026-03-19",
  "promoted_at": null,
  "claude_md_section": null
}
```

## Confidence Scoring

| Event | Confidence Change |
|---|---|
| Initial creation | 0.5 |
| Re-observed in a different session | +0.1 |
| Confirmed by user correction | +0.2 (strongest signal) |
| No reinforcement for 5+ sessions | -0.1 |

| Threshold | Action |
|---|---|
| 0.3 or below | Auto-prune (active status only) |
| 0.7 or above | CLAUDE.md promotion candidate |
| 0.9 | Upper limit |

## Lifecycle States

- **active**: Default. Accumulating
- **promoted**: Promoted to CLAUDE.md. Exempt from pruning
- **pruned**: Deleted

## CLI Commands

```bash
# Add new instinct
instincts.ts add --rule "Rule text" --domain "verification" --session "session-id"

# Reinforce existing instinct
instincts.ts reinforce <id>

# List instincts
instincts.ts list [--min-confidence 0.5]

# Prune low-confidence instincts
instincts.ts prune

# Show promotion candidates
instincts.ts promote
```

## Domains

Instinct classification:
- `verification` -- rules about verification
- `workflow` -- rules about work processes
- `code-style` -- coding style
- `debugging` -- debugging techniques
- `git` -- Git operations
- `tool-usage` -- tool usage
- `communication` -- communication with users

## Integration with session-retrospective

Called during Phase 2.6 (Instinct Extraction):

1. Target learnings from the **Corrected Approaches** and **Repeated Workflows** categories
2. Register learnings that pass the Generalization Check via `instincts.ts add`
3. If similar to an existing instinct, reinforce via `instincts.ts reinforce`
4. **Missing Context** and **Tool Knowledge** are routed to direct CLAUDE.md proposals, not instincts

## Promotion to CLAUDE.md

Instincts with confidence 0.7+ are included in `/session-retrospective` Phase 4 CLAUDE.md proposals. After user approval:
1. Added to CLAUDE.md as a one-line rule
2. Instinct status updated to `promoted`
3. `promoted_at` and `claude_md_section` recorded

## Related

- **session-retrospective** -- calls instinct-learner in Phase 2.6
- **cross-session-analysis** -- cross-session analysis (larger scale)
