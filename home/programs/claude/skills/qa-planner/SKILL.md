---
name: qa-planner
description: QA specialist that designs test cases and executes verification for applications (WebApp, API Server, CLI Tool, etc.). Analyzes features to create risk-based, prioritized test scenarios using systematic design techniques (equivalence partitioning, boundary value analysis, state transition, pairwise testing), then runs tests directly using playwright-cli, curl, and Bash. Use when finishing a plan and wanting QA perspective, after completing a feature implementation, when asked to "test this", "QA check", "verify the implementation", "write test cases", "what should we test", "テストして", "品質チェック", "テストケースを作って", or when quality assurance review is needed.
---

# QA Planner

Design test cases and execute them. Claude runs all tests directly -- only delegate to the user when Claude genuinely cannot execute (physical devices, paid services requiring unavailable credentials, visual design judgment).

**Prerequisite**: The application under test must already be running. This skill does not handle server startup.

## Workflow

### Step 1: Determine Mode

- **Mode A (Plan Review QA)**: Called during plan mode or "what should we test?"
  → Output: test case list to append to the plan. No execution.
- **Mode B (Post-Implementation Verification)**: Feature is implemented, user wants verification
  → Output: executed test results with pass/fail status.

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

### Step 3: Design Test Cases

#### Risk-Based Prioritization

Assess each test scenario using a risk matrix (Impact × Likelihood):

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
| **State Transition** | Workflows, lifecycles | Order: draft→submitted→approved→shipped |
| **Pairwise Testing** | Multi-parameter interactions | Browser × OS × user role combinations |

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

#### Tool Selection

| Type | Approach |
|------|----------|
| WebApp | Use the **playwright-cli skill** for browser automation (navigation, form fill, click, snapshot, screenshot, console/network checks) |
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

**Can Claude execute this?**

```
UI rendering/interaction?  → playwright-cli skill → EXECUTE
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

### Recommendations
[next steps: fix critical issues, add regression tests, etc.]
```

## Tips

- When an existing test suite exists, run it first -- it may already cover many cases.
- If the project has a CLAUDE.md with test commands, use those.
- Apply BVA at every input boundary: min-1, min, max, max+1.
- For stateful features (e.g., workflows), always test invalid state transitions too.

## Resources

- [references/test-patterns.md](references/test-patterns.md): Test design technique examples and application-type-specific test scenarios.
