---
"@a11y-pulse/context-change-on-focus-audit": minor
"@a11y-pulse/tab-orchestrator": minor
"@a11y-pulse/audit-runner": patch
---

Attribute context changes to the element that caused them, and say what happened.

- `@a11y-pulse/context-change-on-focus-audit`:
  - Focus theft is reported against the element that received focus and passed it on, with a screenshot of that element and the destination in `redirectedTo`. It used to be reported against the element focus ended up on. It is also reported when focus is thrown back to an element already visited, which used to end the pass with nothing said.
  - A navigation on focus is now a finding. Where the browser has the Navigation API the navigation is cancelled, the finding names the element and the URL, and the rest of the page is still checked. Elsewhere the result carries a top-level `navigation` naming the element tabbed from and where the page went.
  - `form.submit()` on focus is detected (it fires no submit event), and a native dialog raised on focus is a new `dialog` finding.
  - A change is put down to an element only when there is evidence the element caused it: it happened in the element's own focus handling, or in a `setTimeout` of up to a second set there. In the second case the finding carries `delayed: true` when focus has moved on, and the session waits up to a second at the end of the tab order so the last elements' timers are still seen.
  - Anything else the page does during the pass (a session-expiry redirect, a poll loop that opens a window, a dialog raised on a schedule) is no longer blamed on whichever element is focused. It is listed under a new top-level `unattributed`, for review. The session still blocks it: a script-initiated navigation is cancelled whoever started it.
  - Focus guards are no longer reported as focus theft: elements a dialog library marks as its guards, and empty, unnamed sentinels that send focus into a dialog they sit in or beside. An empty element that throws focus somewhere with no dialog involved is still reported.
  - Findings carry evidence: `url`, `from`/`to`, `form` and `redirectedTo`.
- `@a11y-pulse/tab-orchestrator`: `contextSignals` snapshots gain `details`, `late` and `unattributed`, `ContextChangeSignals` gains `navigationPrevented` and `focusGuard`, `screenshotClip("attributed")` captures the element that gave focus away, and `SessionEndDetail` gains `navigation` (where an uncancelled navigation came after and went to) and `contextSignals` (what the observer still had to report when the session ended). The context observer also stubs `form.submit()`, watches `alert`, `confirm` and `prompt`, and cancels script-initiated navigations for the length of the session. Two behaviours change for consumers: `signals.openedDialog` is now set by the same evidence rule as other signals rather than on whichever stop the adaptor dismissed a dialog at, and `onSessionEnd` is called once the tab loop is over (still before the page is restored) rather than from inside it.
- `@a11y-pulse/audit-runner`: the context-change message lists every change an element set off with its evidence, a navigation that ended the pass is reported as a violation instead of being dropped, and a change no focused element caused is reported for review on the document.
