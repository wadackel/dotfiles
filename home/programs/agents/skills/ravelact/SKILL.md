---
compatibility: Requires the ravelact binary on PATH.
description: Run `ravelact` to perform static analysis on a GitHub Actions workflow estate — forward/reverse graph queries (trace, callers), trigger discovery, PR-diff impact, orphan detection, permissions/secrets propagation auditing across reusable-workflow chains, refactor helpers (composite extraction, near-duplicate clusters), and IR export (JSON, Mermaid). Use when working with `.github/workflows/*.yaml` and `action.yaml` files — for PR impact analysis, dependency-graph questions ("who calls this reusable workflow?", "what runs on push?"), permissions auditing, or refactoring a large GitHub Actions estate. Requires the `ravelact` binary on PATH first.
license: MIT
metadata:
    github-path: skills/ravelact
    github-ref: refs/tags/v0.0.4
    github-repo: https://github.com/wadackel/ravelact
    github-tree-sha: 4a5779062fa45992537c5fe13b2e6ce9c407ff8a
    repository: wadackel/ravelact
name: ravelact
---
# ravelact

Static analysis CLI for GitHub Actions workflow estates. Builds an in-memory IR
from `.github/workflows/*.{yml,yaml}` and any `action.{yml,yaml}` in the
repository, then answers forward/reverse/orphan/dump/impact/wiring/check/suggest
queries against it.

The tool runs **offline** against the local repository — no GitHub API calls,
no token required. The workflow and action files being analysed are never
modified. The only file `ravelact` writes is its own IR cache at
`${XDG_STATE_HOME}/ravelact/repo-<sha8>/cache.json` (or
`$HOME/.local/state/ravelact/...` when `XDG_STATE_HOME` is unset). The cache
lives **outside** the repository, so no `.gitignore` entry is required. The
cache is created by `build` and refreshed automatically by other commands.

## When to use this skill

Trigger this skill when the user is working with GitHub Actions workflows and
asks about any of the following:

- "What runs when this PR is opened / on push?" → use `trace`.
- "Which trigger events exist in this repo?" → use `triggers`.
- "Who calls this reusable workflow / local action?" → use `callers`.
- "If I change file X, which entry-point workflows are affected?" → use `impact`.
- "Are there unused workflows / actions / inputs / outputs?" → use `orphans`.
- "Are permissions / secrets propagated correctly across reusable-workflow chains?"
  → use `permissions` or `secrets`.
- "Show me duplicated step sequences I could extract into a composite action."
  → use `extract`.
- "Are these workflows near-duplicates of each other?" → use `dedup`.
- "Render the call graph as a diagram." → use `graph` (Mermaid).
- "Give me the IR as JSON for a custom query." → use `dump`.
- Any consistency question about the workflow estate's wiring → use `wiring`.

## Setup

Install the `ravelact` binary from a release or local build, then invoke it as
`ravelact <subcommand>`. The very first command in
any session should be `build` to populate the IR cache under
`${XDG_STATE_HOME:-$HOME/.local/state}/ravelact/` (subsequent commands reuse
the cache automatically).

```sh
ravelact build --root .
```

## Global flags (apply to every subcommand)

- `--root <path>` — root directory to scan (default: current directory).
- `--no-cache` — skip the IR cache (under
  `${XDG_STATE_HOME:-$HOME/.local/state}/ravelact/`) for this invocation;
  force a full rebuild. Use after manual edits to workflow files when the
  cache may be stale.
- `--exclude <glob>` — exclude local-action manifests matching the glob
  (repeatable). Workflow files under `.github/workflows/` are not affected.
  Useful for skipping `tests/fixtures/**`-style intentional test data.
- `--color auto|always|never` — control ANSI color globally. JSON output never
  contains ANSI escapes regardless of this flag.

## Output formats

`--format` is opt-in per command. Most report commands accept
`text|json|markdown` (default `text`); `trace` accepts
`tree|table|json|markdown` (default `tree`); `graph` accepts `text|markdown`.
`dump` is always JSON, and `build` / `completion` produce no formatted output.

| Command       | Formats                              | Notes                                 |
|---------------|--------------------------------------|---------------------------------------|
| `trace`       | `tree`, `table`, `json`, `markdown`  | `--ascii` affects `tree` only         |
| `triggers`    | `text`, `json`, `markdown`           |                                       |
| `callers`     | `text`, `json`, `markdown`           |                                       |
| `impact`      | `text`, `json`, `markdown`           |                                       |
| `orphans`     | `text`, `json`, `markdown`           |                                       |
| `wiring`      | `text`, `json`, `markdown`           | exits 1 when findings exist           |
| `permissions` | `text`, `json`, `markdown`           | exits 1 when findings exist           |
| `secrets`     | `text`, `json`, `markdown`           | exits 1 when findings exist           |
| `extract`     | `text`, `json`, `markdown`           |                                       |
| `dedup`       | `text`, `json`, `markdown`           |                                       |
| `dump`        | fixed JSON                           | no `--format` flag                    |
| `graph`       | `text`, `markdown`                   | use `dump` for IR JSON                |
| `build`       | fixed text                           | no `--format` flag                    |
| `completion`  | shell snippet                        | no `--format` flag                    |

`text` is human-readable; `json` is suitable for `jq`; `markdown` emits a
self-contained `### <Section>` heading + table (or a per-command "No … found"
message when empty — for example `impact` writes `No impacted targets found.`,
`orphans` writes `No unused declarations found.`, `extract` writes
`No extraction candidates found.`, `dedup` writes
`No near-duplicate workflow clusters found at threshold X.`) suitable for
inline embedding in PR comments and GitHub Job Summaries.

## Exit codes by command group

The CLI groups commands by exit-code policy. The grouping matters when wiring
commands into CI: the **Check** group is intended for merge gating; the others
are informational.

- **Inspect (exit 0; non-blocking reports)**: `trace`, `triggers`, `callers`, `impact`, `orphans`.
- **Check (exit 0/1; non-zero on findings)**: `permissions`, `secrets`, `wiring`.
  Use these in CI as merge-gating steps.
- **Suggest (exit 0; refactor candidates, non-mutating)**: `extract`, `dedup`.
- **Export (output artifacts)**: `dump`, `graph`.
- **Other**: `build` (cache management), `completion` (shell setup snippet).

`build` exits 0 on success. Like every command, it propagates a non-zero exit
on hard errors (unreadable files, malformed YAML), but absent such errors it
is informational and never gates CI.

## Commands

### Inspect

#### `build`

Discover workflows and local actions (composite / JavaScript / Docker), build
the IR, and persist it to
`${XDG_STATE_HOME:-$HOME/.local/state}/ravelact/repo-<sha8>/cache.json`. Run
once per session before other commands; subsequent commands reuse the cache
automatically. Use `--no-cache` to force a rebuild.

```sh
ravelact build --root .
```

#### `trace <event>`

Forward walk from a trigger event (e.g. `push`, `pull_request`,
`workflow_dispatch`, `schedule`, `workflow_run`). Surfaces every workflow that
fires for the event and the chain of `workflow_call` / `uses` / `workflow_run`
edges reachable from each entry point.

Filtering flags (all repeatable; OR within one flag, AND across flags):

- `--type <activity>` — restrict to entry-points whose `types:` declaration
  includes the activity (e.g. `--type opened` for `pull_request`).
  `pull_request` workflows that omit `types:` still match the GitHub default
  subset (`opened` / `synchronize` / `reopened`).
- `--branch <name>` / `--tag <name>` / `--path <pattern>` — test against the
  trigger's `branches:` / `tags:` / `paths:` filter fields. Each `--path X` is
  interpreted as the single-file changeset of `X`.

Rendering:

- `--format tree` (default) — Unicode box-drawing tree.
- `--format table` — 5-column audit table (`DEP / KIND / EDGE / TARGET / NOTE`)
  suitable for grep and CI logs.
- `--format json` — structured trace entries for automation.
- `--format markdown` — `### Trace` heading plus the trace rows as a Markdown table.
- `--ascii` — fall back to ASCII border characters in the tree view.

```sh
ravelact trace push
ravelact trace pull_request --type opened --branch main
ravelact trace push --format table
```

#### `triggers`

List trigger events declared across workflows, with entry workflow counts, declarations, typed/filtered counts, and up to three examples. Use this before `trace <event>` when the right event is unknown. Use `--format json` for automation or `--format markdown` for PR comments.

```sh
ravelact triggers
```

#### `callers <target>...`

List every call site that references the given workflow or local-action target,
relative to the repository root. Reads from stdin (one path per line) when no
positional targets are given and stdin is piped (rg/grep convention).

```sh
ravelact callers .github/workflows/_build.yaml
ravelact callers .github/actions/setup
echo .github/workflows/_build.yaml | ravelact callers
```

`text` output renders one caller per line as `file:job:index` with a
`# <target>` header per input. `json` emits an array of `{target, hits}`
objects, preserving input order. `markdown` emits a `### Callers` heading plus
a table of targets and call sites.

#### `impact`

Reverse impact analysis. Given a list of changed files (workflow YAML, action
manifest, or any file under a local action directory), list the entry-point
workflows and local-action consumers transitively affected. The input nodes
themselves are excluded; only **downstream consumers** appear.

The typical CI usage pipes `git diff --name-only` into the command:

```sh
git diff --name-only origin/main... | ravelact impact
git diff --name-only origin/main... | ravelact impact --format markdown
```

Errors on empty stdin (no input is treated as a usage error, not a zero-finding
result) — handle the empty-diff case in calling scripts.

#### `orphans`

Report declared-but-unused items across the estate. Emits four kinds in one
pass:

1. Reusable workflows that nothing references.
2. Local actions (composite / JavaScript / Docker) that nothing references.
3. Declared `inputs:` that the callee body never references.
4. Declared `outputs:` that no caller consumes via
   `needs.<job>.outputs.<X>` / `steps.<id>.outputs.<X>`.

Always exits 0 — the report is informational, not a CI gate.

```sh
ravelact orphans
ravelact orphans --format json | jq '.workflows'
```

### Check

These commands exit non-zero when any finding is reported. Wire them into CI as
merge-gating steps.

#### `permissions`

Compute the effective `permissions:` scope across caller→callee chains and
surface:

1. Overly-broad coarse declarations (e.g. `permissions: write-all`) on entry
   workflows.
2. Callee declarations that exceed the caller (violates the GitHub Actions
   "monotonic decrease" rule).
3. Entry workflows with no permissions declared at any layer.

```sh
ravelact permissions
```

#### `secrets`

Trace `secrets:` propagation across entry-point → reusable-workflow chains and
surface:

1. `MissingSecretPropagation` — callee declares a `secrets:` requirement the
   caller does not pass.
2. `SecretsInheritChainBreak` — `secrets: inherit` is broken mid-chain so the
   leaf cannot receive caller secrets.
3. `EnvironmentInWorkflowCallCallee` — environment-scoped secrets used in a
   reusable callee that does not declare the environment.

External (cross-repo) callees are opaque and skipped.

```sh
ravelact secrets
```

#### `wiring`

Verify that declared dependency edges resolve and that observable dispatches
are declared. Reports four finding kinds:

- `unannotated-dispatch` — `gh workflow run X` literals in `run:` blocks
  that are not paired with a matching `# ravelact:dispatches X` annotation.
- `dangling-annotation` — `# ravelact:` comments whose target no longer
  resolves to a local workflow.
- `dangling-workflow-run` — `on.workflow_run.workflows: [Name]` entries
  that cannot be resolved to any local workflow by display name or path.
- `dangling-local-uses` — `uses: ./<path>` references (step-level local
  actions or job-level local reusable workflows) whose target is not
  present in the IR (catches typos and stale paths).

```sh
ravelact wiring
```

### Suggest

These commands emit refactor candidates only — they never rewrite files.

#### `extract`

Detect duplicated step sequences across workflows and composite actions, and
emit ranked composite-action extraction candidates with a sketch `action.yml`
per candidate.

- `--min-length <N>` — minimum step count for a candidate sequence (default 3).
- `--min-occurrences <N>` — minimum occurrence count to qualify (default 2).

```sh
ravelact extract
ravelact extract --min-length 5 --min-occurrences 3 --format json
```

#### `dedup`

Cluster near-duplicate workflows by structural + run-script similarity using
weighted-Jaccard similarity and single-linkage union-find. Outputs each
cluster's representative, members, common/divergent `uses:` references, and
whether the trigger sets differ.

- `--threshold <F>` — similarity threshold in `[0, 1]` for clustering (default
  `0.8`). Higher = stricter (fewer clusters, tighter members).

```sh
ravelact dedup
ravelact dedup --threshold 0.9 --format json | jq 'length'
```

A common CI gate is "no near-duplicate clusters at threshold X":

```sh
ravelact dedup --format json | jq -e 'length == 0'
```

### Export

#### `dump`

Print the entire IR as JSON on stdout. Always JSON; no `--format` flag.
Useful when piping into `jq` for custom queries beyond what the built-in
commands offer.

```sh
ravelact dump | jq '.workflows[] | select(.triggers[].event == "push")'
```

#### `graph`

Render the call graph as a Mermaid `graph LR`. Entry workflows are grouped
into `subgraph` blocks per trigger event (multi-trigger workflows appear as
one alias per trigger); reusable workflows / local actions / external actions
are shared nodes; edges follow `uses` / `workflow_call` / `workflow_run`.

- `--event <event>` — restrict to entry workflows for the given trigger
  (recommended for large estates where the unfiltered graph is too dense to
  read).
- `--format text` (default) — raw Mermaid suitable for `> graph.mmd`.
- `--format markdown` — wraps the same Mermaid in a `### Graph` heading + a
  fenced ` ```mermaid ` block, ready to paste into a PR comment or GitHub Job
  Summary.
- Use `dump` for IR JSON.

```sh
ravelact graph --event push > push.mmd
ravelact graph --event pull_request --format markdown
```

### Other

#### `completion <shell>`

Print a setup snippet for `bash`, `zsh`, or `fish` shell completion. The user
sources the output from their rc file.

```sh
ravelact completion bash    # then: source <(COMPLETE=bash ravelact)
ravelact completion zsh
ravelact completion fish
```

## Output interpretation tips

- **JSON output is the contract**: when in doubt about field semantics, run
  `--format json` and inspect the keys directly. Text output is optimized for
  humans; JSON is optimized for downstream tooling.
- **Empty results are valid**: `orphans` with zero findings, `dedup` with no
  clusters, `impact` with no consumers — all exit 0 (or, for the **Check**
  group, exit 0 only when truly clean).
- **Cache staleness**: if a result looks wrong after editing a workflow file,
  re-run with `--no-cache` to force a rebuild before debugging deeper.

## Common workflows

**PR impact comment** (markdown output piped into `gh pr comment`):

```sh
git diff --name-only origin/main... \
  | ravelact impact --format markdown \
  | gh pr comment --body-file -
```

**Estate-wide hygiene check** (combine multiple reports into one Job Summary):

```sh
{
  ravelact orphans  --format markdown
  ravelact extract  --format markdown
  ravelact dedup    --format markdown
} >> "$GITHUB_STEP_SUMMARY"
```

**CI gate on permissions and secrets** (fail PR on findings):

```sh
ravelact permissions
ravelact secrets
```

## Out of scope

`ravelact` does not:

- Execute workflows (use `act` for local execution).
- Detect security rule violations such as untrusted-input sinks (use `zizmor`
  or `octoscan`).
- Rewrite workflow files or perform automatic refactors (use `OpenRewrite` or
  `Actionforge`).
- Collect dynamic analysis (execution logs, CI metrics).
