# Human review

Which changes a person reads in the diff instead of accepting them on the Completion Criteria evidence and the gate verdict. The plan skills apply it to `## Files to Change` before approval; `/gate` and `$impl` apply it to the final diff before the report.

A change is read by a person when its effect, not its file type, crosses one of these boundaries. Each has a fixed label, used as written in the plan handoff's `## レビューしてほしい変更`; the report line names the boundary in a word or two:

- `権限・信頼境界`: grants or widens what an agent or a command may do without confirmation, or moves a trust boundary. `permissions.allow` / `deny`, hooks, `bash-policy.yaml`, `write-policy`, sandbox or allowlist settings, and a skill or `AGENTS.md` line that tells an agent to act without asking.
- `秘密情報・認証`: changes how a secret, credential, token, or authentication is stored, passed, or checked.
- `外部への書き込み・送信`: writes or sends outside the machine. A push, merge, PR, or issue on GitHub, a Slack post or Calendar write through Hermes, any external API write, and a skill or `AGENTS.md` line that tells an agent to do one of these.
- `取り消せない操作`: does something the repository cannot undo. Deleting user data or files outside the repository, registering or removing a launchd job, migrating stored data.

Not included: wording of a review or approval procedure that grants no permission and starts no outside write, tests and fixtures, a rule or sink that only moved or was renamed. When you cannot tell whether a change crosses a boundary, list it.

## Item

In the report, one line per hunk under `レビューしてほしい N か所` (the first group of `**あなたがすること**`), which means the change is not accepted on the evidence and the reviewers' verdict alone: the reader reads this hunk of the diff. The line carries the place, the boundary in a word or two with what changes, what happens if it stays, and how to undo it, with no sentence-final 。; a security finding on the same hunk follows on the same line with its severity in words:

```
- `claude/settings.json:24` — 権限。allow に `Bash(curl *)` を追加。残すと curl が無確認で通る。戻すなら行を消す
```

The path may be shortened to the suffix that is unique in the diff, and the line stays within the report's 90 characters; when a security finding does not fit, keep its severity word and point at the sidecar for the rest. A hunk that crosses more than one boundary is still one line; it names each boundary in the order listed above. Whether to fix a security finding carried on a line is a `決める` line that points at it. These lines need reading whatever the gate verdict.
