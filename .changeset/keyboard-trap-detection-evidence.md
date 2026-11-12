---
"@a11y-pulse/keyboard-trap-audit": minor
"@a11y-pulse/tab-orchestrator": patch
"@a11y-pulse/audit-runner": patch
---

Improve keyboard trap detection, evidence and speed.

- `@a11y-pulse/keyboard-trap-audit`:
  - Focus that goes into an iframe and never comes back out is reported for review against the iframe (`inconclusiveReason: "stuck-in-frame"`), instead of producing nothing.
  - Tabbable elements inside open shadow roots count as shut out, so a trap on a page whose header and footer are web components is no longer passed as a `small-ring`.
  - An exit that only reaches the browser's own interface is checked: when the page pulls focus back as it re-enters at the other end, the result is `inconclusive` with `page-edge-only` rather than `escaped`. The element focus re-enters on is looked for again if the page has re-created it, and the check is undone afterwards: focus is taken off that element, a form control gets its value back, and Escape is pressed once if focusing it opened something.
  - New result fields: `inconclusiveReason`, `dialog` (whether the ring sits in a dialog, and how many buttons it has), `keysTried`, `attempts` (each key pressed, where focus landed, whether the page cancelled Tab) and `sampledRing`.
  - Faster escape attempts: a Tab or Shift+Tab walk stops once focus returns to a member it has been on, rings of more than 32 members are sampled either side of their wrap, the wait after Escape ends early when the page ignored the key, and ring members are no longer found by selector on every probe. A 150-element ring takes about 9s end to end where it took 31s.
  - A sampled ring that no key leaves is reported as `inconclusive` with the new `ring-sampled` reason rather than `trapped`, because an exit from a member in the middle of it was never tried.
  - The wait after Escape is not cut short while a timer the page set on handling the key is still to fire, and a container that closes late is credited to Escape (`escapedVia: "escape-key"`) rather than to the key pressed next.
  - `timeout` now also limits the escape attempts in `verify`.
- `@a11y-pulse/tab-orchestrator`: `SessionEndDetail.stuckIn` names the iframe a session got stuck in.
- `@a11y-pulse/audit-runner`: the keyboard-trap message lists only the keys that were pressed, says when the component is a dialog with buttons, and reports `stuck-in-frame`, `page-edge-only` and `ring-sampled` results as needing review, the last with a note that only part of the ring was tried.
