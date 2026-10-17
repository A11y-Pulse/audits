---
"@a11y-pulse/keyboard-trap-audit": minor
"@a11y-pulse/audit-runner": minor
"@a11y-pulse/tab-orchestrator": minor
---

Add `@a11y-pulse/keyboard-trap-audit`, a WCAG 2.1.2 No Keyboard Trap audit that rides the shared tab loop, detects focus cycling within part of the page, and tries Escape, Shift+Tab, arrow keys and Tab before reporting a trap for review. The audit runner reports it as `keyboard-trap`, and runs its escape attempts after every other audit because they can change the page. Tab consumers' `onSessionEnd` receives a second argument naming the element whose revisit ended the session.
