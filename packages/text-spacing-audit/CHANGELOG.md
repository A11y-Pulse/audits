# Changelog

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
