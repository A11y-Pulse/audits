# Changelog

## 0.4.0

### Minor Changes

- [#111](https://github.com/A11y-Pulse/audits/pull/111) [`b5ef317`](https://github.com/A11y-Pulse/audits/commit/b5ef317b28ef92ed3d7712f71c169a2e191f2f0f) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Improve the reflow audit's accuracy and evidence.
  
  - Content clipped by a viewport-fitting `overflow: hidden` / `clip` ancestor is no longer reported as a violation.
  - The layout must hold still for `minSettleMs` (300ms by default) before it is measured, so debounced resize handlers have run. `settleAttempts` now defaults to 20.
  - Text that overflows without wrapping is attributed to its element (`text-overflow`).
  - New review-only offender reasons: `media-overflow` (an `img`, `video` or `iframe` wider than the viewport, previously a silent pass, and reported on the media itself when a `<picture>` or link wraps it), `clipped-content` (content cut off by `overflow-x: hidden` on `html` or `body`, or inside a `position: fixed` box that does not scroll it) and `scrolling-container` (most of the page inside a horizontal scroller, with the content that is too wide for it listed in the new `overflowing` field). Offenders with no document overflow now make the result `incomplete`.
  - A `position: fixed` box that scrolls or clips its own overflow, such as a tab bar or a dialog, contains its content like any other.
  - Only tables with header cells, a caption, `thead`, `scope`/`headers` or a table role are exempt as data tables.
  - Right-to-left pages are measured at their left edge, and measurement no longer depends on the scroll position.
  - Offenders carry their document `rect`, and screenshots are clipped in document coordinates and widened to show an offender that lies wholly beyond the viewport, on the left of a right-to-left page as well as on the right.
  - The bundled adaptors read the window's real size when the page has no emulated viewport, where they used to assume 800x600, and the Puppeteer adaptor clears its emulation again when the audit restores the viewport.
  - The audit no longer waits for the layout to settle again after restoring the viewport.
  
  The runner's failure summaries describe each new offender reason and name what is too wide inside a scrolling container.

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

- [#29](https://github.com/A11y-Pulse/audits/pull/29) [`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - `ReflowOffender` now includes an optional `screenshot` (PNG bytes), a clipped shot of the offending element captured at the 320px measurement viewport before it's restored. `ReflowAuditAdaptor` gains a required `screenshotClip` method. `@a11y-pulse/browser-adaptor` gains a `bufferedClip` export (padded-clip geometry, ported from `@a11y-pulse/tab-orchestrator`'s implementation) that `reflow-audit` and `text-spacing-audit` both use for this.
  
  Capture is bounded: at most `screenshotLimit` (default 10) offenders are screenshotted per audit, since each is a real `page.screenshot()` call.

### Patch Changes

- Updated dependencies [[`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662)]:
  - @a11y-pulse/browser-adaptor@0.2.0

## 0.1.0

### Minor Changes

- [#19](https://github.com/A11y-Pulse/audits/pull/19) [`ee7b837`](https://github.com/A11y-Pulse/audits/commit/ee7b8370d9b417f50616f5af20368745c138b86d) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/reflow-audit`: behavioural WCAG 1.4.10 check that narrows to 320px and measures two-dimensional scrolling.

### Patch Changes

- Updated dependencies [[`dd1fa04`](https://github.com/A11y-Pulse/audits/commit/dd1fa043ce9ae83a20d292c0336e4036d71ae0cc)]:
  - @a11y-pulse/browser-adaptor@0.1.0
