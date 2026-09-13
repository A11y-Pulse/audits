# @a11y-pulse/tab-orchestrator

## 0.6.0

### Minor Changes

- [#52](https://github.com/A11y-Pulse/audits/pull/52) [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Make `@a11y-pulse/browser-adaptor` the single home for the browser primitives that `@a11y-pulse/tab-orchestrator` had forked: `BrowserAdaptor`, `ElementRef`, `Rect`, `PuppeteerAdaptor`, `bufferedClip`, `getSelector` and `truncateHtml`. The copies were byte-identical and had already started to drift.
  
  `BrowserAdaptor` gains the `scale` parameter and optional `screenshotClipScale` that `ReflowAuditAdaptor` and `TextSpacingAuditAdaptor` already had, and the shared `PuppeteerAdaptor` picks up the fork's `screenshotClipScale = 2`, `optimizeForSpeed` and `clip.scale`.
  
  **Breaking:** `@a11y-pulse/tab-orchestrator` no longer exports `BrowserAdaptor`, `ElementRef`, `Rect`, `bufferedClip`, `getSelector`, `truncateHtml` or `TruncateHtmlOptions`, and its `./puppeteer` subpath is gone. Import them from `@a11y-pulse/browser-adaptor` (or `@a11y-pulse/browser-adaptor/dom` for `getSelector` and `truncateHtml`), and add that package to your dependencies. The tab-orchestrator no longer declares `puppeteer` as a peer dependency, since it ships no adaptor of its own.
  
  **Breaking:** `BrowserAdaptor` requires `pressEnter`, which the tab-orchestrator's fork did not declare. The bundled adaptors already implement it; a hand-written adaptor passed to `createTabOrchestrator` needs to add it, even though the tab loop itself never presses Enter.
  
  The audit packages re-export the same type names as before, so `FocusAppearanceAuditAdaptor` and friends are unchanged for their callers.

### Patch Changes

- [#52](https://github.com/A11y-Pulse/audits/pull/52) [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Recognise Playwright's closed-target message ("Target page, context or browser has been closed") as a destroyed execution context, so a mid-session navigation ends the tab session instead of throwing.
- Updated dependencies [[`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04), [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04)]:
  - @a11y-pulse/browser-adaptor@0.4.0

## 0.5.0

### Minor Changes

- [`abe4b4e`](https://github.com/A11y-Pulse/audits/commit/abe4b4e48bf8bfaa59e5be2d4c158803083e8ffd) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Relicense under MIT. These packages carry no automation-library or audit logic of their own, so the PolyForm Shield restrictions only discouraged contributions such as new browser adaptors. The audit packages remain under PolyForm Shield 1.0.0.

## 0.4.0

### Minor Changes

- [#40](https://github.com/A11y-Pulse/audits/pull/40) [`6514f41`](https://github.com/A11y-Pulse/audits/commit/6514f416171cfc36dfad4eb15f6081e3b2971978) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Verify the page still reports focus at the point each tab stop is measured, not only before the tab press.
  
  Chromium stops matching `:focus` and `:focus-visible` the moment a document loses focus, so an element measured in that state reads as having no indicator however correct its CSS is, and its focused and unfocused screenshots come out pixel-identical. The session previously checked `document.hasFocus()` once per stop, before `pressTab()`, which is the least informative moment: the tab press itself re-activates a backgrounded page. A page that lost focus after the press was measured anyway, and consumers reported the result as a genuine failure.
  
  The loop now re-checks at the point of measurement and re-asserts focus reporting once before giving up, ending the session as `lostFocus` rather than recording a measurement taken without focus.
  
  The check exempts a stop that probes as `<body>`. The tab press that leaves the last element takes focus out of the document with it, so the end of the tab order is indistinguishable from a stolen focus by `document.hasFocus()` alone, and focus emulation cannot restore it. Only a real element measured without focus ends the session; running out of elements to tab to still ends it as `completed`.
  
  Adds a `hasFocusScript` export so adaptors and tests can address the check directly.

## 0.3.0

### Minor Changes

- [#29](https://github.com/A11y-Pulse/audits/pull/29) [`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add a `screenshot` capability and `session.screenshotClip()` to `TabSessionHandle`, for a consumer to capture a clipped, padded screenshot of the currently focused element on demand (mirrors the existing `ensureUnfocusedPair()` lazy-capture pattern: only computed when a declaring consumer calls it, cached per stop).

### Patch Changes

- [#29](https://github.com/A11y-Pulse/audits/pull/29) [`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - `clearMarkersScript` (run automatically when a tab session ends) now scrolls the page back to `(0, 0)`. Walking through focusable elements scrolls later ones into view, and nothing previously undid that once the session finished, leaving the page scrolled wherever the walk left it.

## 0.2.0

### Minor Changes

- [#24](https://github.com/A11y-Pulse/audits/pull/24) [`6863b2e`](https://github.com/A11y-Pulse/audits/commit/6863b2eac852a2b54301d645c342f742b4edd6dc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Extract `@a11y-pulse/tab-orchestrator` and run focus-appearance as a consumer. Import `PuppeteerAdaptor` from `@a11y-pulse/tab-orchestrator/puppeteer`.
