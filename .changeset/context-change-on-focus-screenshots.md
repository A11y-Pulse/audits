---
"@a11y-pulse/context-change-on-focus-audit": minor
"@a11y-pulse/tab-orchestrator": minor
"@a11y-pulse/audit-runner": minor
---

Screenshot elements with context-change-on-focus findings. Each element with a finding gets a `screenshot` (up to the new `screenshotLimit` option, default 10), except after a navigation, when the original page is gone. The tab orchestrator now lets a `screenshot` declarer capture the element behind a focus-removal stop. The audit runner attaches the screenshot as `context-change-on-focus-evidence`.
