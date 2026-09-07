# @a11y-pulse/tab-orchestrator

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
