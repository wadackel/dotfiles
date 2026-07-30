"""実例: 「ブラウザがサーバーにリクエストしたらレスポンスが返ってくる」

イメージスキーマ = SOURCE-PATH-GOAL（往路）+ CYCLE（復路で往復）。
実行: python3 examples/request-response.py  → request-response.svg を生成。
"""

import sys
import pathlib

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent.parent))
from genfig import Canvas

c = Canvas(760, 300)

# 登場物（twemoji + 段階的スケールのラベル）
c.emoji("1f310", 80, 110, 80)                    # 🌐 ブラウザ
c.text(120, 215, "ブラウザ", scale="heading")
c.emoji("1f5a5", 600, 110, 80)                   # 🖥️ サーバー
c.text(640, 215, "サーバー", scale="heading")

# 往路: リクエスト（濃い主線）/ 復路: レスポンス（薄い副線）
c.connector(190, 120, 565, 120, label="リクエスト", primary=True)
c.connector(570, 180, 195, 180, label="レスポンス", primary=False)

out = pathlib.Path(__file__).parent / "request-response.svg"
print(c.save(out))
