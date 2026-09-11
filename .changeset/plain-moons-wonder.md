---
"@a11y-pulse/tab-orchestrator": patch
---

Recognise Playwright's closed-target message ("Target page, context or browser has been closed") as a destroyed execution context, so a mid-session navigation ends the tab session instead of throwing.
