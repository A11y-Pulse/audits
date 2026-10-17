---
"@a11y-pulse/browser-adaptor": minor
---

`BrowserAdaptor` gains `pressKey(key)`, which presses Tab, Shift+Tab, Enter, Escape or an arrow key, so audits that press keys other than Tab and Enter share one primitive instead of extending the adaptor themselves. Both bundled adaptors implement it; a custom adaptor must add it.
