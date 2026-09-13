# @a11y-pulse/focus-not-obscured-audit

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
