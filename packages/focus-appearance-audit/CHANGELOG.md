# Changelog

## 0.7.0

### Minor Changes

- [#110](https://github.com/A11y-Pulse/audits/pull/110) [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Check the contrast of focus indicators (WCAG 1.4.11 Non-text Contrast).
  
  - `@a11y-pulse/focus-appearance-audit`: each element whose indicator can be measured gains `indicatorContrast`: the ratio, the two colours, what they were compared against and how they were found. The indicator is compared with the colours next to it, as 1.4.11 asks, not with how the element looked before focus: an outline or box-shadow outside the element with the background behind the element; an inset shadow or an outline pulled inside by a negative `outline-offset` with the element's own fill; a border with either; a background fill with the surroundings; an indicator found only in the screenshots with the unchanged pixels next to it. Text colour is never measured. Where the unfocused colour of the measured part is known, `stateChangeRatio` gives the contrast between the two states, for information only. The ratio is `null`, with a `reason`, for translucent colours, when too little changed, when what is next to the indicator has no single colour, and when a weak indicator was still transitioning in; over an image or gradient, or for an element positioned over other content, the screenshots are used. The browser's default focus ring is not measured, however it was found. `summary.lowContrastIndicators` counts indicators under the new `MIN_INDICATOR_CONTRAST` (3), less those whose only change is one colour that `colorOnly` measured; the new `hasLowContrastIndicator` is the test. `passed` is unaffected.
  - `@a11y-pulse/tab-orchestrator`: when styles are read, a tab stop's `activeElement` also carries `backdrop` (the first opaque background colour behind the element, or `null` when it cannot be told from the ancestors: behind an image or translucent colour, or for an element positioned out of the flow) and `animating` (a transition or animation was running on or around it). `outline-offset` joins `FOCUS_STYLE_PROPERTIES`.
  - `@a11y-pulse/audit-runner`: new `focusIndicatorContrastToAxe` mapping for the `focus-indicator-contrast` audit. An element whose only focus change is one colour is left to `focus-color-only` when that audit measured the change, and reported here when it could not.

- [#110](https://github.com/A11y-Pulse/audits/pull/110) [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Fix focus appearance false passes and false failures.
  
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

### Patch Changes

- Updated dependencies [[`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb)]:
  - @a11y-pulse/browser-adaptor@0.10.0
  - @a11y-pulse/tab-orchestrator@0.10.0

## 0.6.0

### Minor Changes

- [#97](https://github.com/A11y-Pulse/audits/pull/97) [`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Screenshot colour-only focus indicators. When the text colour change is under 3:1 or cannot be measured, `colorOnly.evidence` holds the element's focused and unfocused screenshots. `MIN_LIGHTNESS_CONTRAST` is now exported from `@a11y-pulse/focus-appearance-audit`. The audit runner attaches the screenshots to `focus-color-only` results as `focus-color-only-evidence`.

### Patch Changes

- Updated dependencies [[`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5), [`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5)]:
  - @a11y-pulse/tab-orchestrator@0.9.0
  - @a11y-pulse/browser-adaptor@0.9.0

## 0.5.0

### Minor Changes

- [#90](https://github.com/A11y-Pulse/audits/pull/90) [`37f1354`](https://github.com/A11y-Pulse/audits/commit/37f135426322697d3bb11b7e52147a0f9d6b7bfc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Flag focus indicators that rely on a change of text colour alone. When the text colour is the only painted change on focus, `@a11y-pulse/focus-appearance-audit` adds a `colorOnly` entry with both colours and the contrast ratio between them. The audit runner reports these as `focus-color-only` for WCAG 1.4.1 Use of Color, tagged `experimental`: under 3:1 in `violations`, unmeasurable colours in `incomplete`.

### Patch Changes

- Updated dependencies [[`37f1354`](https://github.com/A11y-Pulse/audits/commit/37f135426322697d3bb11b7e52147a0f9d6b7bfc)]:
  - @a11y-pulse/browser-adaptor@0.7.0

## 0.4.0

### Minor Changes

- [#52](https://github.com/A11y-Pulse/audits/pull/52) [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Make `@a11y-pulse/browser-adaptor` the single home for the browser primitives that `@a11y-pulse/tab-orchestrator` had forked: `BrowserAdaptor`, `ElementRef`, `Rect`, `PuppeteerAdaptor`, `bufferedClip`, `getSelector` and `truncateHtml`. The copies were byte-identical and had already started to drift.
  
  `BrowserAdaptor` gains the `scale` parameter and optional `screenshotClipScale` that `ReflowAuditAdaptor` and `TextSpacingAuditAdaptor` already had, and the shared `PuppeteerAdaptor` picks up the fork's `screenshotClipScale = 2`, `optimizeForSpeed` and `clip.scale`.
  
  **Breaking:** `@a11y-pulse/tab-orchestrator` no longer exports `BrowserAdaptor`, `ElementRef`, `Rect`, `bufferedClip`, `getSelector`, `truncateHtml` or `TruncateHtmlOptions`, and its `./puppeteer` subpath is gone. Import them from `@a11y-pulse/browser-adaptor` (or `@a11y-pulse/browser-adaptor/dom` for `getSelector` and `truncateHtml`), and add that package to your dependencies. The tab-orchestrator no longer declares `puppeteer` as a peer dependency, since it ships no adaptor of its own.
  
  **Breaking:** `BrowserAdaptor` requires `pressEnter`, which the tab-orchestrator's fork did not declare. The bundled adaptors already implement it; a hand-written adaptor passed to `createTabOrchestrator` needs to add it, even though the tab loop itself never presses Enter.
  
  The audit packages re-export the same type names as before, so `FocusAppearanceAuditAdaptor` and friends are unchanged for their callers.

### Patch Changes

- [#52](https://github.com/A11y-Pulse/audits/pull/52) [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Document which browser engines each audit is verified against, and point the adaptor docs at `@a11y-pulse/browser-adaptor`, which now owns both the `BrowserAdaptor` interface and the bundled Puppeteer and Playwright implementations.
- Updated dependencies [[`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04), [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04), [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04)]:
  - @a11y-pulse/browser-adaptor@0.4.0
  - @a11y-pulse/tab-orchestrator@0.6.0

## 0.3.1

### Patch Changes

- [#44](https://github.com/A11y-Pulse/audits/pull/44) [`94c45ef`](https://github.com/A11y-Pulse/audits/commit/94c45ef081b9dde56a0b0d11eff4a6e303c93d2b) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/audit-runner`, a worked example that runs every audit against a page and ships an `npx @a11y-pulse/audit-runner [url]` CLI that outputs JSON results.
  
  Each audit package now also declares a `source` export condition, matching `@a11y-pulse/tab-orchestrator`, so cross-package typechecking resolves to source and no longer depends on workspace build order.

## 0.3.0

### Minor Changes

- [`dbdabe9`](https://github.com/A11y-Pulse/audits/commit/dbdabe9ca3f435fe273568b4b786ad83b022083c) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Republish with the `tab-orchestrator`-based orchestration, `FocusElementResult.failureEvidence`, and `StyleSnapshot`/`FocusFailureEvidence` exports. The previous `0.2.0` published to npm predated the monorepo conversion and did not include these; this version corrects the drift between the registry and this repo's `main`.

## 0.2.0

### Minor Changes

- [#24](https://github.com/A11y-Pulse/audits/pull/24) [`6863b2e`](https://github.com/A11y-Pulse/audits/commit/6863b2eac852a2b54301d645c342f742b4edd6dc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Extract `@a11y-pulse/tab-orchestrator` and run focus-appearance as a consumer. Import `PuppeteerAdaptor` from `@a11y-pulse/tab-orchestrator/puppeteer`.

### Patch Changes

- [#20](https://github.com/A11y-Pulse/audits/pull/20) [`dd1fa04`](https://github.com/A11y-Pulse/audits/commit/dd1fa043ce9ae83a20d292c0336e4036d71ae0cc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/browser-adaptor` with shared `BrowserAdaptor`, `PuppeteerAdaptor`, and DOM helpers. Point `@a11y-pulse/focus-appearance-audit` at the workspace package and re-export the public adaptor types for back-compat.
- Updated dependencies [[`6863b2e`](https://github.com/A11y-Pulse/audits/commit/6863b2eac852a2b54301d645c342f742b4edd6dc)]:
  - @a11y-pulse/tab-orchestrator@0.2.0

## 0.1.0

### Minor Changes

- 59dc18d: Initial public release.

All notable changes to this project will be documented in this file.
