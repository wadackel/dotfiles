---
name: gate
description: Final gate for /impl and standalone code review. Runs the evidence audit (`plan-state.ts coverage` / `complete`) and one parallel wave of reviewers (code-reviewer, domain specialists, security-auditor) with bounded re-review, then reports only what the reader must decide. Use at the end of /impl, or on request ("レビューして", "gate", "subagent review", "タスクレビュー"); `--diff-only` reviews a diff that has no plan.
---

# /gate

Two modes. **Plan mode** (default under `/impl`): the plan path from `## Plan ready` and its `<plan>.evidence.json`. **`--diff-only`**: a baseline sha (default `HEAD~1`) and no plan, for trivial work and ad-hoc review. Fixed strings are in `~/.claude/skills/plan/references/contract.md`.

## 1. Collect

- Baseline: the first task's `baseline_sha` from the evidence file, or the given sha.
- Write `git diff <baseline>..HEAD` once to `~/.claude/plans/<slug>.gate.diff` (`<scratchpad>/<timestamp>.gate.diff` when no plan; the hook matches the `.gate.diff` suffix) and list changed files with `--name-only`. Reviewers read the file concurrently.
- Plan mode: `~/.agents/scripts/plan-state.ts coverage <evidence>` (the plan sits next to the sidecar). Exit 1 lists Autonomous Verification bullets with no `cc-<n>` check; declare the missing checks or run the missing verification before dispatching anyone. Then `reconcile` reopens tasks whose evidence went stale.

## 2. Select reviewers

`code-reviewer` always. Add every row whose trigger matches; matches are orthogonal, so all fire together.

| Reviewer | Trigger (changed files or added lines) |
|---|---|
| `rust-reviewer` / `go-reviewer` / `dart-reviewer` / `nix-reviewer` | `.rs` / `.go` / `.dart` / `.nix` |
| `typescript-reviewer` | `.ts` `.tsx` `.mts` `.cts` |
| `react-reviewer` | `.jsx` `.tsx`, or `from "react"` / `"react-dom"` |
| `a11y-reviewer` | `.css` `.scss` `.html` `.jsx` `.tsx` |
| `database-reviewer` | `.sql`, `migrations/`, `schema.(sql\|prisma\|ts)`, or SQL DML / `CREATE TABLE` in app code |
| `deno-reviewer` | `Deno.` API, `jsr:` / `npm:` specifier, or `deno.json(c)` |
| `cloud-architecture-reviewer` | `.tf` `.tfvars`, k8s / Helm yaml, `Dockerfile`, `docker-compose`, `serverless`, `.github/workflows/*.yml` |
| `comment-reviewer` | any `.rs .go .ts .tsx .jsx .mts .cts .py .rb .lua .nix .sh .dart` (self-no-ops without added comments) |
| `security-auditor` | a data-flow trigger in `references/security-triggers.md` |

Skip the wave only for a diff that touches `.md` / `.txt` alone; record that decision in the sidecar.

## 3. Dispatch one wave

All selected reviewers go out in one message, unnamed (a named agent idles until TaskStop). `code-reviewer` gets `references/spec-quality-reviewer-prompt.md` (task spec, plan section, diff, diff path, file list, `~/.claude/CLAUDE.md`); every specialist and `security-auditor` gets `references/domain-reviewer-prompt.md` with `{review_focus}` naming its domain and what a sibling owns. `comment-reviewer`'s focus ends with the output of `~/.claude/scripts/comment-metrics.ts <diff path>` in a fenced block. Reviewers without Bash (`code-reviewer`, `security-auditor`, `comment-reviewer`) also get the diff body inline.

Paste each template's `## Template` block verbatim. The read-only sentence, the `Diff file:` line, and the `VERDICT` rule are machine contract: `reviewer-dispatch-policy.ts` rejects a dispatch without them, because reviewers not told the rule returned PASS over blocker findings in 45% of 774 measured dispatches. Pass no opinion from the main session.

## 4. Judge and re-review

A reviewer FAILs on any `MUST_FIX` / `SHOULD_FIX` (or `CRITICAL` / `HIGH`), or for `code-reviewer` any spec Issue. On FAIL, fix every blocker from every reviewer, write the fix diff to `~/.claude/plans/<slug>.rereview-<n>.gate.diff`, re-run the selection table on that fix diff, and re-dispatch in full every reviewer whose trigger fires on it. The FAILed reviewer itself gets a full re-review when its FAIL held a `MUST_FIX`, `CRITICAL`, or spec Issue, or when it is `security-auditor`; a `SHOULD_FIX` / `HIGH`-only FAIL gets `references/rereview-diagnostic-prompt.md` with the previous findings and the fix diff. A diagnostic reply carrying `ESCALATE: fix introduced a new blocker` counts as FAIL and its next round is full.

Each reviewer has three rounds counting both forms; a re-dispatch caused only by another reviewer's fix does not consume its budget. Exhausting a budget stops the gate: append `[BLOCKED: gate escalated]` to the final task and hand the open blockers to the user. The wave is PASS when every dispatched reviewer returns PASS or only `NIT` / `MEDIUM` / `LOW`.

## 5. Close the evidence (plan mode)

On the final task (`Final Audit + Review`): `start` it if not started, `require` one `review` check per wave (`{"id":"review-<n>","kind":"review"}`), `snapshot`, then `record` with `command` naming the reviewers and the sidecar round and `output` of exactly `### MUST_FIX\n- None\nVERDICT: PASS`. Then `plan-state.ts complete <evidence> <final task id>`. A rejection (`stale verification`, `fresh final-gate evidence required`, `missing verification`) names the task and check to redo; redo it and record again rather than editing the sidecar.

## 6. Record and reply

Append to `~/.claude/plans/<slug>.gate.log.md` under `### Round N` (read the file first for N): the coverage output, the reviewer selection with its reasons, every reviewer's final reply verbatim (a credential, token, or signed URL quoted in a finding becomes `<redacted: where it lives>`), and per bucket the blockers fixed, findings deferred to the user, and non-blockers dismissed with a one-line reason each. Nothing else is dropped from the sidecar. When the write fails, put the block in the reply instead and say so.

The reply carries only what changes the reader's next action:

- The verdict in one line, with the sidecar path.
- Every item the reader must decide, one bullet each: the `file:line` and the finding on the bullet. What happens if it stays goes on a nested bullet under it. The items are a `SHOULD_FIX` / `HIGH` deferred on purpose, a security `MEDIUM` or above left open, and a `[live]` item waived or deferred to a later run, with its `Observe` and `Your steps` copied as nested bullets under it. A finding dismissed in an earlier round that resurfaces is listed here, not dismissed again.
- Nothing else: no per-reviewer lines, no round counts, no themed tallies of NITs.

A gate that ends `[BLOCKED: gate escalated]` lists the open blockers the same way.
