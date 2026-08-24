---
"@a11y-pulse/reflow-audit": minor
"@a11y-pulse/browser-adaptor": minor
---

`ReflowOffender` now includes an optional `screenshot` (PNG bytes), a clipped shot of the offending element captured at the 320px measurement viewport before it's restored. `ReflowAuditAdaptor` gains a required `screenshotClip` method. `@a11y-pulse/browser-adaptor` gains a `bufferedClip` export (padded-clip geometry, ported from `@a11y-pulse/tab-orchestrator`'s implementation) that `reflow-audit` and `text-spacing-audit` both use for this.

Capture is bounded: at most `screenshotLimit` (default 10) offenders are screenshotted per audit, since each is a real `page.screenshot()` call.
