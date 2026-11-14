---
name: ui-design
description: >-
  Runs a UI design exploration with the user in six stages (Define, Criteria,
  Sketch, Style Tile, Refine, Validate), showing options as HTML mockups on one
  private artifact page where the user picks options inside the page. For
  deciding how a screen or component should be structured and look before it is
  built. Not for implementing a decided design (/plan, /do) or for open-ended
  consultation (/consult). Manual trigger: /ui-design.
argument-hint: "[screen, component, or UI problem]"
disable-model-invocation: true
---

# UI Design

The user explores UI with mockups to widen the options and then narrow them. Earlier explorations failed the same ways each time: Claude's recommendations on looks missed while its structural ones landed; "variations" changed widths and opacities inside one visual vocabulary; replies jumped between stages, re-showed options already seen, and pulled in parts outside the target; decisions fell out of the conversation. The stages and rules below exist to stop those failures. Each option must differ in a decision, every decision is written on the page, and the user judges looks.

## Stages

| # | Stage | Settles | Output | Mock fidelity |
|---|---|---|---|---|
| 1 | Define (`問題定義`) | What is designed, why, and what is out of scope | A 1–2 line problem statement with target and out-of-scope | None |
| 2 | Criteria (`判断基準`) | Constraints, what "good" means here, assumptions | Constraints (platform, technical), judging criteria, guesses marked as guesses | None |
| 3 | Sketch (`スケッチ`) | Structure and behavior | 3–5 options that differ in structure, then Merge | Low: grey boxes, real labels, no color or type choices |
| 4 | Style Tile (`スタイルタイル`) | Visual direction on the fixed structure | References chosen first, then directions that differ in a named decision (up to 10 rough ones in a first round, 3–6 at real size), then Merge | A rough round: the direction's type, color and material on a simplified screen. Then the chosen structure at real size with real content |
| 5 | Refine (`詳細化`) | Exact values | One direction with its values tuned in the page | High, real size, controls for the open values |
| 6 | Validate (`検証`) | Whether it meets the criteria | Critique against stage 2, a device check where feel matters, the handoff | The final mock |

Start at the first stage the request leaves unsettled. A stage the request or the codebase already settles is recorded as a decision with its source, not re-asked: a request that names the screen and its job skips Define, and a restyle of a screen whose structure stays skips Sketch. A request that does not touch looks ends after Sketch and goes to Validate.

Merge ends Sketch and Style Tile: read the user's picks and notes, keep the parts they liked, and vary only the parts they disliked; combine parts of different options when the notes ask for it. Picking a single winner is a special case of Merge, not its goal.

## Rules for every reply

1. **Open with the stage and what is fixed.** The first line names the stage (`段階 4/6 スタイルタイル`) and the decisions that bind it, so the user always knows what is being decided now. Mixing stages left the user unable to tell what a reply asked of them.
2. **Stay in the stage.** Answer a request to widen with new rough options, not a detailed spec; answer a request for detail with the chosen direction only. When a later stage shows an earlier decision is wrong, say which stage you return to and why, then go back there explicitly.
3. **Keep to the target.** Only what Define put in scope is designed. Neighboring parts appear only as unchanged context. A new idea outside the target is offered in one line, not drawn.
4. **Show only new options.** A round never re-shows an option the user has already judged, unless they ask to compare.
5. **Write decisions down at once.** When the user decides something, add it to `decisions` in `board.json` with what it was chosen over, and rebuild the page. Leave `over` out when no real alternative was on the table; an invented one hides which choices were actually made. Read `board.json` at the start of every stage: after compaction the conversation may no longer hold what was decided.
6. **Ask with candidates.** For taste questions (which references, what feels off) offer concrete candidates to pick from; asking the user to come up with refined examples from scratch was a burden they named. Ask at most three questions, at the end of the reply. Text choices go through `AskUserQuestion`; visual choices go on the board.
7. **Recommend structure, not looks.** In Define, Criteria and Sketch, give a recommendation and its reason. In Style Tile and Refine, give every option an honest motivation and its main tradeoff and rank none: a case made only for a favorite is a rigged vote, and Claude's look picks matched the user's choice in a minority of past rounds.
8. **Ground in the real product, but do not mistake it for a direction.** Before Sketch, read the existing UI (screenshots, tokens, components) and design at its real sizes. In Style Tile, the current look is at most one option among others: the user has disliked restyles that only matched the existing parts.

## Diverging in Sketch and Style Tile

Before drawing, write one line per option: the decision it changes and a concrete referent from the world, such as "an instrument scale with a fixed brand index" or "a museum label system", never adjectives like "clean and modern".

- **Sketch decisions**: navigation model, layout topology, what is primary, interaction model, how much is visible at rest.
- **Style Tile decisions**: material or worldview, type voice, color strategy, shape language, density, motion character. Load the `frontend-design` skill here for its list of generated-design defaults to steer away from.

Read the lines side by side before rendering. Replace one of any two options that change the same decision or whose lines rhyme. Name the rut for this target (the category's default look and its obvious opposite) and keep both out unless the user asks for them. An option is too close to another when its headline or main control could be swapped into the other unnoticed.

Render each option in its own subagent, all dispatched in one message, with `references/variant-brief.md`. A fresh context per option keeps earlier options from anchoring later ones and keeps the HTML out of the main context. Dispatch `general-purpose` with `model: sonnet` in Sketch and in a rough Style Tile round, where the option's decision is given and the drawing is a simplified screen, and with `model: opus` for Style Tile at real size and Refine, where the drawing itself is the visual judgment.


## Refine

Show one direction at real size with controls for the values still open. The variant reports tuned values to the board (see `references/board.md`), so the user does not copy numbers. Record the chosen values as decisions.

A browser mock cannot show how a touch target or a motion feels on a device. When the remaining question is feel, say so and propose a throwaway device build instead of more mock rounds: a past exploration chose a look in the browser that the device then overturned.

## Validate

Dispatch the critic (`general-purpose`, `model: opus`) with `references/critic-brief.md`, the final screenshots and the stage 2 criteria. Report its findings with evidence; the user decides what to change. Then hand off:

- the decisions from `board.json`, each with what it was chosen over;
- what is still open and how to settle it;
- the board's URL.

Suggest `/plan` or an Issue for the implementation. This skill does not implement.

## The board

Read `references/board.md` before the first round. In short:

- One private artifact holds the whole exploration and is updated in place; earlier rounds stay on it, folded.
- `board.json` and the option files live in the session scratchpad under `ui-design/<slug>/`, and `~/.claude/skills/ui-design/scripts/build-board.ts <dir>` writes the page. `board.json` also keeps the artifact's slug and latest version, so a compacted or new session updates the same page.
- The user picks options and writes notes in the page, then says so in chat. Read the picks with `db_get` on `rounds/<round id>`.

Before a round goes on the board, look at each option's screenshot (the option subagent saves it next to the file) and fix or drop one that renders broken; a past exploration showed mocks nobody had looked at. In Style Tile, also run the critic on the round's screenshots with only its first question (authored for this product, or interchangeable with any product in the category?) and replace an option it calls interchangeable before the user sees it.
