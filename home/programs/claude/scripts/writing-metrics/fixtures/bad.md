# 検証用の悪い文書

```bash
echo "この task はコード内なので検出されない"
```

この task を完了するには、まず gate を通過する必要がある。

処理の流れは、入力 → 検証 → 保存 → 通知の順になっている。

この機能（試験導入）は一部の環境（macOS のみ）で動作する。

エラー時は self-audit を実行し、escalation の要否を判断する。

この build は再現できる。

idx stable exit 0

設定変更完了 (再起動不要)

この step は orchestrator が実行する。
