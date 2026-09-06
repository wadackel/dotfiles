# Codex harness evaluation

The [2026-09-06 pilot results](results-2026-09-06.md) record adoption decisions and limitations.

Run fixed behavior cases in isolated repositories and homes. This is a small
pilot for the plan/impl workflow, not a general agent benchmark or proof of
equivalent quality. The runner uses the installed Codex executable, Astra,
workspace-write sandboxing, and an authentication link. It does not
publish changes or invoke external task services.

## Reproduce a case

Freeze a source tree containing `home/programs/codex`, shared plan references,
`requirements-interview`, and the Claude reviewer definitions referenced by the
Codex adapters. Preserve file modes and resolve the skill-directory links within
that snapshot. Use separate immutable trees for each variant.

```sh
rtk proxy python3 home/programs/codex/evals/harness/runner.py --source /absolute/snapshot --output /absolute/results --variant C --case expired --timeout 360
```

The case IDs and acceptance criteria are in `cases.json`. Each run records source
and case hashes, arguments, raw events, final evidence, elapsed time, and usage.
Every reserved run consumes one of the 40 available slots, including setup
failures. `--prior-sessions` defaults to one for the initial runtime preflight.
Use the same results directory for all variants so the cap applies across them.
At most two comparison sessions should run concurrently. A reservation lock
prevents duplicate slots; inspect the owning process before recovering a stale
lock.

Some cases supply fixed answers to redundant questions. The runner sends them
only after a question-bearing final message and resumes the same thread. These
turns count as interventions, not new independent sessions. Ambiguous cases have
no scripted answer; waiting is the expected behavior. A turn completing does not
establish task success: each result starts as `unadjudicated`.

## Comparison stages

| Stage | Single change under evaluation |
|---|---|
| A → B | Current-artifact evidence, required live checks, durable resumption |
| B → C | Reuse agreement, concise output, implementation discretion, same-target parallel review |
| C → D | Combine TypeScript and React review for React changes; retain a11y/security |
| Selected harness → E | Astra xhigh versus high; fixed explicit specialist effort |

Run four paired cases per stage, then reserve four paired repetitions for the
selected candidate. Runtime/setup probes also consume the 40-session cap, so
reduce optional later comparisons rather than silently exceeding the cap.
Discard a failed optimization candidate. If the preceding stage lacks adequate
evidence, do not promote a reviewer or effort change to the default.

Compare final artifacts and fixed acceptance criteria before reading the variant
label. Check failed and blocked runs too; a refusal to report completion for an
unavailable live requirement is correct. Independently execute fixture commands
instead of relying on the model's PASS. Separate tool/setup failures and timeouts
from confirmed implementation defects. Do not report zero token usage on a
timeout as zero cost: usage may be absent without a completed turn event.
The top-level token fields measure the orchestrator only. `tree_usage` sums the
last cumulative usage per persisted session, including reviewers without
double-counting their earlier events. Use that total for effort comparisons.
Missing sessions and interrupted turns make it incomplete; ephemeral baseline
runs may have no persisted usage at all.

For an optimization, require no acceptance regression, improvement in a majority
of paired cases, and at least 10% lower median time to the same accepted outcome.
Effort changes must also avoid increasing token usage. Count rework and scripted
interventions. Do not compare the time for an unanswered question with the time
for a finished plan. Trial-only extra reviewers are evaluation overhead; classify
their findings by reproduction and actual requirement impact before treating
them as ground truth.

Native Plan and Goal checks must use actual app-server modes/goal state. A CLI
prompt that merely describes those modes is not equivalent. The generated local
app-server schema supplies the protocol: native Plan requires the experimental
collaboration-mode field, and Goal requires a persistent thread. Preserve their
raw events and interrupt unanswered required questions without sending approval.

## Checks and rollback

```sh
rtk proxy python3 -m unittest discover -s home/programs/codex/evals/harness -p '*_test.py'
rtk proxy deno test --allow-read --allow-write --allow-env --allow-run home/programs/codex/scripts/codex-plan-state_test.ts home/programs/codex/scripts/codex-plan-evidence_test.ts home/programs/codex/scripts/codex-plan-marker_test.ts home/programs/codex/scripts/codex-plan-clarification-contract_test.ts
```

Keep reliability changes separate from review/effort configuration. Revert an
unsuccessful optimization by restoring only its skill or role instructions from
the preceding snapshot. Do not restore old evidence over newer records. If
rolling back the state schema itself, archive v2 sidecars and start new plans;
the old normalizer would discard verification fields when it writes them.
