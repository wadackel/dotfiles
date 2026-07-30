"""genfig — イメージスキーマに基づく twemoji 図を SVG で描くための再利用プリミティブ。

設計方針:
- twemoji を SVG に「インライン」して自己完結させる（外部 href は GitHub 等で描画ブロックされるため）。
- 見た目・トークンは FigJam のツールバー UI に 1:1 対応させる:
    * カラー       … 8 色相 × 2 段階（淡=塗り / 濃=ボーダー）＋ 無彩色 4 段階（黒〜淡灰）
    * フォント     … シンプル / フォーマル / テクニカル / キュート の 4 ファミリー
    * テキストサイズ … 小 / 中 / 大 / 特大 / 超特大 の 5 段（意味ベースの別名も保持）
    * テキスト装飾 … 揃え（左/中/右）・太字・取り消し線・箇条書き
    * 線           … 太さ 2 段階（thin/thick）× スタイル（実線/破線）
    * シェイプ     … 四角・円・ひし形・三角・逆三角・楕円・五角形・八角形・十字・
                     左右矢印・シェブロン・星・吹き出し ほか
    * コネクター   … 直線・カーブ・エルボ（直角折れ）・双方向
- 日本語ラベルが綺麗に出るよう日本語フォントを優先指定する。

使い方は examples/ と SKILL.md を参照。
"""

import os
import re
import math
import pathlib
import urllib.request

# ---------------------------------------------------------------------------
# デザイントークン
# ---------------------------------------------------------------------------

# フォントファミリー（FigJam: シンプル / フォーマル / テクニカル / キュート）。
# 日本語を優先指定しつつ欧文フォールバックを添える。
FONTS = {
    "simple":    "'Hiragino Sans','Noto Sans JP','Yu Gothic','Segoe UI',sans-serif",   # ゴシック
    "formal":    "'Hiragino Mincho ProN','Noto Serif JP','Yu Mincho',serif",            # 明朝
    "technical": "'SFMono-Regular','Consolas','Noto Sans Mono','Courier New',monospace",# 等幅
    "cute":      "'Kosugi Maru','Yusei Magic','Hiragino Maru Gothic ProN',sans-serif",  # 丸ゴシック
}
FONT = FONTS["simple"]  # 既定（後方互換）

# 段階的フォントスケール。FigJam のサイズ別名（sm/md/lg/xl/xxl ＝ 小/中/大/特大/超特大）と
# 意味ベースの別名（display/title/heading/label/body/caption）を両方引けるようにする。
# 任意のサイズを直書きせず、必ずこのトークンのキーで指定する。
SCALE = {
    # 意味ベース（既存図との後方互換のため値は据え置き）
    "display": (33, "700"),  # 図全体のタイトル
    "title":   (26, "700"),  # ノードの主役ラベル
    "heading": (21, "700"),  # ノード見出し・層タイトル
    "label":   (17, "600"),  # 矢印・要素ラベル
    "body":    (15, "400"),  # 補足の本文
    "caption": (13, "400"),  # 注記・キャプション
    # FigJam サイズ別名
    "xxl": (33, "700"),  # 超特大
    "xl":  (26, "700"),  # 特大
    "lg":  (21, "700"),  # 大
    "md":  (17, "600"),  # 中
    "sm":  (13, "400"),  # 小
}

# 無彩色 4 段階（FigJam の黒〜淡灰）。テキスト/線の濃淡に使う。
INK_SCALE = {
    "ink":   "#0f172a",  # 黒（最濃）— 主役テキスト
    "dark":  "#475569",  # 濃灰   — 主コネクタ・サブテキスト
    "gray":  "#94a3b8",  # 灰     — 副コネクタ・弱い関係
    "light": "#cbd5e1",  # 淡灰   — 補助線・ガイド
}
# 後方互換の別名
INK = INK_SCALE["ink"]
SUBTLE = INK_SCALE["dark"]
LINE = INK_SCALE["dark"]
LINE_SUB = INK_SCALE["gray"]

# 色相 8 系統 × 2 段階。淡（bg）＝塗り、濃（border）＝枠線、text＝ラベル色。
# FigJam のカラーピッカー上段（濃）＝border、下段（淡）＝bg におおむね対応。
PALETTE = {
    "red":    {"bg": "#fee2e2", "border": "#ef4444", "text": "#b91c1c"},
    "orange": {"bg": "#ffedd5", "border": "#f97316", "text": "#c2410c"},
    "yellow": {"bg": "#fef9c3", "border": "#f59e0b", "text": "#b45309"},
    "green":  {"bg": "#dcfce7", "border": "#22c55e", "text": "#15803d"},
    "teal":   {"bg": "#ccfbf1", "border": "#14b8a6", "text": "#0f766e"},
    "blue":   {"bg": "#dbeafe", "border": "#3b82f6", "text": "#1d4ed8"},
    "purple": {"bg": "#ede9fe", "border": "#8b5cf6", "text": "#6d28d9"},
    "pink":   {"bg": "#fce7f3", "border": "#ec4899", "text": "#be185d"},
    "gray":   {"bg": "#f1f5f9", "border": "#94a3b8", "text": "#475569"},
}

# 線の太さ 2 段階（FigJam の細/太）。
STROKE = {"thin": 2.0, "thick": 3.5}

# 線スタイル（FigJam: 実線 / 破線）。値は stroke-dasharray（None=実線）。
DASH = {"solid": None, "dashed": "7 6", "dotted": "2 6"}


_CACHE = pathlib.Path(__file__).parent / ".twemoji-cache"
_CDN = "https://cdn.jsdelivr.net/gh/jdecked/twemoji@latest/assets/svg/{}.svg"

# FigJam 風ラインアイコン（Lucide）。twemoji と同じく取得→インライン→キャッシュする。
_ICON_CACHE = pathlib.Path(__file__).parent / ".lucide-cache"
_ICON_CDN = "https://cdn.jsdelivr.net/npm/lucide-static@latest/icons/{}.svg"

# 呼びやすい別名 → Lucide のファイル名。未登録の名前はそのまま Lucide 名として扱う。
ICON_ALIASES = {
    "activity": "activity", "pulse": "activity",
    "archive": "archive", "box-archive": "archive",
    "key": "key",
    "comment": "message-circle", "speech": "message-circle", "chat": "message-circle",
    "cloud": "cloud",
    "cpu": "cpu", "chip": "cpu",
    "database": "database", "db": "database",
    "monitor": "monitor", "display": "monitor", "screen": "monitor",
    "mail": "mail", "envelope": "mail", "email": "mail",
    "file": "file-text", "doc": "file-text", "document": "file-text",
    "code": "code",
    "zap": "zap", "lightning": "zap", "bolt": "zap",
    "pin": "map-pin", "location": "map-pin", "map-pin": "map-pin",
    "phone": "smartphone", "mobile": "smartphone", "smartphone": "smartphone",
    "package": "package", "parcel": "package",
    "dollar": "circle-dollar-sign", "money": "circle-dollar-sign", "price": "circle-dollar-sign",
    "shield": "shield", "security": "shield",
    "send": "send", "paper-plane": "send",
    "server": "server",
    "box": "box", "cube": "box",
    "settings": "settings", "gear": "settings", "config": "settings",
    "hard-drive": "hard-drive", "disk": "hard-drive", "storage": "hard-drive",
    "terminal": "terminal", "console": "terminal", "shell": "terminal",
    "user": "user", "person": "user", "account": "user",
    "wallet": "wallet", "card": "credit-card",
    "globe": "globe", "world": "globe", "internet": "globe",
}


# ---------------------------------------------------------------------------
# twemoji の取得・インライン化
# ---------------------------------------------------------------------------

def _norm_cp(cp):
    """'1f310' でも '🌐' でも受け付けて twemoji のファイル名 codepoint に正規化する。"""
    if all(c in "0123456789abcdef-" for c in cp.lower()):
        return cp.lower()
    # 絵文字文字列 → コードポイント列（twemoji 慣習で fe0f は落とす）
    pts = [f"{ord(ch):x}" for ch in cp if ord(ch) != 0xFE0F]
    return "-".join(pts)


def fetch_emoji_raw(cp):
    """twemoji の生 SVG を取得（ローカルキャッシュ）。cp は hex か絵文字文字列。"""
    name = _norm_cp(cp)
    _CACHE.mkdir(exist_ok=True)
    f = _CACHE / f"{name}.svg"
    if not f.exists():
        with urllib.request.urlopen(_CDN.format(name), timeout=20) as r:
            f.write_bytes(r.read())
    return f.read_text(encoding="utf-8")


def emoji(cp, x, y, size):
    """twemoji を nested <svg> としてインライン配置する文字列を返す。"""
    raw = fetch_emoji_raw(cp).strip()
    inner = _svg_inner(raw)
    return (f'<svg x="{x}" y="{y}" width="{size}" height="{size}" '
            f'viewBox="0 0 36 36">{inner}</svg>')


def _svg_inner(raw):
    """SVG 文字列から外周 <svg ...>…</svg> を剥がして中身だけ返す。
    先頭の XML 宣言・ライセンスコメントや複数行の開始タグも吸収する。"""
    inner = re.sub(r"^.*?<svg\b[^>]*>", "", raw, flags=re.S)
    inner = re.sub(r"</svg>\s*$", "", inner)
    return inner


def fetch_icon_raw(name):
    """Lucide のラインアイコン生 SVG を取得（ローカルキャッシュ）。"""
    fname = ICON_ALIASES.get(name, name)
    _ICON_CACHE.mkdir(exist_ok=True)
    f = _ICON_CACHE / f"{fname}.svg"
    if not f.exists():
        with urllib.request.urlopen(_ICON_CDN.format(fname), timeout=20) as r:
            f.write_bytes(r.read())
    return f.read_text(encoding="utf-8")


def icon(name, x, y, size, color=None, stroke=2.0):
    """Lucide ラインアイコンを nested <svg> としてインライン配置する文字列を返す。
    Lucide は stroke="currentColor" なので、外周 svg に stroke 属性を再付与して色を効かせる。
    name は ICON_ALIASES のキー（'database' 等）か Lucide 名そのまま。
    """
    if color is None:
        color = INK_SCALE["dark"]
    raw = fetch_icon_raw(name).strip()
    inner = _svg_inner(raw)
    return (f'<svg x="{x}" y="{y}" width="{size}" height="{size}" '
            f'viewBox="0 0 24 24" fill="none" stroke="{color}" '
            f'stroke-width="{stroke}" stroke-linecap="round" '
            f'stroke-linejoin="round">{inner}</svg>')


# ---------------------------------------------------------------------------
# キャンバス
# ---------------------------------------------------------------------------

# テキスト揃え → SVG text-anchor
_ALIGN = {"left": "start", "center": "middle", "right": "end",
          "start": "start", "middle": "middle", "end": "end"}


class Canvas:
    def __init__(self, width, height, bg="#ffffff", font="simple"):
        self.w = width
        self.h = height
        self.body = []
        self.bg = bg
        # font は FONTS のキー（'simple' 等）でも実フォント文字列でも可
        self.font = FONTS.get(font, font)

    # --- 低レベル ---
    def raw(self, s):
        self.body.append(s)
        return self

    def emoji(self, cp, x, y, size):
        """twemoji（カラー絵文字）を配置する。"""
        return self.raw(emoji(cp, x, y, size))

    def icon(self, name, x, y, size, color=None, stroke=2.0):
        """FigJam 風ラインアイコン（Lucide）を配置する。"""
        return self.raw(icon(name, x, y, size, color=color, stroke=stroke))

    def text(self, x, y, s, scale="label", fill=None, anchor=None, align=None,
             weight=None, bold=False, strike=False, font=None):
        """テキストを 1 行描く。
        - scale   : SCALE のキー（sm/md/lg/xl/xxl または display/heading/label…）
        - align   : 'left'|'center'|'right'（FigJam の揃え）。anchor は後方互換の別名
        - bold    : 太字（FigJam の B）。weight 直接指定も可
        - strike  : 取り消し線（FigJam の S）
        - font    : FONTS のキーでこのテキストだけフォントを上書き
        """
        size, w = SCALE[scale]
        if bold:
            w = "700"
        if weight:
            w = weight
        a = _ALIGN.get(align or anchor or "middle", "middle")
        if fill is None:
            fill = INK if scale in ("display", "title", "heading", "xxl", "xl", "lg") else SUBTLE
        attrs = (f'x="{x}" y="{y}" text-anchor="{a}" font-size="{size}" '
                 f'fill="{fill}" font-weight="{w}"')
        if font:
            attrs += f' font-family="{FONTS.get(font, font)}"'
        self.raw(f'<text {attrs}>{_esc(s)}</text>')
        if strike:
            # text-decoration は librsvg 等で描画されないため明示的に線を引く。
            tw = _text_width(s, size)
            x1 = {"start": x, "middle": x - tw / 2, "end": x - tw}[a]
            sy = y - size * 0.3
            self.raw(f'<line x1="{x1:.1f}" y1="{sy:.1f}" x2="{x1+tw:.1f}" y2="{sy:.1f}" '
                     f'stroke="{fill}" stroke-width="{max(1.4, size*0.07):.1f}"/>')
        return self

    def bullets(self, x, y, items, scale="body", gap=None, fill=None,
                marker="•", align="left", font=None):
        """箇条書き（FigJam の • リスト）。items を行頭マーカー付きで縦に並べる。"""
        size, _ = SCALE[scale]
        if gap is None:
            gap = size + 8
        for i, item in enumerate(items):
            self.text(x, y + i * gap, f"{marker} {item}", scale=scale,
                      align=align, fill=fill, font=font)
        return self

    # --- FigJam 風シェイプ ---
    def sticky(self, x, y, w, h, color="yellow", rx=16, weight="thick", dash="solid"):
        """淡い塗り＋濃いボーダーの角丸シェイプ（FigJam の付箋/四角）。"""
        return self.raw(
            f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{rx}" '
            f'{self._shape_fill(color, weight, dash)}/>'
        )

    # square は sticky の別名（FigJam の「四角」）
    def square(self, x, y, w, h, color="yellow", rx=16, **kw):
        return self.sticky(x, y, w, h, color=color, rx=rx, **kw)

    # --- FigJam 風の図形（絵文字で表せない概念の代替）---
    def _shape_fill(self, color, weight="thick", dash="solid"):
        c = PALETTE[color]
        sw = STROKE.get(weight, weight)
        out = f'fill="{c["bg"]}" stroke="{c["border"]}" stroke-width="{sw}"'
        da = DASH.get(dash)
        if da:
            out += f' stroke-dasharray="{da}"'
        return out

    def cylinder(self, x, y, w, h, color="gray", **kw):
        """データベース（シリンダー）。"""
        ex, ey = w / 2, min(h * 0.16, w * 0.22)
        l, r, b = x, x + w, y + h
        body = (f'M{l} {y+ey} A{ex} {ey} 0 0 0 {r} {y+ey} '
                f'L{r} {b-ey} A{ex} {ey} 0 0 1 {l} {b-ey} Z')
        c = PALETTE[color]
        self.raw(f'<path d="{body}" {self._shape_fill(color, **kw)}/>')
        # 上面の楕円（フタ）
        self.raw(f'<ellipse cx="{x+ex}" cy="{y+ey}" rx="{ex}" ry="{ey}" '
                 f'fill="{c["bg"]}" stroke="{c["border"]}" stroke-width="2.5"/>')
        return self

    def diamond(self, x, y, w, h, color="yellow", **kw):
        """ひし形（分岐・判断）。(x,y) は外接矩形の左上。"""
        cx, cy = x + w / 2, y + h / 2
        pts = f"{cx},{y} {x+w},{cy} {cx},{y+h} {x},{cy}"
        return self.raw(f'<polygon points="{pts}" {self._shape_fill(color, **kw)}/>')

    def triangle(self, x, y, w, h, color="green", direction="up", **kw):
        """三角形。direction='up'|'down'（FigJam の三角・逆三角）。"""
        cx = x + w / 2
        if direction == "down":
            pts = f"{x},{y} {x+w},{y} {cx},{y+h}"
        else:
            pts = f"{cx},{y} {x+w},{y+h} {x},{y+h}"
        return self.raw(f'<polygon points="{pts}" {self._shape_fill(color, **kw)}/>')

    def pentagon(self, x, y, w, h, color="purple", **kw):
        """五角形（上向き）。"""
        cx = x + w / 2
        pts = (f"{cx},{y} {x+w},{y+h*0.40} {x+w*0.82},{y+h} "
               f"{x+w*0.18},{y+h} {x},{y+h*0.40}")
        return self.raw(f'<polygon points="{pts}" {self._shape_fill(color, **kw)}/>')

    def hexagon(self, x, y, w, h, color="purple", **kw):
        """六角形（サービス・処理単位）。"""
        d = w * 0.22
        pts = (f"{x+d},{y} {x+w-d},{y} {x+w},{y+h/2} "
               f"{x+w-d},{y+h} {x+d},{y+h} {x},{y+h/2}")
        return self.raw(f'<polygon points="{pts}" {self._shape_fill(color, **kw)}/>')

    def octagon(self, x, y, w, h, color="teal", **kw):
        """八角形。"""
        dx, dy = w * 0.29, h * 0.29
        pts = (f"{x+dx},{y} {x+w-dx},{y} {x+w},{y+dy} {x+w},{y+h-dy} "
               f"{x+w-dx},{y+h} {x+dx},{y+h} {x},{y+h-dy} {x},{y+dy}")
        return self.raw(f'<polygon points="{pts}" {self._shape_fill(color, **kw)}/>')

    def parallelogram(self, x, y, w, h, color="blue", skew=0.18, **kw):
        """平行四辺形（入出力・データの流れ）。"""
        s = w * skew
        pts = f"{x+s},{y} {x+w},{y} {x+w-s},{y+h} {x},{y+h}"
        return self.raw(f'<polygon points="{pts}" {self._shape_fill(color, **kw)}/>')

    def cross(self, x, y, w, h, color="red", arm=0.34, **kw):
        """十字（プラス）。arm=腕の太さ比。"""
        ax, ay = w * arm, h * arm
        l, r, t, b = x, x + w, y, y + h
        x1, x2 = x + (w - ax) / 2, x + (w + ax) / 2
        y1, y2 = y + (h - ay) / 2, y + (h + ay) / 2
        pts = (f"{x1},{t} {x2},{t} {x2},{y1} {r},{y1} {r},{y2} {x2},{y2} "
               f"{x2},{b} {x1},{b} {x1},{y2} {l},{y2} {l},{y1} {x1},{y1}")
        return self.raw(f'<polygon points="{pts}" {self._shape_fill(color, **kw)}/>')

    def arrow(self, x, y, w, h, color="blue", direction="right", **kw):
        """ブロック矢印。direction='right'|'left'（FigJam の左右矢印）。"""
        hy1, hy2 = y + h * 0.28, y + h * 0.72  # 軸の上下
        head = w * 0.40
        cy = y + h / 2
        if direction == "left":
            pts = (f"{x},{cy} {x+head},{y} {x+head},{hy1} {x+w},{hy1} "
                   f"{x+w},{hy2} {x+head},{hy2} {x+head},{y+h}")
        else:
            pts = (f"{x+w},{cy} {x+w-head},{y} {x+w-head},{hy1} {x},{hy1} "
                   f"{x},{hy2} {x+w-head},{hy2} {x+w-head},{y+h}")
        return self.raw(f'<polygon points="{pts}" {self._shape_fill(color, **kw)}/>')

    def chevron(self, x, y, w, h, color="orange", notch=0.16, **kw):
        """シェブロン／ホームベース（工程・矢羽）。"""
        d = w * notch
        cy = y + h / 2
        pts = (f"{x},{y} {x+w-d},{y} {x+w},{cy} {x+w-d},{y+h} "
               f"{x},{y+h} {x+d},{cy}")
        return self.raw(f'<polygon points="{pts}" {self._shape_fill(color, **kw)}/>')

    def star(self, x, y, w, h, color="yellow", points=5, inner=0.42, **kw):
        """星。"""
        cx, cy = x + w / 2, y + h / 2
        rx, ry = w / 2, h / 2
        pts = []
        for i in range(points * 2):
            ang = -math.pi / 2 + i * math.pi / points
            f = 1.0 if i % 2 == 0 else inner
            pts.append(f"{cx + rx * f * math.cos(ang):.1f},{cy + ry * f * math.sin(ang):.1f}")
        return self.raw(f'<polygon points="{" ".join(pts)}" {self._shape_fill(color, **kw)}/>')

    def ellipse(self, cx, cy, rx, ry, color="green", **kw):
        """楕円・円（開始/終了・アクター）。"""
        return self.raw(f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" '
                        f'{self._shape_fill(color, **kw)}/>')

    def speech(self, x, y, w, h, color="blue", **kw):
        """吹き出し（コメント）。下辺左に尾を付けた角丸矩形。"""
        rx = 16
        bh = h * 0.78  # 本体高さ（残りが尾）
        tail_x = x + w * 0.24
        self.raw(
            f'<rect x="{x}" y="{y}" width="{w}" height="{bh}" rx="{rx}" '
            f'{self._shape_fill(color, **kw)}/>'
        )
        c = PALETTE[color]
        sw = STROKE.get(kw.get("weight", "thick"), kw.get("weight", "thick"))
        # 尾（本体と一体に見えるよう塗りで重ね、上辺の線は本体で隠す）
        tail = f"M{tail_x},{y+bh-2} L{tail_x},{y+h} L{tail_x+w*0.16},{y+bh-2} Z"
        self.raw(f'<path d="{tail}" fill="{c["bg"]}" stroke="{c["border"]}" '
                 f'stroke-width="{sw}" stroke-linejoin="round"/>')
        self.raw(f'<line x1="{tail_x-1}" y1="{y+bh-1}" x2="{tail_x+w*0.16+1}" '
                 f'y2="{y+bh-1}" stroke="{c["bg"]}" stroke-width="{float(sw)+1}"/>')
        return self

    def cloud(self, x, y, w, h, color="blue", **kw):
        """雲（インターネット・外部）。"""
        sx, sy = w / 100.0, h / 70.0
        path = ("M25,60 a20,20 0 0 1 -4,-39 a23,23 0 0 1 44,-7 "
                "a17,17 0 0 1 16,13 a16,16 0 0 1 -5,33 Z")
        self.raw(f'<g transform="translate({x},{y}) scale({sx},{sy})">'
                 f'<path d="{path}" {self._shape_fill(color, **kw)}/></g>')
        return self

    def node(self, cx, cy, label, emoji_cp=None, icon_name=None, shape=None,
             color="yellow", w=120, h=88, label_scale="heading"):
        """要素を1つの「ノード」として描く便利関数。中身は絵文字 / アイコン / 図形。
        - emoji_cp 指定: twemoji（カラー絵文字）＋下にラベル
        - icon_name 指定: Lucide ラインアイコン＋下にラベル
        - shape 指定: 指定図形＋中央ラベル（絵文字で表せない概念用）
        shape は cylinder/diamond/triangle/pentagon/hexagon/octagon/parallelogram/
        cross/arrow/chevron/star/ellipse/speech/cloud/sticky のいずれか。
        """
        x, y = cx - w / 2, cy - h / 2
        if shape:
            drawer = {
                "cylinder": self.cylinder, "diamond": self.diamond,
                "triangle": self.triangle, "pentagon": self.pentagon,
                "hexagon": self.hexagon, "octagon": self.octagon,
                "parallelogram": self.parallelogram, "cross": self.cross,
                "arrow": self.arrow, "chevron": self.chevron, "star": self.star,
                "speech": self.speech, "cloud": self.cloud,
            }
            if shape == "ellipse":
                self.ellipse(cx, cy, w / 2, h / 2, color=color)
            elif shape in ("sticky", "square"):
                self.sticky(x, y, w, h, color=color)
            else:
                drawer[shape](x, y, w, h, color=color)
            if emoji_cp:
                self.emoji(emoji_cp, cx - 26, cy - 34, 52)
            elif icon_name:
                self.icon(icon_name, cx - 22, cy - 30, 44, color=PALETTE[color]["text"])
            if emoji_cp or icon_name:
                self.text(cx, cy + 34, label, scale="label", fill=PALETTE[color]["text"])
            else:
                self.text(cx, cy + 7, label, scale=label_scale,
                          fill=PALETTE[color]["text"])
        elif emoji_cp:
            self.emoji(emoji_cp, cx - 40, cy - 48, 80)
            self.text(cx, cy + 52, label, scale=label_scale)
        elif icon_name:
            self.icon(icon_name, cx - 32, cy - 40, 64)
            self.text(cx, cy + 48, label, scale=label_scale)
        return self

    # --- コネクタ ---
    def _stroke(self, weight, dash, color):
        sw = STROKE.get(weight, weight)
        out = (f'stroke="{color}" stroke-width="{sw}" '
               f'stroke-linecap="round" stroke-linejoin="round"')
        da = DASH.get(dash)
        if da:
            out += f' stroke-dasharray="{da}"'
        return out

    def connector(self, x1, y1, x2, y2, label=None, primary=True,
                  curve=0, weight=None, dash="solid",
                  label_scale="label", label_dy=-10):
        """直線/カーブのコネクタ＋三角アローヘッド。
        primary=True で濃い主線、False で薄い副線（復路など）。
        weight: 'thick'|'thin'（既定は primary に追従）。dash: 'solid'|'dashed'。
        curve!=0 で制御点を上(負)/下(正)にずらした曲線。
        """
        color = LINE if primary else LINE_SUB
        marker = "aR" if primary else "aRsub"
        if weight is None:
            weight = "thick" if primary else "thin"
        st = self._stroke(weight, dash, color)
        if curve:
            mx, my = (x1 + x2) / 2, (y1 + y2) / 2 + curve
            d = f"M{x1} {y1} Q {mx} {my} {x2} {y2}"
            self.raw(f'<path d="{d}" fill="none" {st} marker-end="url(#{marker})"/>')
        else:
            self.raw(f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" {st} '
                     f'marker-end="url(#{marker})"/>')
        if label:
            lx, ly = (x1 + x2) / 2, (y1 + y2) / 2 + label_dy + (curve if curve else 0)
            self.text(lx, ly, label, scale=label_scale,
                      fill=INK if primary else SUBTLE)
        return self

    def elbow(self, x1, y1, x2, y2, label=None, primary=True, weight=None,
              dash="solid", first="h", label_scale="label", label_dy=-10):
        """エルボ（直角折れ）コネクタ。FigJam のステップ線。
        first='h' で先に水平→垂直、'v' で先に垂直→水平。
        """
        color = LINE if primary else LINE_SUB
        marker = "aR" if primary else "aRsub"
        if weight is None:
            weight = "thick" if primary else "thin"
        st = self._stroke(weight, dash, color)
        if first == "v":
            d = f"M{x1} {y1} V {(y1+y2)/2} H {x2} V {y2}"
        else:
            d = f"M{x1} {y1} H {(x1+x2)/2} V {y2} H {x2}"
        self.raw(f'<path d="{d}" fill="none" {st} marker-end="url(#{marker})"/>')
        if label:
            self.text((x1 + x2) / 2, (y1 + y2) / 2 + label_dy, label,
                      scale=label_scale, fill=INK if primary else SUBTLE)
        return self

    def biconnector(self, x1, y1, x2, y2, primary=False, weight=None, dash="solid"):
        """両端アローヘッドの双方向コネクタ（層間の往復など）。"""
        color = LINE if primary else LINE_SUB
        marker = "aR" if primary else "aRsub"
        if weight is None:
            weight = "thick" if primary else "thin"
        st = self._stroke(weight, dash, color)
        return self.raw(
            f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" {st} '
            f'marker-end="url(#{marker})" marker-start="url(#{marker})"/>'
        )

    # --- 出力 ---
    def svg(self):
        defs = (
            '<defs>'
            f'<marker id="aR" viewBox="0 0 10 10" refX="8" refY="5" '
            'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M0 1 L9 5 L0 9 z" fill="{LINE}"/></marker>'
            f'<marker id="aRsub" viewBox="0 0 10 10" refX="8" refY="5" '
            'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
            f'<path d="M0 1 L9 5 L0 9 z" fill="{LINE_SUB}"/></marker>'
            '</defs>'
        )
        return (
            f'<svg xmlns="http://www.w3.org/2000/svg" width="{self.w}" height="{self.h}" '
            f'viewBox="0 0 {self.w} {self.h}" font-family="{self.font}">\n'
            f'{defs}\n'
            f'<rect x="0" y="0" width="{self.w}" height="{self.h}" fill="{self.bg}"/>\n'
            + "\n".join(self.body)
            + "\n</svg>\n"
        )

    def save(self, path):
        p = pathlib.Path(path)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(self.svg(), encoding="utf-8")
        return str(p)


def _esc(s):
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def _text_width(s, size):
    """ラベル幅をざっくり見積もる（全角≒1em、半角≒0.55em）。取り消し線の長さ等に使う。"""
    w = 0.0
    for ch in str(s):
        w += size * (1.0 if ord(ch) > 0x2E7F else 0.55)
    return w
