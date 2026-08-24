---
"@a11y-pulse/focus-not-obscured-audit": minor
---

`FocusNotObscuredElementResult` now includes an optional `screenshot` (PNG bytes) for any element whose bucket isn't `"pass"`, using the tab-orchestrator's new `screenshot` capability. Bounded by a new `screenshotLimit` option (default 10), since each capture is a real `page.screenshot()` call.
