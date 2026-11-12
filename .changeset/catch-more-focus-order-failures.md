---
"@a11y-pulse/focus-order-audit": minor
"@a11y-pulse/audit-runner": patch
---

Catch more focus order failures, and stop reporting text set in columns.

- `@a11y-pulse/focus-order-audit`:
  - One backwards jump to or from an element with a positive `tabindex` is now enough to report a page, so a form given `tabindex="1"`, `"2"`, `"3"` part-way down the page is found.
  - New `backwards-drift` transition kind: a run of three or more short climbs that together exceed a viewport, such as a long list stacked with `column-reverse`, is reported as one transition spanning the run. The run carries on across steps part of the way back down, so a reversed feed whose cards each hold two stacked controls is found too.
  - A climb to the top of the next column (CSS multi-column text, or a grid filled column by column) is no longer a backwards jump, however tall the columns are, including text with links part-way along its lines and cards with two controls side by side. The next column has to start level with or below the columns before it, give or take its first element's height, and a move to or from a positive `tabindex` is never taken for a wrap.
  - Each transition now carries `distance` (reading-order pixels), `direction` (on screen) and `steps`, and each element its `rect` and, when it has one, its own `positiveTabindex`. `SequenceStop` accepts an optional `positiveTabindex` for callers of `findDisorder`.
- `@a11y-pulse/audit-runner`: describe a backwards drift, say which way on screen focus went (backwards is sideways on a vertical page), and name the element whose positive `tabindex` is behind a move.
