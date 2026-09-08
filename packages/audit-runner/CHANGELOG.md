# @a11y-pulse/audit-runner

## 0.2.0

### Minor Changes

- [#44](https://github.com/A11y-Pulse/audits/pull/44) [`94c45ef`](https://github.com/A11y-Pulse/audits/commit/94c45ef081b9dde56a0b0d11eff4a6e303c93d2b) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/audit-runner`, a worked example that runs every audit against a page and ships an `npx @a11y-pulse/audit-runner [url]` CLI that outputs JSON results.
  
  Each audit package now also declares a `source` export condition, matching `@a11y-pulse/tab-orchestrator`, so cross-package typechecking resolves to source and no longer depends on workspace build order.

### Patch Changes

- Updated dependencies [[`94c45ef`](https://github.com/A11y-Pulse/audits/commit/94c45ef081b9dde56a0b0d11eff4a6e303c93d2b)]:
  - @a11y-pulse/browser-adaptor@0.2.2
  - @a11y-pulse/context-change-on-focus-audit@0.2.1
  - @a11y-pulse/focus-appearance-audit@0.3.1
  - @a11y-pulse/focus-not-obscured-audit@0.3.1
  - @a11y-pulse/reflow-audit@0.2.1
  - @a11y-pulse/skip-link-audit@0.1.1
  - @a11y-pulse/text-spacing-audit@0.2.1
