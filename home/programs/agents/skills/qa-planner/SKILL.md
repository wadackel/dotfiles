---
name: qa-planner
description: Designs and executes QA test cases. Use for "テストして", "QA観点で確認", "動作確認して", "検証して", "QAして", "test this", "QA check", "merge前に確認", or after feature implementation / dependency updates. Also use in plan mode when designing QA or verification plans to apply risk-based prioritization and systematic test design techniques.
argument-hint: "[target description]"
---

# QA Planner

Design test cases and execute them. Claude runs all tests directly -- only delegate to the user when Claude genuinely cannot execute (physical devices, paid services requiring unavailable credentials, visual design judgment).

**Prerequisite**: The application under test must already be running. This skill does not handle server startup.

## Workflow

### Step 1: Determine Mode

- **Mode A (Plan Review QA)**: Called during plan mode or "what should we test?"
  -> Output: test case list to append to the plan. No execution.
- **Mode B (Post-Implementation Verification)**: Feature is implemented, user wants verification
  -> Output: executed test results with pass/fail status.
- **Mode C (Agent Team QA)**: Large-scale verification where parallel execution is beneficial.
  Use when: 3+ pages or 4+ independent test phases, bug fix + re-verification cycle is expected,
  or user explicitly requests a team structure.
  -> Output: same as Mode B, but orchestrated via a QA Tester agent.

  **Mode C structure (Lead + QA Tester as base):**
  1. `TeamCreate` -> spawn QA Tester (general-purpose) for Chrome MCP testing
  2. Lead (self) handles triage: receives bug reports and decides repair strategy
  3. **Simple bugs** (1-3 lines, location is obvious): Lead fixes directly
  4. **Complex bugs** (root-cause investigation needed, multiple files): spawn Fixer on demand
  5. After fix: `SendMessage` to QA Tester for re-verification
  6. Shutdown order: `SendMessage(shutdown_request)` to all members -> wait for all terminated -> `TeamDelete`

### Step 2: Understand the Target

1. Read the feature description, PR diff (`git diff`), or plan document
2. Identify the application type:

| Signal | Type |
|--------|------|
| Routes, pages, UI components, HTML/CSS/JSX | **WebApp** |
| Endpoint handlers, REST/GraphQL, OpenAPI spec | **API Server** |
| CLI argument parsing, subcommands, `process.argv`/`clap`/`argparse` | **CLI Tool** |
| Cron jobs, queue workers, event handlers | **Background Service** |
| Library exports, no main entry point | **Library** |

3. Identify the tech stack (framework, language, existing test runner)
4. Read relevant source files to understand the feature's behavior
5. Assess risk areas: what parts of this change are most likely to break, and what is the business impact if they do?
6. **If using AskUserQuestion and user selects verbal explanation option** (e.g., "口頭で説明"), provide structured guidance on what information is needed:

   ```
   次の情報を教えてください：

   - **機能の目的**: この機能は何をするものですか？
   - **主要なユースケース**: ユーザーはどのようにこの機能を使いますか？
   - **入力/パラメータ**: どのような入力フィールドやパラメータがありますか？
   - **検証ルール**: 入力に対してどのような検証が必要ですか？（例: 必須項目、形式、長さ制限）
   - **期待される動作**: 成功時と失敗時の動作は？
   - **特別な考慮事項**: セキュリティ、パフォーマンス、エッジケースなど
   ```

   After receiving this information, proceed with Step 3 (Design Test Cases).

7. **Load the specialized skill for the target type before Step 3** (idempotent — always call, do not rely on "already loaded" introspection):

   | Type | Required skill call |
   |------|---------------------|
   | WebApp | `Skill(skill: "agent-browser")` |
   | Electron app | `Skill(skill: "agent-browser")` then load electron specialized skill via `agent-browser skills get electron` |
   | Slack automation | `Skill(skill: "agent-browser")` then `agent-browser skills get slack` |
   | API Server / CLI Tool / Background Service / Library | No additional skill load required |

   Loading at classification time (not just before execution) ensures default flags and workflow patterns are present while designing tests in Step 3.

### Step 3: Design Test Cases

#### Risk-Based Prioritization

Assess each test scenario using a risk matrix (Impact x Likelihood):

| | Low Likelihood | Medium Likelihood | High Likelihood |
|---|---|---|---|
| **High Impact** (auth, data loss, crash) | Medium | High | Critical |
| **Medium Impact** (UX degradation, perf) | Low | Medium | High |
| **Low Impact** (cosmetic, minor) | Skip | Low | Medium |

- **Critical**: Must test first. Block release if failing.
- **High**: Test in current cycle.
- **Medium**: Test if time permits.
- **Low/Skip**: Document but deprioritize.

Factors increasing **likelihood**: new/modified code, complex logic, external dependencies, concurrency, prior defect history.
Factors increasing **impact**: auth/authz, payment, data mutation, public-facing features, security boundaries.

#### Test Design Techniques

Apply systematically per application type. See [references/test-patterns.md](references/test-patterns.md) for detailed guidance and examples.

| Technique | Best For | Example |
|-----------|----------|---------|
| **Equivalence Partitioning** | Input validation (all types) | Valid/invalid email classes for a form field |
| **Boundary Value Analysis** | Numeric limits, string lengths | Password 7/8/16/17 chars for 8-16 range |
| **State Transition** | Workflows, lifecycles | Order: draft->submitted->approved->shipped |
| **Pairwise Testing** | Multi-parameter interactions | Browser x OS x user role combinations |

#### Test Case Format

```
[ID] [Risk: Critical/High/Medium/Low] Description
  Given: precondition
  When: action
  Then: expected result
  Design: [technique applied: EP/BVA/STT/Pairwise]
```

Category coverage checklist:
- [ ] Happy path (critical path works)
- [ ] Input validation (EP + BVA)
- [ ] State transitions (if applicable)
- [ ] Error handling & edge cases
- [ ] Security (injection, access control)
- [ ] Regression (existing features unbroken)

### Step 4: Execute Tests (Mode B only)

#### Pre-flight (mandatory on every Step 4 entry)

For WebApp / Electron / Slack targets, call `Skill(skill: "agent-browser")` at the start of Step 4 even if Step 2 already loaded it. Re-loading is idempotent and cheap — do NOT attempt to detect "already loaded"; that detection is unreliable across compaction boundaries.

Loading the skill brings agent-browser's Default Flags into context. The default that must apply to every browser invocation below:

- **State-import + headless + per-Claude-session daemon**: every `agent-browser` invocation must carry two flags — `--session "claude-$PPID"` (isolates the daemon to this Claude session, so parallel Claude instances cannot kill each other's daemon) and `--state "$HOME/.agent-browser-state/main.json"` on the first call (loads the plaintext state file written by `ab-state-refresh`). Subsequent calls within the same Claude session can omit `--state`. Lead and QA Tester subagents share the same daemon (same `$PPID`) — neither side should `close` until the workflow is complete. The user's live Chrome window is not touched, eliminating window-collision risk during QA execution.

If a browser command fails with `No such file or directory: .../main.json`, the state file has not been imported yet. Stop and ask the user to run `ab-state-refresh` against a logged-in Chrome (see agent-browser `references/authentication.md`). Do not fall back to attaching the user's live Chrome — that re-introduces the collision risk this default eliminates.

#### Run directory setup (mandatory for every Mode B run)

All QA evidence — recording, screenshots, and the Markdown report — is consolidated under `$PROJECT_ROOT/.wadackel/qa/<run-dir>/`. `.wadackel/` is already covered by the user's global gitignore, so no per-project ignore wiring is needed. Save to `/tmp/` is no longer used.

Resolve `$RUN_DIR` once at Step 4 entry, before any record/screenshot/report command:

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel 2>/dev/null || pwd)
# Default SLUG to empty (date-only directory). Override before running this snippet
# when the verification target is concrete enough to label: take 1-3 main nouns
# from the target description and kebab-case them
# (e.g., "ログインフォームの入力バリデーション" → SLUG="login-form-validation").
# Keep SLUG="" for generic targets like "動作確認" / "テストして" / "QAして" or unclear scope.
SLUG=""
RUN_DIR="$PROJECT_ROOT/.wadackel/qa/$(date +%Y-%m-%d_%H-%M)${SLUG:+_$SLUG}"
mkdir -p "$RUN_DIR/screenshots"
echo "RUN_DIR=$RUN_DIR"
```

Resulting layout:

```
$PROJECT_ROOT/.wadackel/qa/2026-04-27_14-30_login-form-validation/
├── recording.webm
├── screenshots/
│   ├── qa-t1-home.png
│   └── qa-t2-error.png
└── report.md
```

**Mode C — passing $RUN_DIR to subagents**: each Bash tool call gets a fresh shell, so subagents do **not** inherit shell variables from the Lead's shells (unlike `$PPID`, which is auto-inherited from the parent process). The Lead must resolve `$RUN_DIR` to a literal path string and embed it in any `SendMessage` prompt to the QA Tester. The QA Tester re-uses that literal path verbatim — it must not recompute its own `$RUN_DIR` or the recording, screenshots, and report will land in different directories.

#### Tool Selection

| Type | Approach |
|------|----------|
| WebApp | `agent-browser --session "claude-$PPID" --state "$HOME/.agent-browser-state/main.json" tab new <url>` for browser automation (open, fill, click, snapshot, screenshot, console/network checks). See Pre-flight above for why both flags are required. |
| API Server | Use `curl -s -w "\n%{http_code}"` to capture response body and status code |
| CLI Tool | Execute commands directly via `Bash`, verify stdout, stderr, and exit codes |
| Background Service | Combine `curl` (trigger/check endpoints) + log inspection |
| Library | Run existing test suite (`vitest`, `jest`, `pytest`, `cargo test`, `go test`) or write inline test scripts |

#### Execution Rules

- Execute Critical and High risk tests first. If Critical fails, stop and report.
- Record each test as PASS / FAIL / SKIP
- On FAIL: capture actual vs. expected, include evidence (screenshot, response body)
- On SKIP: document reason (user action required? environment missing?)
- If an existing test suite covers a case, run it instead of duplicating

#### Evidence Recording (WebApp)

Record evidence to prove test execution results. Commands reference `agent-browser` skill. All paths below are anchored on the `$RUN_DIR` resolved in the Run directory setup block above. Save to `/tmp/` is no longer used.

**Video recording (mandatory for every browser verification, no opt-out):**
1. Before executing the first test case: `agent-browser --session "claude-$PPID" record start "$RUN_DIR/recording.webm"`
2. Execute all test cases sequentially
3. After the last test case completes: `agent-browser --session "claude-$PPID" record stop`

One continuous recording captures the entire session. Do not start/stop per test case. If the verification touches a browser, video is recorded — there is no flag to skip it. Parallel Claude sessions are isolated by `$PPID` in the daemon name and by `$RUN_DIR` (different timestamp / different project root), so per-session collision is already prevented without filename suffixes.

**Screenshot rules:**
- Take a screenshot **after each test action** that produces a visible result
- Also capture **important intermediate states** (modal open, preview displayed, loading complete)
- On FAIL: always capture the error state screenshot
- Naming: `qa-{test-id}-{description}.png` (e.g., `qa-t1-home.png`, `qa-t4-upload-preview.png`)
- Save to `$RUN_DIR/screenshots/`, e.g.:
  ```bash
  agent-browser --session "claude-$PPID" screenshot "$RUN_DIR/screenshots/qa-t1-home.png"
  ```

**WebApp timing caveat**: Apps that populate UI via WebSocket or async fetch may appear blank immediately after navigation -- the data hasn't arrived yet, not a bug. Always use `agent-browser wait` to wait for expected content before screenshotting. If `wait_for` times out, inspect network requests to verify data was actually received before assuming a rendering failure.

**Can Claude execute this?**

```
UI rendering/interaction?  → agent-browser        → EXECUTE
HTTP endpoint?             → curl                 → EXECUTE
CLI command?               → Bash                 → EXECUTE
Library function?          → test suite           → EXECUTE
Needs hardware/paid creds? →                      → ASK USER
Otherwise?                 → Find a way           → EXECUTE
```

#### Exploratory Testing (Optional, Mode B)

After structured tests pass, run a brief exploratory session focused on high-risk areas:

1. Define a charter: "Explore [feature] to discover issues with [risk area]"
2. Time-box: 5-10 interactions
3. Focus on unexpected states, unusual input combinations, rapid repeated actions
4. Document any anomalies found

### Step 5: Report Results

**Mode A output:**

```
## QA Test Plan

### Risk Assessment
- High risk areas: [identified risk areas with reasoning]
- Change scope: [files/components affected]

### Test Cases (N cases: X Critical, Y High, Z Medium)

| ID | Risk | Category | Description | Technique | Given | When | Then |
|----|------|----------|-------------|-----------|-------|------|------|
| T1 | Critical | Happy path | ... | - | ... | ... | ... |
| T2 | High | Input validation | ... | BVA | ... | ... | ... |

### Testing Approach
- Tools: [which tools/skills will be used]
- Scope: [N automated / M manual tests]
- Coverage: [which categories are covered]
```

**Mode B output:**

Render the QA Verification Results in your chat reply **and** persist the same Markdown body to `$RUN_DIR/report.md` so the report sits alongside the recording and screenshots. The two contents must be identical — write the Markdown once, reuse it in both places.

```
## QA Verification Results

### Summary
- **Result**: X/Y passed, Z failed, W skipped
- **Risk coverage**: N/N Critical passed, M/M High passed
- **Categories tested**: [list]

### Results

| ID | Risk | Description | Result | Notes |
|----|------|-------------|--------|-------|
| T1 | Critical | ... | PASS | ... |
| T2 | High | ... | FAIL | ... |

### Failed Tests

#### T2: [description]
- **Severity**: [Critical/High/Medium/Low — based on actual impact observed]
- **Expected**: ...
- **Actual**: ...
- **Evidence**: [screenshot path or response body]
- **Root cause**: [analysis if determinable]
- **Suggested fix**: [specific code change if identifiable]

### Issues Found
[bugs, concerns, or observations discovered during testing]

### Evidence
- **Video**: `$RUN_DIR/recording.webm`
- **Screenshots**:
  - `$RUN_DIR/screenshots/qa-t1-home.png` — T1: [description]
  - `$RUN_DIR/screenshots/qa-t2-error.png` — T2: [description]
  - ...
- **Report**: `$RUN_DIR/report.md` (this file)

### Recommendations
[next steps: fix critical issues, add regression tests, etc.]
```

To write the same body to disk, use a quoted-delimiter heredoc so `$RUN_DIR` and other shell metacharacters in the report content are preserved literally:

```bash
cat > "$RUN_DIR/report.md" <<'REPORT_EOF'
# ... insert the FULL Mode B output template from above, verbatim ...
# (Summary / Results table / Failed Tests / Issues Found / Evidence / Recommendations)
REPORT_EOF
```

## Tips

- When an existing test suite exists, run it first -- it may already cover many cases.
- If the project has a CLAUDE.md with test commands, use those.
- Apply BVA at every input boundary: min-1, min, max, max+1.
- For stateful features (e.g., workflows), always test invalid state transitions too.

## Resources

- [references/test-patterns.md](references/test-patterns.md): Test design technique examples and application-type-specific test scenarios.
