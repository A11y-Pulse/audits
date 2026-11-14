# @a11y-pulse/focus-not-obscured-audit

## 0.5.0

### Minor Changes

- [#110](https://github.com/A11y-Pulse/audits/pull/110) [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Detect realistic covers in the focus-not-obscured audit.
  
  - `@a11y-pulse/focus-not-obscured-audit`:
    - A cover is judged as a whole instead of by the one element that was hit: a cookie banner whose background is on its container, a fixed image known to be solid, a gradient footer and a bar made of several children are now violations, and `obscuredBy` names the banner rather than the paragraph inside it.
    - Layers that paint nothing where the element is (an empty toast container over the viewport, a fully transparent image) are looked through to whatever lies beneath them. Frames, and canvases and images that cannot be established to be solid, make an element beneath them `incomplete` rather than a violation.
    - Opaque covers with `pointer-events: none` are found. Click-through layers that paint and hold nothing, and click-through canvases, frames and images not known to be solid, are left alone.
    - A custom checkbox or switch whose real input is transparent or clipped is no longer reported as hidden by its own visible part; its label is measured in its place.
    - Elements are measured once they have stopped moving, so `scroll-behavior: smooth` no longer leaves below-the-fold elements `incomplete`.
    - New scrolled-to-top check (`checkScrolledToTop`, run automatically by `runFocusNotObscuredAudit`, capped by the new `scrolledToTopLimit` option) finds elements a sticky header hides; they are reported with `foundBy: "scrolled-to-top"`.
    - The evidence screenshot is a strip of the viewport with the focused element outlined, rather than a clip that showed only the cover. `measurement` gains `rect`, `measured`, `notPainted`, and `obscuredBy.rect`, `.position` and `.ignoresPointerEvents`. `summary` gains `scrolledToTopChecked`.
  - `@a11y-pulse/tab-orchestrator`: the obscuring measurement behind the above; `TabSessionHandle.screenshotContext()`; exports `measureObscuringScript`, `obscurerHandleScript`, `clearObscurerScript`, `toObscuredMeasurement`, `captureContextScreenshot`, `OBSCURER_ATTR` and `OBSCURING_RECHECK_DELAY_MS`.
  - `@a11y-pulse/audit-runner`: runs the scrolled-to-top check after the tab pass and words its findings separately.

### Patch Changes

- Updated dependencies [[`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb)]:
  - @a11y-pulse/browser-adaptor@0.10.0
  - @a11y-pulse/tab-orchestrator@0.10.0

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

- [#29](https://github.com/A11y-Pulse/audits/pull/29) [`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - `FocusNotObscuredElementResult` now includes an optional `screenshot` (PNG bytes) for any element whose bucket isn't `"pass"`, using the tab-orchestrator's new `screenshot` capability. Bounded by a new `screenshotLimit` option (default 10), since each capture is a real `page.screenshot()` call.

### Patch Changes

- Updated dependencies [[`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662), [`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662)]:
  - @a11y-pulse/tab-orchestrator@0.3.0

## 0.2.0

### Minor Changes

- [#24](https://github.com/A11y-Pulse/audits/pull/24) [`6863b2e`](https://github.com/A11y-Pulse/audits/commit/6863b2eac852a2b54301d645c342f742b4edd6dc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add WCAG 2.4.11 Focus Not Obscured (Minimum) as a standalone audit.

### Patch Changes

- Updated dependencies [[`6863b2e`](https://github.com/A11y-Pulse/audits/commit/6863b2eac852a2b54301d645c342f742b4edd6dc)]:
  - @a11y-pulse/tab-orchestrator@0.2.0
