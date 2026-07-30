---
name: draw-figure
description: Generates FigJam-style self-contained SVG concept figures by mapping natural-language descriptions onto image schemas (embodied spatial structures such as SOURCE-PATH-GOAL, CONTAINER, CYCLE) with twemoji as the actors. Use when inserting concept, architecture, or flow figures into documents or articles. Triggers include "/draw-figure <description>", "generate a concept figure", "draw a diagram for this explanation", "〜の図を作って", "この説明に図を入れて", "概念図を描いて".
argument-hint: "[description]"
license: MIT
metadata:
    github-path: .
    github-ref: refs/heads/main
    github-repo: https://github.com/seekseep/genfig-skill
    github-tree-sha: 9d094e8704826f62937f2dcb3dff960f54cad7c5
    repository: seekseep/genfig-skill
---

# draw-figure — Image-Schema Figure Generator

Map a natural-language description onto **image schemas** (recurring spatial
structures grounded in bodily experience — Johnson, *The Body in the Mind*;
Lakoff & Johnson, *Metaphors We Live By*), then draw that structure as an SVG
figure with **twemoji as the actors**.

Example: "ブラウザがサーバーにリクエストしたらレスポンスが返ってくる"
→ SOURCE-PATH-GOAL (origin → path → destination) + CYCLE (round trip)
→ two nodes side by side with two round-trip arrows.

## Output Rules

1. **Self-contained single SVG.** twemoji (color emoji) and Lucide (line icons)
   are fetched, cached, and inlined by `genfig.py` — never referenced by
   external `href`. The figure renders anywhere: GitHub, markdown, Astro.
2. **Japanese labels.** Pick fonts from the FigJam-style `FONTS` families
   (simple / formal / technical / cute); default is `simple` (gothic).
3. **Token-based font scale.** Never hardcode sizes — use only `SCALE` keys,
   addressable by FigJam size aliases (sm/md/lg/xl/xxl) or semantic aliases
   (display/title/heading/label/body/caption).
4. **FigJam-style design.** Pale fill + dark border shapes, two stroke weights
   (thin/thick) × line styles (solid/dashed), generous whitespace, 8 hues × 2
   levels + 4 grayscale steps (`PALETTE` / `INK_SCALE`).
5. **Always inspect the render.** Convert to PNG with `magick` and Read the
   image to check for overflow, overlap, and clipping before placing it.

## Generation Steps

Steps 1–4 decide *what* to draw; steps 5–7 decide *how*.

1. **Extract entities** — list the actors appearing in the description.
2. **Determine relations** — identify relations between entities (send /
   contain / split / oppose …) and map them to image schemas (composable).
   See `references/schemas.md`.
3. **Limit element count** — pick the protagonists (2–6 elements). The limit
   counts drawn actor nodes only; container frames, phase annotations,
   connector labels, and small decorative emoji attached to a connector are
   not elements. Omitted entities are recovered in the article-side caption
   (the italic `*図: ...*` line placed after the image), not inside the SVG;
   omitted route intermediaries may alternatively be folded into a connector
   label (e.g. "CDN・LB経由").
4. **Choose relations to draw** — narrow the relations and fix direction and
   primacy (outbound/return, strong/weak).
5. **Assign emoji and shapes** — give each entity a twemoji
   (`references/twemoji.md`); fall back to shapes for abstract concepts.
6. **Lay out elements** — place coordinates following the schema's layout
   guideline with generous whitespace.
7. **Draw relations** — connect with `connector` / `biconnector` and label.

Implement steps 5–7 as a short build script that imports `genfig.py`.

## Emoji vs Shapes

Try an emoji first; fall back to a FigJam-style shape when the concept is too
abstract for one. Both are placed uniformly via `node()`.

| Concept | Representation | API |
|---|---|---|
| Concrete object (browser, key, file) | twemoji | `emoji()` / `node(emoji_cp=...)` |
| Database | cylinder | `cylinder()` / `node(shape="cylinder")` |
| Decision / branch | diamond | `diamond()` |
| Process / service unit | hexagon | `hexagon()` |
| Input/output, data flow | parallelogram | `parallelogram()` |
| Start/end, actor, state | ellipse | `ellipse()` |
| Internet / external | cloud | `cloud()` |
| Frame / group / container | rounded rect | `sticky()` |

Shapes take FigJam sticky colors (`PALETTE`). Shape + emoji combos are fine:
`node(shape=..., emoji_cp=...)` — use the combo when the abstract concept has
a concrete metaphor worth showing (🔧 for refactoring, 🚀 for speed); use the
shape alone when no emoji genuinely fits.

## Drawing with genfig.py

Import `genfig.py` from this skill's **base directory** (the path shown when
this skill loads) and build with `Canvas`. Never hand-write raw SVG strings —
scale and style consistency breaks.

Write the build script to the **scratchpad directory** (or a temp dir), never
into this skill's directory. Save the output SVG outside this skill's
directory too. **Never run `examples/*.py` in place** — it would overwrite the
tracked sample SVG; copy it to the scratchpad first if you want to run it.

```python
import sys
sys.path.insert(0, "<this skill's base directory>")
from genfig import Canvas

c = Canvas(760, 300)
c.emoji("1f310", 80, 110, 80)                       # 🌐 ブラウザ
c.text(120, 215, "ブラウザ", scale="heading")
c.emoji("1f5a5", 600, 110, 80)                      # 🖥️ サーバー
c.text(640, 215, "サーバー", scale="heading")
c.connector(190, 120, 565, 120, label="リクエスト", primary=True)
c.connector(570, 180, 195, 180, label="レスポンス", primary=False)
c.save("out.svg")                                   # save to scratchpad, not here
```

Main API:
- `Canvas(w, h)` / `.save(path)` / `.svg()`
- `.emoji(cp, x, y, size)` — cp accepts `"1f310"` or `"🌐"`
- `.text(x, y, s, scale=..., align=..., fill=...)` — scale is a `SCALE` key only
- `.sticky(x, y, w, h, color=...)` — color is a `PALETTE` key
- Shapes: `.cylinder` `.diamond` `.hexagon` `.parallelogram` `.ellipse(cx,cy,rx,ry)` `.cloud`
- `.node(cx, cy, label, emoji_cp=..., shape=..., color=...)` — one element as emoji or shape
- `.connector(x1,y1,x2,y2, label=..., primary=..., curve=...)` — one-way arrow;
  `curve` offsets the midpoint vertically (negative = bulge up, positive =
  bulge down), so ring layouts approximate arcs with diagonal lines + curve
- `.biconnector(x1,y1,x2,y2)` — two-way arrow

Labels are single-line — `text()` has no wrapping, so widen the shape (`w=`)
or shorten the label instead of embedding newlines.

Full worked example: `examples/request-response.py`. Token definitions live at
the top of `genfig.py`.

First run fetches twemoji / Lucide icons from the jsDelivr CDN and caches them
under this skill's directory (offline runs are limited to cached icons).

## Generate → Verify → Place

```sh
python3 <scratchpad>/build-figure.py          # generate SVG
magick <scratchpad>/out.svg <scratchpad>/out.png
```

Read the PNG and inspect for overflow, overlap, and clipping. For documents,
place the figure in an `images/` folder next to the article and reference it
by relative path. Fonts are NOT embedded in the SVG — text metrics vary across
viewers' systems, so prefer exporting PNG for publication when layout fidelity
matters. Add the generation spec just before the image and an italic caption
(`*図: ...*`) just after, so the figure is easy to regenerate later.

## Schema Quick Reference

SOURCE-PATH-GOAL / LINK / CYCLE / CONTAINER / VERTICALITY / CENTER-PERIPHERY /
PART-WHOLE / FORCE (COMPULSION, BLOCKAGE, COUNTERFORCE) / BALANCE / SCALE /
SPLITTING / MERGING / NEAR-FAR / CONTACT — recognition cues and layout
guidelines are in `references/schemas.md`.
