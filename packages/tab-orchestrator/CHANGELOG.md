# @a11y-pulse/tab-orchestrator

## 0.3.0

### Minor Changes

- [#29](https://github.com/A11y-Pulse/audits/pull/29) [`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add a `screenshot` capability and `session.screenshotClip()` to `TabSessionHandle`, for a consumer to capture a clipped, padded screenshot of the currently focused element on demand (mirrors the existing `ensureUnfocusedPair()` lazy-capture pattern: only computed when a declaring consumer calls it, cached per stop).

### Patch Changes

- [#29](https://github.com/A11y-Pulse/audits/pull/29) [`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - `clearMarkersScript` (run automatically when a tab session ends) now scrolls the page back to `(0, 0)`. Walking through focusable elements scrolls later ones into view, and nothing previously undid that once the session finished, leaving the page scrolled wherever the walk left it.

## 0.2.0

### Minor Changes

- [#24](https://github.com/A11y-Pulse/audits/pull/24) [`6863b2e`](https://github.com/A11y-Pulse/audits/commit/6863b2eac852a2b54301d645c342f742b4edd6dc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Extract `@a11y-pulse/tab-orchestrator` and run focus-appearance as a consumer. Import `PuppeteerAdaptor` from `@a11y-pulse/tab-orchestrator/puppeteer`.
