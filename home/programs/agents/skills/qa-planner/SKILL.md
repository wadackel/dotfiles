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
6. **If using a user-confirmation prompt and the user selects a verbal explanation option** (e.g., "口頭で説明"), provide structured guidance on what information is needed:

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

All QA evidence — screenshots and the Markdown report — is consolidated under `$PROJECT_ROOT/.wadackel/qa/<run-dir>/`. `.wadackel/` is already covered by the user's global gitignore, so no per-project ignore wiring is needed.

**Mandatory first action of Step 4** — this Bash block MUST be the very first Bash tool call of Step 4. No `agent-browser`, `curl`, `screenshot`, or any other test command may execute before `$RUN_DIR` is resolved and `mkdir -p "$RUN_DIR/screenshots"` succeeds. Skipping this block guarantees that screenshots and `report.md` fail to land on disk.

If `mkdir -p` fails (permission denied, disk full, etc.), STOP Step 4 immediately and report the failure to the user — do not proceed with tests, because evidence would be unrecoverable.

**Fresh-shell warning**: Claude Code's Bash tool spawns a new shell for every invocation, so the `RUN_DIR` shell variable does **not** persist across Bash calls. After the setup block prints `RUN_DIR=...`, treat the printed absolute path as a **literal string** and re-declare `RUN_DIR="<that literal path>"` at the top of every subsequent Bash invocation that references it (or inline the absolute path directly). Forgetting this is the most common cause of "I ran the tests but evidence was not saved" failures.

Resolve `$RUN_DIR` once at Step 4 entry, before any screenshot/report command:

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
├── screenshots/
│   ├── qa-t1-home.png
│   └── qa-t2-error.png
└── report.md
```

**Mode C — passing $RUN_DIR to subagents**: each Bash tool call gets a fresh shell, so subagents do **not** inherit shell variables from the Lead's shells (unlike `$PPID`, which is auto-inherited from the parent process). The Lead must resolve `$RUN_DIR` to a literal path string and embed it in any `SendMessage` prompt to the QA Tester. The QA Tester re-uses that literal path verbatim — it must not recompute its own `$RUN_DIR` or the screenshots and report will land in different directories.

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

#### Evidence Capture (WebApp)

Capture screenshot evidence to prove test execution results. Commands reference `agent-browser` skill. All paths below are anchored on the `$RUN_DIR` resolved in the Run directory setup block above.

**Video recording is intentionally not used.** `agent-browser record start` (v0.31.x, 2026-07 現在) wipes the current tab's localStorage as a side effect — verified empirically on 2026-07-09: 50 ms after `record start`, `localStorage.keys` was `[]` even though the URL had not yet redirected. For localStorage-backed auth SPAs (KnowledgeWork recording など) this destroys the auth session and forces a `/auth/login` redirect. Since the QA workflow's real evidence value comes from screenshots + `report.md`, video is dropped entirely rather than worked around. Do NOT introduce `record start` / `record stop` back into this workflow.

**Screenshot rules:**
- Take a screenshot **after each test action** that produces a visible result
- Also capture **important intermediate states** (modal open, preview displayed, loading complete)
- On FAIL: always capture the error state screenshot
- Naming: `qa-{test-id}-{description}.png` (e.g., `qa-t1-home.png`, `qa-t4-upload-preview.png`)
- Use **ASCII kebab-case** for `{description}` (no spaces, no Japanese, no `_`). Markdown link parsing breaks on non-ASCII or whitespace in some viewers. Good: `qa-t2-upload-error.png`. Bad: `qa-t2-アップロード失敗.png`, `qa-t2-upload error.png`.
- Save to `$RUN_DIR/screenshots/`, e.g.:
  ```bash
  agent-browser --session "claude-$PPID" screenshot "$RUN_DIR/screenshots/qa-t1-home.png"
  ```
- When embedding into report.md, use the **relative path** `screenshots/qa-{test-id}-{description}.png` (report.md lives in the same `$RUN_DIR/` as the screenshots, so a relative path resolves correctly in Markdown previewers).

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
## QA テスト計画

### リスク評価
- 高リスク領域: [特定したリスク領域と理由]
- 変更範囲: [影響を受けるファイル/コンポーネント]

### テストケース (N 件: Critical X 件、High Y 件、Medium Z 件)

| ID | リスク | カテゴリ | 内容 | 設計技法 | 前提条件 | 操作 | 期待結果 |
|----|------|----------|------|----------|----------|------|----------|
| T1 | Critical | ハッピーパス | ... | - | ... | ... | ... |
| T2 | High | 入力検証 | ... | BVA | ... | ... | ... |

### テスト方針
- 使用ツール: [使用するツール/スキル]
- 範囲: [自動 N 件 / 手動 M 件]
- カバレッジ: [カバーするカテゴリ]
```

**Mode B output:**

**Pre-flight gate (read before producing ANY Mode B output):** Before emitting either the chat-rendered report or the heredoc write, confirm that `$RUN_DIR` is known and points to a directory created by Step 4 setup. If `$RUN_DIR` is unset, unknown, or its literal value was lost (because Step 4 setup was skipped, or the previous Bash call's shell variable did not survive into a new Bash call), STOP and execute Step 4 "Run directory setup" first. Producing the Mode B report without a resolved `$RUN_DIR` guarantees the disk write will fail silently and the user will be left with a chat-only report — exactly the failure mode this gate exists to prevent.

**Mode B execution order — these four substeps run in strict order. Do NOT reorder. Do NOT skip 1 or 2.**

1. **Persist FIRST (Bash)** — write the Mode B body to `$RUN_DIR/report.md` via the heredoc below. This is a Bash tool call. **Do NOT emit the chat-rendered Mode B body yet.** The persist-first ordering exists because once Mode B results appear in chat, the cognitive temptation to declare "done" without persisting is overwhelming.
2. **Verify on disk (Bash)** — run `ls -la "$RUN_DIR/report.md" && wc -l "$RUN_DIR/report.md"` so the file's existence and size appear in chat as proof. If this command fails or shows a zero-byte file, return to substep 1 — do not advance to substeps 3–4.
3. **Render in chat reply** — emit the same Mode B body (same Markdown content used in substep 1) in your chat reply.
4. **Saved Paths footer (chat reply only)** — append the chat-only footer specified at the end of this section.

The Mode B Markdown body (used identically in substep 1 disk write and substep 3 chat render):

```
## QA 検証結果

### サマリー
- **結果**: X/Y 合格、Z 不合格、W スキップ
- **リスクカバレッジ**: N/N Critical 合格、M/M High 合格
- **カバーしたカテゴリ**: [一覧]

### 検証結果

| ID | リスク | 内容 | 結果 | 備考 |
|----|------|------|------|------|
| T1 | Critical | ... | 合格 | ... |
| T2 | High | ... | 不合格 | ... |

### 不合格テスト

#### T2: [内容]
- **重大度**: [Critical/High/Medium/Low — 実際に観測された影響度に基づく]
- **期待値**: ...
- **実際の値**: ...
- **エビデンス**: 画像エビデンスがある場合は Markdown image 構文で埋め込み、コマンド出力 / レスポンス本文の場合はコードブロックで貼る。

  画像例:

  ![T2 エラー状態](screenshots/qa-t2-error.png)

  非画像例 (API レスポンス / stderr):

  ```
  HTTP/1.1 500 Internal Server Error
  Content-Type: application/json

  {"error": "internal_server_error", "message": "..."}
  ```

- **根本原因**: [特定できれば分析]
- **修正案**: [特定できれば具体的なコード変更]

### 発見事項
[テスト中に発見したバグ、懸念点、所見]

### エビデンス

(各スクリーンショットをキャプション + 相対パス Markdown image で列挙する。パスは report.md からの相対パス。)

**T1: [内容]**

![T1 ホーム画面](screenshots/qa-t1-home.png)

**T2: [内容]**

![T2 エラー状態](screenshots/qa-t2-error.png)

### 推奨事項
[次のステップ: 重大な問題の修正、回帰テストの追加など]
```

**Substep 1 — Persist FIRST (Bash).** Use a quoted-delimiter heredoc so any `$` or backticks inside the Markdown body are preserved literally. The template body uses report.md-relative paths only (no `$RUN_DIR` placeholders), so the quoted delimiter does not strand any variables. If a fresh Bash shell does not have `RUN_DIR` set (see fresh-shell warning in Step 4 Run directory setup), prepend `RUN_DIR="<the literal absolute path printed by Step 4 setup>"` before this command, or inline that literal path in place of `"$RUN_DIR/report.md"`:

```bash
cat > "$RUN_DIR/report.md" <<'REPORT_EOF'
# ... 上記の Mode B 出力テンプレート全文をそのまま挿入 ...
# (サマリー / 検証結果表 / 不合格テスト / 発見事項 / エビデンス (スクリーンショット) / 推奨事項)
REPORT_EOF
```

**Substep 2 — Verify on disk (Bash).** Confirm the file landed:

```bash
ls -la "$RUN_DIR/report.md" && wc -l "$RUN_DIR/report.md"
```

The output appears in chat as evidence. A `No such file or directory` error or a zero-line count means substep 1 was not executed in the expected shell — go back, re-declare `RUN_DIR` if needed, and re-run substep 1 before continuing.

**Substep 3 — Render in chat reply.** Emit the same Mode B body (substep 1's content) directly in your chat reply.

**Substep 4 — Saved Paths footer (chat reply only).** Append a short "Saved" footer to the chat reply so the user can immediately locate the run directory without scrolling back to the Step 4 setup output. **Do NOT include this footer inside the heredoc** — it is chat-only and must not appear in `report.md` (the report body uses relative paths intentionally; absolute paths belong in chat). Resolve `$RUN_DIR` to its literal value when emitting:

```
**Saved**:
- Report: $RUN_DIR/report.md
- Screenshots: $RUN_DIR/screenshots/
```

For non-browser targets (API Server / CLI Tool / Background Service / Library) with no screenshots, omit the `Screenshots` line — keep `Report` always.

## Tips

- When an existing test suite exists, run it first -- it may already cover many cases.
- If the project has a CLAUDE.md with test commands, use those.
- Apply BVA at every input boundary: min-1, min, max, max+1.
- For stateful features (e.g., workflows), always test invalid state transitions too.

## Resources

- [references/test-patterns.md](references/test-patterns.md): Test design technique examples and application-type-specific test scenarios.
