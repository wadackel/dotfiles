---
name: verification-loop
description: "Opt-in project-aware deterministic verification gate. Detects the project type (Nix flake, Deno, Node, Python) and runs build / typecheck / lint / test / security scan / diff-review. Outputs a READY / NOT READY verdict. Not invoked by the default /impl final gate (that default is /completion-audit → /santa-loop). Invoke explicitly when deterministic re-execution is genuinely required. Triggers include /verification-loop / /verify / verification gate / pre-PR check / 検証ループ."
---

# Verification Loop

Comprehensive deterministic verification system. Project-aware: detects what build/test toolchain applies and runs the right phases. Distinct from `/santa-loop` (which is semantic dual-review) — this skill is binary pass/fail on objective gates.

## When to Use

- **Opt-in only**: `/verification-loop` is no longer part of the default `/impl` final gate (the default is `/completion-audit` → `/santa-loop`, which audits per-task evidence without re-execution). Invoke this skill manually when deterministic re-execution of build / typecheck / lint / tests is genuinely required — e.g., running `/verify` before opening a PR, or as a standalone step after `/impl` completes. It is not orchestrated by the final-gate task.
- **Manual**: before opening a PR / after refactoring / when the user asks "/verify" or "verify quality" or "検証して".

Do NOT use for:
- **Default `/impl` final gate** — use `/completion-audit` + `/santa-loop` instead (per-task verification already covers re-execution; the gate's value is evidence audit + adversarial review)
- Per-task quality verification (use the task's own acceptance criteria during `/impl`)
- Semantic correctness review (use `/subagent-review` or `/santa-loop`)

## Project Detection

Walk upward from cwd; the first match wins, but multiple may apply (e.g., a monorepo with both `flake.nix` and `package.json`):

| Marker | Toolchain | Phases |
|---|---|---|
| `flake.nix` | Nix | `nix flake check`, `treefmt --check` (if `treefmt.nix` present), `statix check` (if installed), `deadnix` (if installed) |
| `deno.jsonc` / `deno.json` | Deno | `deno check **/*.ts`, `deno lint`, `deno test` |
| `package.json` | Node/npm/pnpm/yarn | `<pm> run build` (if script), `<pm> run typecheck` or `tsc --noEmit` (if TS), `<pm> run lint`, `<pm> test` |
| `pyproject.toml` | Python | `ruff check .`, `pytest` (if installed), `pyright` (if installed) |
| `Cargo.toml` | Rust | `cargo check`, `cargo clippy --all-targets`, `cargo test` |
| `go.mod` | Go | `go vet ./...`, `gofmt -l .`, `go test ./...` |

For multi-toolchain projects, run each detected stack and aggregate results.

When **no marker** is present, skip build/typecheck/lint/test phases (they are not applicable) and run only the universal phases (Security, Diff). Surface this clearly in the report so the user knows verification was minimal.

## Workflow

### Phase 1: Build

```bash
# Examples (whichever toolchain detected):
nix flake check       # Nix
deno check **/*.ts    # Deno
pnpm build            # Node
cargo check           # Rust
go build ./...        # Go
```

If build fails → STOP. Report failure. Do not run later phases (they will surface noise).

### Phase 2: Type check

```bash
# Whichever applies:
tsc --noEmit          # TS
deno check            # Deno (already covered in Phase 1)
pyright .             # Python
mypy .                # Python (alternative)
```

Report all errors. Fix critical ones — but do NOT auto-fix in this skill; surface them.

### Phase 3: Lint

```bash
# Whichever applies:
treefmt --check       # Nix project (formatter check)
statix check          # Nix lint
deadnix .             # Nix dead code
deno lint             # Deno
pnpm lint             # Node
ruff check .          # Python
cargo clippy          # Rust
gofmt -l .            # Go (lists unformatted files)
```

### Phase 4: Tests

```bash
# Whichever applies:
deno test             # Deno
pnpm test             # Node
pytest                # Python
cargo test            # Rust
go test ./...         # Go
```

Report: `<X passed / Y total>`. Coverage check is optional and toolchain-specific; only enforce if the project explicitly defines a coverage threshold.

### Phase 5: Security scan

Lightweight grep for high-risk patterns in changed files only:

```bash
# Hardcoded secrets / API keys
rg -n 'sk-[A-Za-z0-9]{20,}|api[_-]?key\s*=\s*["\x27][A-Za-z0-9]{20,}|aws_secret|GH_TOKEN\s*=\s*["\x27]' \
  --type-add 'codish:*.{ts,tsx,js,jsx,py,go,rs,sh,nix,sql,tf,yml,yaml,toml}' --type codish \
  $(git diff --name-only HEAD)
# Unintended console.log in production code
rg -n 'console\.log' --type-add 'cprog:*.{ts,tsx,js,jsx}' --type cprog \
  $(git diff --name-only HEAD)
```

Surface findings with file:line; do NOT block automatically — these are signals, not gates (the dedicated `security-auditor` agent dispatched by `/subagent-review` does the deep check).

### Phase 6: Diff review

```bash
git diff --stat
git diff --name-only HEAD
```

Display summary. Flag suspicious patterns:
- A file with > 500 lines changed (suggests a fat commit)
- More than 20 files changed (suggests insufficient task decomposition)
- Binary files in diff (rarely intentional in source repos)

## Output Format

```
VERIFICATION REPORT
==================

Project type:  <Nix | Deno | Node | Python | Rust | Go | Mixed | None>
Phases run:    <list>

Build:         [PASS / FAIL / SKIPPED]   <command>
Types:         [PASS / FAIL / SKIPPED]   <command>  (X errors)
Lint:          [PASS / FAIL / SKIPPED]   <command>  (X warnings)
Tests:         [PASS / FAIL / SKIPPED]   <command>  (X/Y passed)
Security:      [CLEAN / ISSUES]                     (X potential issues)
Diff:          <N files, M lines changed>           [flags: <fat-commit/many-files/binary>]

Overall:       [READY for next gate / NOT READY (block)]

Issues to fix:
  1. <file:line — what failed — how to investigate>
  2. ...

Raw output (verbatim, for evidence trail):
  --- Phase 1 (Build) ---
  $ nix flake check
  <stdout>
  $? = 0
  --- Phase 2 (Types) ---
  ...
```

`READY` requires Build / Types / Lint / Tests to all be PASS or SKIPPED. Security ISSUES and Diff flags are surfaced but do NOT block — they are advisory.

When NOT READY, fix the issues and re-invoke `/verification-loop` until it returns READY. Since `/verification-loop` is manually invoked (not orchestrated by the `/impl` final gate), the caller decides when the READY result unblocks downstream work (e.g., opening a PR).

## Anti-Patterns

- Paraphrasing tool output ("tests pass") instead of pasting raw stdout — `/completion-audit` (the default final gate) requires raw evidence; `/santa-loop` trusts the audit verdict and does not re-judge completeness
- Running phases serially when they're independent (Build / Lint / Tests can usually parallelize on a single toolchain — but watch for resource contention)
- Treating Security or Diff flags as blocking — they are signals, not gates; over-blocking causes users to lose trust in the gate
- Auto-applying `--fix` flags within this skill — verification reads, doesn't write. Auto-fix belongs in `/impl` per-task work, not in the gate

## Integration Points

| Skill | Relationship |
|---|---|
| `/impl` (default flow) | Does NOT invoke `/verification-loop`. The default final gate is `/completion-audit` → `/santa-loop`. When deterministic re-execution is needed, users invoke `/verification-loop` manually outside the `/impl` orchestration |
| `/completion-audit` | The default final gate; audits per-task evidence without re-execution. `/verification-loop` is complementary opt-in re-execution when an audit-only gate is insufficient |
| `/santa-loop` | Independent of `/verification-loop` in the default flow; runs after `/completion-audit` returns VERIFIED PASS |
| `/subagent-review` | Per-task review during `/impl`. `/verification-loop` is end-of-implementation, not per-task |
| `/codex-review` | Coexists; `/codex-review` is a single-external code review, `/verification-loop` is deterministic toolchain checks — orthogonal purposes |

## Design Decisions

**Why project-aware detection vs fixed phases**: a Nix dotfiles repo has no `npm` or `pytest`; running them produces noise. Fixed phases would either error or no-op silently. Detection makes the gate adapt to the actual project.

**Why Security / Diff don't block**: they are heuristic signals. Blocking on every `console.log` would be too aggressive; surfacing them lets the user judge.

**Why no auto-fix**: a verification gate that mutates the code creates a "ratchet" — every run might rewrite something the user didn't expect. Strict separation: this skill reads, `/impl` writes.

**Why raw output is captured verbatim**: the verbatim output is what `/completion-audit` (the default final gate) consumes for evidence audit; `/santa-loop` then receives the audit verdict and re-uses the same evidence trail without re-judging completeness.

**Why opt-in (no longer the default `/impl` final gate)**: empirical 5-plan analysis showed 0 catches by gate re-execution that per-task verification missed. Default re-execution duplicates cost without catching anything new. Opt-in preserves the deterministic re-run capability for cases that genuinely require it via manual invocation (`/verify`, pre-PR sanity check, standalone post-`/impl` step). No orchestration hook is exposed — users invoke this skill directly.
