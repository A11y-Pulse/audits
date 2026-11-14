---
"@a11y-pulse/paste-blocking-audit": minor
---

Add `@a11y-pulse/paste-blocking-audit`, a WCAG 3.3.8 Accessible Authentication (Minimum) audit. It finds the page's password, username and one-time-code fields and pastes into each with synthetic events. A field whose `paste` event the page cancels, leaving it unchanged, is a failure; a cancelled paste key press or `beforeinput`, a cancelled paste on a one-time code (which is pasted a digit short), a split code entry that ignores a pasted code, a field kept `readonly` until focus, `autocomplete="off"`, `autocomplete="new-password"` on a sign-in password and a one-time-code field with no `autocomplete="one-time-code"` are reported for review. A one-time code is never pasted whole, and form submission and `fetch`, `XMLHttpRequest` and `sendBeacon` requests are held back while fields are pasted into, so the page cannot send the pasted text. The clipboard is not touched, and field values and focus are left as found.
