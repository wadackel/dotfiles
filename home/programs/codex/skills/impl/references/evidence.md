# Evidence commands

Use the existing helper; do not assemble sidecars or hashes inline. Every command takes an absolute `.evidence.json` path under the real `~/.codex/plans` directory. Run from the bound repository. The file's `plan` is the matching `.md` basename.

```bash
rtk proxy ~/.agents/scripts/plan-state.ts normalize "$HOME/.codex/plans/<basename>.evidence.json"
```

Replace `normalize` with the command below, still starting the helper by its path so its shebang applies:

| Command | Arguments / input | Effect |
|---|---|---|
| `start` | `<path> task-N` | Bind repository; record HEAD once; mark in progress |
| `require` | `<path> task-N`; JSON array on stdin | Add acceptance checks; preserve earlier requirements |
| `snapshot` | `<path>` | Print the current target (tree OID of the working tree plus the plan file) |
| `run` | `<path> task-N <id> [--expect-exit N] [--env K=V]... [--cwd DIR] [--grep RE] [--tail N] [--expect-unchanged] -- <command> [args...]` | Snapshot, execute the argv without a shell, snapshot again, append the record (file-state / orchestrator-only only); prints one status line plus the tail or grep lines; exit 1 on fail. The argv names the command itself, never a wrapper such as `timeout` or `nice` (refused before spawning). On a machine with `~/.claude/settings.json`, the argv must also be in Claude Code's `permissions.allow` and clear its bash-policy rules, whichever agent runs it (the helper mirrors that check before spawning). |
| `rerun` | `<path>` | Re-execute every `run`-recorded check whose target is stale or status is fail, once per distinct argv; `fresh` and `skipped (record)` rows are not executed; exit 1 when any rerun fails |
| `record` | `<path> task-N`; JSON object on stdin | Append result only if target still matches; the fields `run` writes (`argv`, `tree`, …) are rejected |
| `append-evidence` | `<path> task-N`; text on stdin | Append narrative or expected-red evidence, without establishing PASS |
| `coverage` | `<path>` | Exit 1 listing every `### Autonomous Verification` bullet whose `cc-<n>` id no task requires |
| `complete` | `<path> task-N` | Reject absent, stale, failed, or blocked required checks |
| `reconcile` | `<path>` | Reopen stale completed tasks while retaining evidence |

Declare each acceptance criterion, including required user observations. Use stable, descriptive IDs per task:

```json
[{"id":"cli-behavior","kind":"live","expected":{"file":"build/cli"}}]
```

For live checks, declare `expected` as a repository-relative `file` (helper derives its SHA-256), `{"git_head":true}` (helper reads current HEAD for CI), or `{"identity":"<approved runtime identity>"}` for a manually observed surface. The record must match that source as well as the observed artifact. A manually declared identity is not independent deployment attestation.

Kinds: `file-state`, `orchestrator-only`, `live`, `audit`, `review`. The final task requires at least one review check; `audit` is accepted but not required, because `complete` re-verifies every implementation task against the current artifact and `coverage` checks that every Autonomous Verification bullet has a declared check. Declare each selected review role separately. For low-risk main-session Review, use `main-review` and include `Review executor: main session` in its output. For independent review, identify the agent and role. The helper validates evidence and verdicts, not who performed the review; record that attribution honestly. With an empty review scope, use a review check documenting the empty diff. The final gate validates current checks across all implementation tasks too.

Capture `snapshot` before running a check, then submit:

```json
{"id":"cli-behavior","status":"pass","target":"<snapshot before verification>","command":"<actual invocation>","output":"<raw output and expected-result comparison>","expected":"<expected executable digest or runtime identity>","observed":"<actual executable digest or runtime identity>"}
```

Statuses: `pass`, `fail`, `blocked`, `waived`. `live` PASS needs matching `expected` and `observed` identities; identify and compare the actual deployed target or CI head to the expected artifact. A local hash does not attest external state. `waived` requires `authorization` quoting the explicit user decision, and cannot waive audit/review. Empty results are invalid. Check records are append-only; the latest result for each required ID controls acceptance.

A target is the tree OID of the working tree (all tracked and non-ignored untracked files, modes, symlink targets) together with the plan file. HEAD and the index are not part of it, so committing or staging the same content keeps every record current. The tree is built from a copy of the index with `git add -A` and `write-tree`, so paths marked `skip-worktree` or `assume-unchanged`, mode changes under `core.fileMode=false`, and edits that git's clean filters or line-ending conversion normalize away do not change the target. The objects are written to `<plan>.objects/` next to the sidecar, never into `.git`; a stale rejection names the paths that changed since the record. Keep test output outside the repository or in an already ignored build directory. Submodules and nested repositories fail explicitly; report the limitation instead of certifying a partial snapshot. Changes to the plan invalidate prior results.

Schema v2 adds `version`, `repository`, and optional per-task `required` / `checks`; existing task IDs, `baseline_sha`, string evidence, and status remain readable by Agentower. Normalize accepts legacy records without marking them verified. Do not rewrite existing requirements to weaken acceptance; use an explicit waiver or create a revised plan when the user changes scope.

Mutations acquire an exclusive sibling `.lock` containing writer PID and start time. On a lock error, check that writer before any recovery; never delete another active writer's lock or automatically age it out. Initialization refuses to overwrite an existing sidecar.

At final completion, every task's latest record for each required check must sit at the current target; `rerun <evidence>` (the sidecar path) brings the `run`-recorded ones there and lists the live and review records as `skipped (record)` so they can be re-taken by hand. A record whose target no longer matches is rejected with the paths that changed since it was taken. Already recorded checks remain current for an unchanged tree. An `audit` record, when used, must end in `AUDIT_VERDICT: PASS`. Each review output must contain exactly one `### MUST_FIX` section with `- None`, and end in `VERDICT: PASS`; missing/malformed verdicts and open blockers cannot be recorded as PASS. Main-session Review uses that same canonical format; it is not an independent reviewer PASS. For an empty diff, record that empty-scope observation followed by the same canonical review format. This binds observed evidence to a verification attempt; it cannot prove external state never changed after observation.
