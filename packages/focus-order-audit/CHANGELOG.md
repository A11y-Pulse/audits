# @a11y-pulse/focus-order-audit

## 0.2.0

### Minor Changes

- [#110](https://github.com/A11y-Pulse/audits/pull/110) [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Catch more focus order failures, and stop reporting text set in columns.
  
  - `@a11y-pulse/focus-order-audit`:
    - One backwards jump to or from an element with a positive `tabindex` is now enough to report a page, so a form given `tabindex="1"`, `"2"`, `"3"` part-way down the page is found.
    - New `backwards-drift` transition kind: a run of three or more short climbs that together exceed a viewport, such as a long list stacked with `column-reverse`, is reported as one transition spanning the run. The run carries on across steps part of the way back down, so a reversed feed whose cards each hold two stacked controls is found too.
    - A climb to the top of the next column (CSS multi-column text, or a grid filled column by column) is no longer a backwards jump, however tall the columns are, including text with links part-way along its lines and cards with two controls side by side. The next column has to start level with or below the columns before it, give or take its first element's height, and a move to or from a positive `tabindex` is never taken for a wrap.
    - Each transition now carries `distance` (reading-order pixels), `direction` (on screen) and `steps`, and each element its `rect` and, when it has one, its own `positiveTabindex`. `SequenceStop` accepts an optional `positiveTabindex` for callers of `findDisorder`.
  - `@a11y-pulse/audit-runner`: describe a backwards drift, say which way on screen focus went (backwards is sideways on a vertical page), and name the element whose positive `tabindex` is behind a move.

### Patch Changes

- Updated dependencies [[`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb)]:
  - @a11y-pulse/browser-adaptor@0.10.0
  - @a11y-pulse/tab-orchestrator@0.10.0

## 0.1.1

### Patch Changes

- [#92](https://github.com/A11y-Pulse/audits/pull/92) [`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - `focus-order` and `focus-color-only` results now carry only their WCAG and category tags.
- Updated dependencies [[`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319)]:
  - @a11y-pulse/browser-adaptor@0.8.0

## 0.1.0

### Minor Changes

- [#86](https://github.com/A11y-Pulse/audits/pull/86) [`2ab8af6`](https://github.com/A11y-Pulse/audits/commit/2ab8af68a62573b054b3695f26ff8300ef636af8) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add the experimental `@a11y-pulse/focus-order-audit`, which rides the shared tab loop and flags pages whose focus repeatedly jumps a long way against the reading order, as a review prompt for WCAG 2.4.3 Focus Order. The audit runner reports it as `focus-order` in `incomplete`, tagged `experimental`.

### Patch Changes

- Updated dependencies [[`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e), [`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e), [`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e)]:
  - @a11y-pulse/browser-adaptor@0.6.0
  - @a11y-pulse/tab-orchestrator@0.7.0
