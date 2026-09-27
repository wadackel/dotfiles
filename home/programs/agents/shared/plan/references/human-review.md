# Human review

Which changes a person reads in the diff instead of accepting them on the Completion Criteria evidence and the gate verdict. The plan skills apply it to `## Files to Change` before approval; `/gate` and `$impl` apply it to the final diff before the report.

A change is read by a person when its effect, not its file type, crosses one of these boundaries. Each has a fixed label:

- `権限・信頼境界`: grants or widens what an agent or a command may do without confirmation, or moves a trust boundary. `permissions.allow` / `deny`, hooks, `bash-policy.yaml`, `write-policy`, sandbox or allowlist settings, and a skill or `AGENTS.md` line that tells an agent to act without asking.
- `秘密情報・認証`: changes how a secret, credential, token, or authentication is stored, passed, or checked.
- `外部への書き込み・送信`: writes or sends outside the machine. A push, merge, PR, or issue on GitHub, a Slack post or Calendar write through Hermes, any external API write, and a skill or `AGENTS.md` line that tells an agent to do one of these.
- `取り消せない操作`: does something the repository cannot undo. Deleting user data or files outside the repository, registering or removing a launchd job, migrating stored data.

Not included: wording of a review or approval procedure that grants no permission and starts no outside write, tests and fixtures, a rule or sink that only moved or was renamed. When you cannot tell whether a change crosses a boundary, list it.

## Item

One line naming the label, what changes, and where (`file:line`, or the `## Files to Change` path before implementation), and one nested line with what happens if it stays and how to undo it:

```
人が読む: 権限・信頼境界 — `permissions.allow` に `Bash(curl *)` を追加（`home/programs/claude/settings.json:24`）
    - 残すと、curl を含む任意のコマンドが確認なしで通る。戻すならこの行を消す
```

A hunk that crosses more than one boundary is still one item, its labels joined with ` / ` in the order listed above. When a security finding covers the same hunk, it is one item: the `人が読む:` line stays first and the nested line carries the security severity and finding. Under `## 決めてほしいこと` these items come before every other item, because they need reading whatever the gate verdict.
