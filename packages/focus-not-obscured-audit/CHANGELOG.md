# @a11y-pulse/focus-not-obscured-audit

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
