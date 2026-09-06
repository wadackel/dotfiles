# Evidence commands

Use the existing helper; do not assemble sidecars or hashes inline. Every command takes an absolute `.evidence.json` path under the real `~/.codex/plans` directory. Run from the bound repository. The file's `plan` is the matching `.md` basename.

```bash
rtk proxy deno run --allow-env=HOME --allow-read --allow-write --allow-run=git --no-prompt ~/.codex/scripts/codex-plan-state.ts normalize "$HOME/.codex/plans/<basename>.evidence.json"
```

Replace `normalize` with the command below, retaining the permission flags:

| Command | Arguments / input | Effect |
|---|---|---|
| `start` | `<path> task-N` | Bind repository; record HEAD once; mark in progress; starting the final task creates a new gate generation |
| `require` | `<path> task-N`; JSON array on stdin | Add acceptance checks; preserve earlier requirements |
| `snapshot` | `<path>` | Print a verification token binding the artifact hash to the current gate generation |
| `record` | `<path> task-N`; JSON object on stdin | Append result only if target still matches |
| `append-evidence` | `<path> task-N`; text on stdin | Append narrative or expected-red evidence, without establishing PASS |
| `complete` | `<path> task-N` | Reject absent, stale, failed, or blocked required checks |
| `reconcile` | `<path>` | Reopen stale completed tasks while retaining evidence |

Declare each acceptance criterion, including required user observations. Use stable, descriptive IDs per task:

```json
[{"id":"cli-behavior","kind":"live","expected":{"file":"build/cli"}}]
```

For live checks, declare `expected` as a repository-relative `file` (helper derives its SHA-256), `{"git_head":true}` (helper reads current HEAD for CI), or `{"identity":"<approved runtime identity>"}` for a manually observed surface. The record must match that source as well as the observed artifact. A manually declared identity is not independent deployment attestation.

Kinds: `file-state`, `orchestrator-only`, `live`, `audit`, `review`. The final task requires an audit and at least one review check; declare each selected review role separately. With an empty review scope, use a review check documenting the empty diff. The final gate validates current checks across all implementation tasks too.

Capture `snapshot` before running a check, then submit:

```json
{"id":"cli-behavior","status":"pass","target":"<snapshot before verification>","command":"<actual invocation>","output":"<raw output and expected-result comparison>","expected":"<expected executable digest or runtime identity>","observed":"<actual executable digest or runtime identity>"}
```

Statuses: `pass`, `fail`, `blocked`, `waived`. `live` PASS needs matching `expected` and `observed` identities; identify and compare the actual deployed target or CI head to the expected artifact. A local hash does not attest external state. `waived` requires `authorization` quoting the explicit user decision, and cannot waive audit/review. Empty results are invalid. Check records are append-only; the latest result for each required ID controls acceptance.

A target includes all tracked and non-ignored untracked files. Keep test output outside the repository or in an already ignored build directory. Unsupported non-file entries, including submodules, fail explicitly; report the limitation instead of certifying a partial snapshot. Re-run checks after committing/staging too because HEAD and index are part of the target. Changes to the plan also invalidate prior results.

Schema v2 adds `version`, `repository`, and optional per-task `required` / `checks`; existing task IDs, `baseline_sha`, string evidence, and status remain readable by the picker. Normalize accepts legacy records without marking them verified. Do not rewrite existing requirements to weaken acceptance; use an explicit waiver or create a revised plan when the user changes scope.

Mutations acquire an exclusive sibling `.lock` containing writer PID and start time. On a lock error, check that writer before any recovery; never delete another active writer's lock or automatically age it out. Initialization refuses to overwrite an existing sidecar.

At final completion, live, audit, and review records must belong to the current gate generation. The helper validates the pre-check token, then stores the artifact hash as `target` and adds the generation; do not submit the generation yourself. A result begun before a new gate is rejected even when files are unchanged. Already recorded local checks remain reusable for an unchanged artifact. Starting the final task again requires fresh external observations and verdicts. Audit output must end in `AUDIT_VERDICT: PASS`. Each review output must contain exactly one `### MUST_FIX` section with `- None`, and end in `VERDICT: PASS`; missing/malformed verdicts and open blockers cannot be recorded as PASS. For an empty diff, record that empty-scope observation followed by the same canonical review format. This binds observed evidence to a verification attempt; it cannot prove external state never changed after observation.
