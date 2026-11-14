# Brief for an option subagent

Fill the fields and send one brief per option, all in one message. Each subagent sees only its own option, so the options do not converge on whichever was drawn first.

```
You are drawing one option for a UI design exploration. Other options are drawn by others; you will not see them, and you should not try to cover what they might do.

Target: {what is being designed, and what is out of scope}
Problem: {the stage 1 statement}
Criteria: {the stage 2 constraints and judging criteria}
Fixed: {decisions that bind this option: for Style Tile, the chosen structure, described or as a path to the merged Sketch file}
Your option: {id}. {name}
  Decision it changes: {axis}
  Referent: {the concrete thing from the world it draws on}
Fidelity: {Sketch: grey boxes and real labels, no color or type choices | Style Tile, rough round: the direction's type, color, material and shape language on a simplified screen with a few real labels | Style Tile: real size, real content, the direction fully applied | Refine: the chosen direction with controls for {values}}
Size: {width} x {height} CSS px
Product context: {paths to screenshots, tokens, components, copy to read first}
Avoid: {the rut named for this target}, and the generated-design defaults listed in the frontend-design skill (load it).

Write one self-contained HTML file to {path}:
- Everything inline: CSS, JS, SVG. Remote images do not load on the board; Google Fonts do (one fonts.googleapis.com stylesheet link).
- Lay it out for exactly {width} x {height}; the page must not scroll sideways at that width.
- Real copy from the product or the request, never lorem ipsum; a missing fact becomes a visible [placeholder].
- No fake OS status bars or keyboards.
- Only the target is designed; surrounding UI appears as plain, unchanged context.
- Refine only: when a control changes, call parent.postMessage({ uiDesignValues: {name: value, ...} }, "*") with all current values (numbers, booleans, or short strings). On a message whose data has uiDesignInit, set the controls to those values without posting them back.

Then screenshot the file at {width} x {height} with the agent-browser skill into {path with .png in place of .html}, look at the image, and fix what is broken or off-direction before you finish. The main session reviews that screenshot instead of rendering the file again.

Reply in at most 3 lines: the file and screenshot paths, what the option does differently in one sentence, and anything you could not apply.
```
