---
"@a11y-pulse/tab-orchestrator": patch
---

`clearMarkersScript` (run automatically when a tab session ends) now scrolls the page back to `(0, 0)`. Walking through focusable elements scrolls later ones into view, and nothing previously undid that once the session finished, leaving the page scrolled wherever the walk left it.
