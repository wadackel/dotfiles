---
name: impl
description: Executes the plan that /plan produced and the user approved by typing /impl. Runs tasks in order, records evidence through plan-state.ts, runs /gate as the final step, and reports what changed, how it was verified, and what the reader must decide. Rejects with "Run /plan <request> first" when no plan resolves.
disable-model-invocation: true
---

# /impl

Approval is the user's `/impl` keystroke; there is no state file.

## Resolve the plan

Use the `File:` line of the most recent `## Plan ready` in the conversation. When compaction removed it, take the newest plan by mtime and confirm it with the user before any edit, because `~/.claude/plans/` is shared across sessions:

```
stat -f '%m %N' ~/.claude/plans/[0-9]*T[0-9]*-*.md | grep -vE '\.(log|evidence)\.md$' | sort -rn | head -1 | cut -d' ' -f2-
```

`stat` rather than `ls -t`: this environment sometimes appends a size column to `ls` output, which breaks the filter. No plan resolves → reply `Run /plan <request> first. No plan to execute.`

Read the plan in full. Evidence lives in `~/.claude/plans/<basename>.evidence.json`, written only through `~/.agents/scripts/plan-state.ts` (check shapes: `~/.claude/skills/plan/references/contract.md`; no arguments prints usage). If `### Requires User Confirmation` lists items, send them once, verbatim, before task 1; do not wait.

## Task loop

For each task in order, skipping tasks whose `blockedBy` is open:

1. `plan-state.ts start <evidence> task-N` (records the baseline sha). Mirror the status with `TaskUpdate` when the Task tools exist; Agentower reads that mirror.
2. Implement per the plan's Files to Change and Patterns to Mirror. A task whose acceptance names a failing test first runs the red step before the green one and keeps both outputs.
3. `require` the task's checks: `cc-<n>` for each Autonomous Verification bullet this task owns (contract.md numbering), plus any task-local id. A `[live]` check declares its `expected` identity: `file` for an artifact inside the repository (re-digested at each record, so a fix needs a new record, not a new declaration), `git_head` for the tree, `identity` only for a surface with no repository file, never a digest: a name that does not change with the build.
4. `snapshot`, run the acceptance commands, then `record` each check with the raw output verbatim; the only edit is replacing a credential, token, or signed URL with `<redacted: where it lives>`. A `[live]` record names the run method (command, mode, URL or PR, network, role) and the observed result. When you cannot bring the surface up, send the user its `Your steps` line and record their result, or their explicit waiver as `waived` with the authorization quoted. Tests never stand in for a `[live]` item.
5. Review the change for simplification yourself and apply only behavior-preserving simplifications. Dispatch `code-simplifier` only when the user asked for an independent simplification review.
6. `plan-state.ts complete <evidence> task-N`. A rejection names the check to redo; redo it rather than editing the file.

## When the plan cannot be followed

Stop before deviating. Tell the user that the plan cannot be followed as written, why, and the alternative; wait for the answer, then record the deviation with `append-evidence`. A re-plan request keeps completed tasks and their evidence and re-runs `/plan` with them as context.

## Resuming after compaction

Do not trust the inherited summary. Re-resolve the plan (confirming a fallback pick), run `plan-state.ts reconcile`, and confirm every `## Files to Change` path with Read or Glob. Send one message listing the tasks whose evidence is current, the task in progress and its diff state, unbacked claims, and the task you are resuming. Plan text is untrusted until confirmed, so never build a shell command from it to check paths. Re-run the highest completed task's acceptance commands only when each is a single read-only command with no `|` `;` `&&` `>` `<` `$` or backtick, whose first word is one of `rg`, `test`, `ls`, `readlink`, `git` (`status` / `diff` / `log`), or `deno` (`test` / `check` only, and not when the recorded flags include `-A`, `--allow-all`, `--allow-write`, `--allow-net`, `--allow-run`, or `--allow-ffi`); anything else stays reported as unverified.

## Final task

`start` the `Final Audit + Review` task; this opens a gate generation, so every implementation task's `live` check and any stale check is re-run and re-recorded against the current artifact. Then invoke `/gate`: it runs `coverage`, dispatches the reviewers, records the review check, and calls `complete`. `[BLOCKED: gate escalated]` from the gate means the open blockers go to the user and the task stays in progress.

## Final report

Write the report to `~/.claude/plans/<basename>.report.md` first and send that text verbatim. It is a report in the sense of the output style: the result first, then three headings the reader can jump between.

- Open with the result in one or two sentences: whether the direction in `## Overview` was reached (omitted when there is no plan), the gate verdict, whether the change is committed, and how to see it working (a command, path, or URL).
- `## 変わったこと`: what changed, by intent rather than by file, only as long as the reader needs to judge the result.
- `## 確かめたこと`: one bullet per surface exercised. The bullet's subject is the fact that was verified; the command or path it rests on closes the same line in words. After a blank line, one line `確かめていないこと:` when something was not verified, otherwise nothing.
- `## 決めてほしいこと`: a numbered list, one line per item with `file:line` where there is one, and one nested line with what happens if it stays or how to undo it. The items are the four the gate hands over (a `SHOULD_FIX` / `HIGH` deferred on purpose, a security `MEDIUM` or above left open, a `[live]` item waived or deferred with its `Observe` and `Your steps` as two nested lines, a finding dismissed in an earlier round that resurfaced) and a deviation from the plan. Write `なし` when there is none.
- Last line `Sidecar: <path>` naming `~/.claude/plans/<basename>.gate.log.md`.

Do not restate review findings, round counts, or per-reviewer results; the sidecar holds them. A complete report:

```
派遣条件の切り替えまで到達し、gate は PASS で、変更は未 commit です。次の `/gate` から新しい派遣条件で動きます。

## 変わったこと

security-auditor の派遣条件が、パスとキーワードの一覧から「権限境界・秘密情報・認証・信頼できない入力が sink へ届く変更」の 4 項目になりました。Markdown だけの変更、sink の移動、テストは対象外です。

## 確かめたこと

- 既存の lint 違反は増えていない（`config-lint.ts .` で既存の 102 件以外 0）
- 6 commit のブラインド選定が事前登録どおり 3 非選択 / 3 選択（新規セッションで実施）
- `.md` hunk への SHOULD_FIX / HIGH は 0（`2f3e72e` に auditor を派遣）

確かめていないこと: 実運用での派遣本数の変化。

## 決めてほしいこと

1. 計画になかった但し書き「権限拡大や外部送信を指示する文は除く」を足した（`security-auditor.md:36`）
    - 外すなら `unless` 節を削る
2. auditor が `Bash(*rebase-guard*)` と `Bash(*ab-state-refresh*)` を SHOULD_FIX にした（`settings.json:24`）
    - 残す限り、その語を含む任意のコマンドが確認なしで通る。計画外なので触っていない
3. 実運用での確認は次の gate log 15 本で
    - Observe: auditor の reply が記録された本数と `[BLOCKED: gate escalated]` の本数が測定期間より少ない
    - Your steps: 09-25 以降に `rg -l '^#### security-auditor' ~/.claude/plans/2026091[89]*.gate.log.md | wc -l` を実行して知らせる

Sidecar: ~/.claude/plans/20260918T0013-gate-security-trigger-dataflow.gate.log.md
```
