# Kindle App Observations

Use the current computer-use tool documentation for API calls, permissions, and
state refreshes. These are app-specific observations, not fixed selectors or a
replacement for that documentation.

## Find and collect

- App-name resolution can fail even when Kindle is installed. Resolve its
  identifier from the app inventory and retry with that observed identifier.
- Open **Annotations**, inspect **Filter**, and select the requested color.
  Expand the annotations panel if it makes the list easier to read. Record the
  filtered total and scroll from the beginning through the end with overlap.
- The accessibility description can expose highlight text, color, and printed
  page number. Chapter headings help map passages to the reading note, but a
  heading at a viewport boundary may describe a neighboring entry; verify the
  section from the book when uncertain.
- The list is virtualized. Off-screen entries may be absent, and annotation
  ordinals can change after filtering. Neither a viewport nor an ordinal is a
  durable record of the full collection.
- **Export notebook** may invoke an email workflow instead of saving locally.
  If it requires an email account, cancel and read the annotations directly.
  Reading-note work does not authorize configuring Mail or sending the book's
  annotations elsewhere. Use an already available local export only when its
  selected color, coverage, and text can be verified.

## Open the actual reading page

- Selecting a highlight, a table-of-contents item, or **Go to Page** may open a
  page preview. The page label can change while the accessibility body still
  contains text from the previous reading page.
- Enter the highlighted preview page and confirm the body actually changed to
  the requested passage before using it as evidence. A changed page number is
  not sufficient.
- Printed page numbers can span several screenfuls. Read adjacent screenfuls
  until the passage and relevant context are visible; do not assume one arrow
  key press equals one printed page.
- Accessibility text can be truncated, flatten paragraphs, or read columns in
  the wrong order. Use screenshots to verify incomplete text, lists, figures,
  quote boundaries, and attributions. Do not silently infer missing prose.
- Group nearby highlights when reading context to avoid repeatedly opening the
  same pages. Keep context notes separate from the exact highlighted words.

## Leave source state intact

Navigate and read without recoloring, deleting, editing, or starring highlights.
Use fresh UI state for each decision; do not reuse captured element numbers
after a transition or hardcode screen coordinates from a previous session.
