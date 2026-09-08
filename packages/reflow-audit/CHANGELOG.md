# Changelog

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
