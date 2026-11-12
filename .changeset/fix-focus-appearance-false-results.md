---
"@a11y-pulse/focus-appearance-audit": minor
"@a11y-pulse/tab-orchestrator": minor
"@a11y-pulse/audit-runner": patch
---

Fix focus appearance false passes and false failures.

- `@a11y-pulse/focus-appearance-audit`:
  - A focused element that draws nothing itself (fully transparent, clipped to a pixel or positioned off the page, as the real input of a custom checkbox, radio or switch usually is) no longer passes on the browser's default outline. Its label, or else its nearest visible ancestor, is compared with and without focus instead; `measuredOn` says which.
  - Outlines, borders and box-shadows drawn in a fully transparent colour (`outline: 2px solid transparent`) and pseudo-elements that generate no content are no longer counted as indicators.
  - The text caret is hidden in the screenshots on every engine. A text field that shows only its caret on focus is reported with `detectionMethod: "caret"` and `needsReview: "caret"`.
  - Before an element fails, the styles of its three nearest ancestors and its labels are compared, so an indicator on a `:focus-within` wrapper or a label passes; `indicatorOn` says where it was found. A wrapper that holds other tab stops too (an input group) does not say which of them has focus, and one with a CSS animation running differs from one read to the next regardless: an element with nothing else to show is reported with `needsReview: "shared-indicator"` or `needsReview: "animating"` instead of passing.
  - For a hidden input with a label, the screenshots also take in the input's nearest visible ancestor, so an indicator drawn on a sibling box away from the label is found.
  - CSS transitions are given up to half a second to finish before each screenshot, so an indicator that fades in is compared in its final state.
  - An element that stays covered by other content while it is measured is reported with `needsReview: "obstructed"` instead of failing.
  - `colorOnly` now also covers an existing border, an existing outline or the background changing colour alone, and gains `property` and `backgroundColor`. A background that is see-through in one state is measured against the colour behind the element.
  - New `changedProperties` on style passes, `summary.needsReview` and `summary.reachedScreenshotLimit`. `summary.passed` and `summary.failed` no longer include elements that need review.
  - New `screenshotLimit` option (default 50) caps how many elements keep their screenshots.
- `@a11y-pulse/tab-orchestrator`: an unfocused pair photographs the label or nearest visible ancestor of an element that draws nothing itself, hides the text caret, and reports `clipTarget`, `unpainted`, `obstructed`, `caretHidden`, `context` (the surrounding elements' styles with and without focus, each marked `shared` or `animating` where that applies) and `background`. With a label as the target, the pair also covers the element's nearest visible ancestor. Running transitions are waited for, and a capture that fails part-way puts the page back and returns focus before rethrowing. `opacity` joins `FOCUS_STYLE_PROPERTIES`.
- `@a11y-pulse/audit-runner`: `focus-appearance` reports caret-only text fields, covered elements, and elements whose only indicator is on a shared or animating container as `incomplete`, and `focus-color-only` names which colour changed and what it is seen against.
