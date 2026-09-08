---
"@a11y-pulse/audit-runner": minor
"@a11y-pulse/browser-adaptor": patch
"@a11y-pulse/context-change-on-focus-audit": patch
"@a11y-pulse/focus-appearance-audit": patch
"@a11y-pulse/focus-not-obscured-audit": patch
"@a11y-pulse/reflow-audit": patch
"@a11y-pulse/skip-link-audit": patch
"@a11y-pulse/text-spacing-audit": patch
---

Add `@a11y-pulse/audit-runner`, a worked example that runs every audit against a page and ships an `npx @a11y-pulse/audit-runner [url]` CLI that outputs JSON results.

Each audit package now also declares a `source` export condition, matching `@a11y-pulse/tab-orchestrator`, so cross-package typechecking resolves to source and no longer depends on workspace build order.
