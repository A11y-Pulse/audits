---
"@a11y-pulse/text-spacing-audit": minor
---

`TextSpacingElementResult` now includes an optional `screenshot` (PNG bytes): a clipped shot of the finding's element with the WCAG 1.4.12 spacing overrides still applied, captured before they're restored. `TextSpacingAuditAdaptor` gains a required `screenshotClip` method.

Capture is bounded: at most `screenshotLimit` (default 10) findings are screenshotted per audit, since each is a real `page.screenshot()` call.
