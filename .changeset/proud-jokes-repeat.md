---
"@a11y-pulse/audit-runner": minor
---

Add `--engine puppeteer|playwright` and `--browser chromium|firefox|webkit` to the CLI. Puppeteer stays the default, so existing invocations are unchanged.

`runAllAudits` now takes `{ browser, reflow, textSpacing }` adaptors rather than a Puppeteer `Page`, so the runner works with any engine. Callers passing a `Page` should construct the three adaptors themselves; see the README.
