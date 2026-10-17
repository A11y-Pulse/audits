---
"@a11y-pulse/tab-orchestrator": minor
---

The tab loop now marks elements the baseline missed (media players, `<summary>`, content added after load) when they first take focus, and treats consecutive Tab presses that leave focus on the same element as that control's internal stops instead of a revisit. A page with `<audio controls>` no longer runs the loop to its marker limit, and a date input no longer ends the session early. When focus stays put, the loop tells the page cancelling Tab (a cycle of one), the end of the tab order in browsers that keep focus on the last element (a normal end), and a control that never lets go (a cycle of one after ten presses) apart. `installTabObserverScript`, `tabPreventedScript`, `heldFocusScript` and `markActiveElementScript` are exported for consumers that press keys of their own. Focus that spends more than 256 consecutive Tab presses inside iframes ends the session with the new `"stuck"` reason, rather than tabbing forever.
