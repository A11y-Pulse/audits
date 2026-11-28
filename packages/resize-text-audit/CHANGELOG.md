# @a11y-pulse/resize-text-audit

## 0.12.1

### Patch Changes

- Updated dependencies []:
  - @a11y-pulse/browser-adaptor@0.12.1
  - @a11y-pulse/text-spacing-audit@0.12.1

## 0.12.0

### Patch Changes

- Updated dependencies []:
  - @a11y-pulse/browser-adaptor@0.12.0
  - @a11y-pulse/text-spacing-audit@0.12.0

## 0.2.0

### Minor Changes

- [`d043260`](https://github.com/A11y-Pulse/audits/commit/d04326086b8afa9b30c14ba11e92ebbb9d1fad0d) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Type `evaluate` from the page function it runs. `BrowserAdaptor.evaluate` and the reflow, resize text, skip link and text spacing adaptors now take `evaluate<F extends PageFunction>(fn: F, ...args: EvaluateArgs<Parameters<F>>)` and resolve to `Awaited<ReturnType<F>>`, where `EvaluateArgs` maps each element parameter to an `ElementRef`. `PageFunction` and `EvaluateArgs` are exported from `@a11y-pulse/browser-adaptor`.
  
  `@a11y-pulse/tab-orchestrator`: `TabConsumer<C>` and `TabStopSnapshot<C>` take the capabilities a consumer declares, so a consumer declaring `obscuring` or `contextSignals` receives those fields as required. A `contextSignals` consumer is promised only `contextSignals`, because it is also shown elements that gave focus away. The bare `TabConsumer` and `TabStopSnapshot` are unchanged. `TabSessionHandle.screenshotContext` is now required. The context observer no longer marks the audited page with a `data-a11y-ctx-attr` attribute, a cleanup failure other than the page navigating away now fails the session, and `elementStylesScript` with no properties returns empty pseudo-element records.
  
  `@a11y-pulse/context-change-on-focus-audit` and `@a11y-pulse/focus-not-obscured-audit`: the audits' types carry their declared capabilities, and the focus not obscured audit always screenshots the context strip around an obscured element rather than falling back to a clip of the element alone.

### Patch Changes

- Updated dependencies [[`d043260`](https://github.com/A11y-Pulse/audits/commit/d04326086b8afa9b30c14ba11e92ebbb9d1fad0d)]:
  - @a11y-pulse/browser-adaptor@0.11.0
  - @a11y-pulse/text-spacing-audit@0.5.0

## 0.1.0

### Minor Changes

- [#113](https://github.com/A11y-Pulse/audits/pull/113) [`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/resize-text-audit`, an audit for WCAG 1.4.4 Resize Text.
  
  - It halves the CSS viewport, which is the layout a page gets at 200% browser zoom, and reports text that the zoomed layout cuts off (`clipped`) or lays over other text (`overlap`), with the clipping element, the overflow in px, rects and a screenshot taken while zoomed.
  - Text that only the zoomed layout renders (a header behind a `max-width` media query) is measured too. With no full-size measurement to compare it with, text among it that a box cuts into is reported with `noBaseline` and is meant for review.
  - Text that can still be scrolled to, text an ellipsis or line clamp truncates, text that was already cut off, and content the narrow layout hides outright (an off-canvas menu) are not reported.
  - Overlap counts text only as far as its clipping ancestors leave it showing, so the part of a title that an ellipsis hides does not overlap what it lies under, while text whose `text-overflow` has nothing to act on is compared like any other.
  - The bundled adaptors read the window's own size when no viewport is being emulated (`defaultViewport: null`), and the Puppeteer adaptor drops its emulation again when the audit is done.
  - The result carries the page's viewport meta tag and whether it stops users zooming (`user-scalable=no`, `maximum-scale` below 2).
  
  The text measurement is shared with the text spacing audit, which now exports its page scripts from `@a11y-pulse/text-spacing-audit/measure`, adds a `remeasureScript` that re-measures without applying the spacing override (and can collect the candidates again under the styles that now apply), and describes how each finding's element is currently styled (`overflowX`, `overflowY`, `truncates`, `visible`). The text spacing audit uses that description to drop overlaps in which either element cannot be seen, such as a closed menu faded out with `opacity: 0`.

### Patch Changes

- [#114](https://github.com/A11y-Pulse/audits/pull/114) [`12583d4`](https://github.com/A11y-Pulse/audits/commit/12583d478a46af27bfa173f6233357840e2e6d68) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Run the new audits from the audit runner. `runAllAudits` and the CLI now also report `focus-indicator-contrast` (WCAG 1.4.11, read from the focus appearance audit's measurements), `keyboard-reachability` and `control-without-role` (WCAG 2.1.1 and 4.1.2, sharing the tab pass), `accessible-authentication` (WCAG 3.3.8), `resize-text` (WCAG 1.4.4), `moving-content` (WCAG 2.2.2) and `disclosure-operability` (WCAG 2.1.1 and 4.1.2). The moving content audit watches the page for five seconds, so every run now takes at least that long.
  
  Audits can be left out with the new `--skip <ids>` flag or the `skip` option, by the ids in the exported `AUDIT_IDS` (`--list-audits` prints them); a skipped audit does no work and is not reported, and an unknown id is an error. `AuditAdaptors` gains two optional adaptors, `unreachableControls` and `resizeText`. The resize text audit is reported as `inapplicable` from a viewport narrower than 640 CSS px. The evidence of `focus-indicator-contrast` now carries the measurement in `data` on every node, `moving-content-evidence` names its `finding` as `reason`, and `disclosure-operability-evidence` includes `signals`.
  
  `@a11y-pulse/resize-text-audit`: text that an ellipsis or line clamp cuts short is no longer reported as overlapping the element its unclipped length would reach.
- Updated dependencies [[`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`b5ef317`](https://github.com/A11y-Pulse/audits/commit/b5ef317b28ef92ed3d7712f71c169a2e191f2f0f)]:
  - @a11y-pulse/browser-adaptor@0.10.0
  - @a11y-pulse/text-spacing-audit@0.4.0
