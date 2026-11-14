# Changelog

## 0.4.0

### Minor Changes

- [#113](https://github.com/A11y-Pulse/audits/pull/113) [`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/resize-text-audit`, an audit for WCAG 1.4.4 Resize Text.
  
  - It halves the CSS viewport, which is the layout a page gets at 200% browser zoom, and reports text that the zoomed layout cuts off (`clipped`) or lays over other text (`overlap`), with the clipping element, the overflow in px, rects and a screenshot taken while zoomed.
  - Text that only the zoomed layout renders (a header behind a `max-width` media query) is measured too. With no full-size measurement to compare it with, text among it that a box cuts into is reported with `noBaseline` and is meant for review.
  - Text that can still be scrolled to, text an ellipsis or line clamp truncates, text that was already cut off, and content the narrow layout hides outright (an off-canvas menu) are not reported.
  - Overlap counts text only as far as its clipping ancestors leave it showing, so the part of a title that an ellipsis hides does not overlap what it lies under, while text whose `text-overflow` has nothing to act on is compared like any other.
  - The bundled adaptors read the window's own size when no viewport is being emulated (`defaultViewport: null`), and the Puppeteer adaptor drops its emulation again when the audit is done.
  - The result carries the page's viewport meta tag and whether it stops users zooming (`user-scalable=no`, `maximum-scale` below 2).
  
  The text measurement is shared with the text spacing audit, which now exports its page scripts from `@a11y-pulse/text-spacing-audit/measure`, adds a `remeasureScript` that re-measures without applying the spacing override (and can collect the candidates again under the styles that now apply), and describes how each finding's element is currently styled (`overflowX`, `overflowY`, `truncates`, `visible`). The text spacing audit uses that description to drop overlaps in which either element cannot be seen, such as a closed menu faded out with `opacity: 0`.

- [#111](https://github.com/A11y-Pulse/audits/pull/111) [`b5ef317`](https://github.com/A11y-Pulse/audits/commit/b5ef317b28ef92ed3d7712f71c169a2e191f2f0f) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Improve the accuracy, evidence and speed of the text spacing audit.
  
  - Clipping is measured on each line of an element's text against every clipping ancestor, so nested clipping boxes are caught, decoration that already overflowed no longer hides real clipping, and text that can still be scrolled to is not reported. Everything cut off by one element is a single finding.
  - Overlap compares lines of text, each only as far as its clipping and scrolling ancestors leave it showing, so a wrapped inline link is no longer reported as overlapping the text around it, and text that a box cuts off is not reported as overlapping what lies beyond the box.
  - A clipping box under a scaling transform is measured at the size it is drawn, so clipped text inside a scaled ancestor is found.
  - The spacing override is applied inside open shadow roots and now beats author `!important` rules in stylesheets.
  - `restored` is no longer `false` on pages that transition every property.
  - Findings name the clipping element (`clippedBy`), the `axis`, how many text containers are affected, the element's `rect`, and for overlaps the shared area and region. Screenshots are matched to findings by element, are positioned correctly on a scrolled page, and show both elements of an overlap.
  - `truncated` on the result says when `candidateLimit` left text unmeasured.
  - Selectors are only computed for findings, ancestors are inspected once, and the fixed 200ms waits are gone: `settleMs` now defaults to `0` and adds to a wait for the layout to stop changing.
  
  `CandidateSnapshot` gains the measurements above (including `visibleTextRects`, the lines as far as they show), its `rect` is now in document coordinates, and its `selector` and `html` are empty in snapshots taken by the audit.

### Patch Changes

- Updated dependencies [[`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb)]:
  - @a11y-pulse/browser-adaptor@0.10.0

## 0.3.0

### Minor Changes

- [#52](https://github.com/A11y-Pulse/audits/pull/52) [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add a Playwright adaptor alongside the Puppeteer one, exported from `@a11y-pulse/browser-adaptor/playwright` and from the reflow and text-spacing packages' own `./playwright` subpaths. `playwright-core` is an optional peer dependency, so Puppeteer users are unaffected.
  
  Two behaviours differ from Puppeteer and are documented in `@a11y-pulse/browser-adaptor`'s README: `evaluate` rebuilds the page function with `new Function`, which needs `unsafe-eval` in the page's CSP; and clipped screenshots go over CDP on Chromium for pixel parity, falling back to a full-page capture at the context's own `deviceScaleFactor` on Firefox and WebKit.

### Patch Changes

- Updated dependencies [[`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04), [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04)]:
  - @a11y-pulse/browser-adaptor@0.4.0

## 0.2.1

### Patch Changes

- [#44](https://github.com/A11y-Pulse/audits/pull/44) [`94c45ef`](https://github.com/A11y-Pulse/audits/commit/94c45ef081b9dde56a0b0d11eff4a6e303c93d2b) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/audit-runner`, a worked example that runs every audit against a page and ships an `npx @a11y-pulse/audit-runner [url]` CLI that outputs JSON results.
  
  Each audit package now also declares a `source` export condition, matching `@a11y-pulse/tab-orchestrator`, so cross-package typechecking resolves to source and no longer depends on workspace build order.
- Updated dependencies [[`94c45ef`](https://github.com/A11y-Pulse/audits/commit/94c45ef081b9dde56a0b0d11eff4a6e303c93d2b)]:
  - @a11y-pulse/browser-adaptor@0.2.2

## 0.2.0

### Minor Changes

- [#29](https://github.com/A11y-Pulse/audits/pull/29) [`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - `TextSpacingElementResult` now includes an optional `screenshot` (PNG bytes): a clipped shot of the finding's element with the WCAG 1.4.12 spacing overrides still applied, captured before they're restored. `TextSpacingAuditAdaptor` gains a required `screenshotClip` method.
  
  Capture is bounded: at most `screenshotLimit` (default 10) findings are screenshotted per audit, since each is a real `page.screenshot()` call.

### Patch Changes

- Updated dependencies [[`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662)]:
  - @a11y-pulse/browser-adaptor@0.2.0

## 0.1.0

### Minor Changes

- [#20](https://github.com/A11y-Pulse/audits/pull/20) [`dd1fa04`](https://github.com/A11y-Pulse/audits/commit/dd1fa043ce9ae83a20d292c0336e4036d71ae0cc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/text-spacing-audit`: behavioural WCAG 1.4.12 text-spacing injection check.

### Patch Changes

- Updated dependencies [[`dd1fa04`](https://github.com/A11y-Pulse/audits/commit/dd1fa043ce9ae83a20d292c0336e4036d71ae0cc)]:
  - @a11y-pulse/browser-adaptor@0.1.0
