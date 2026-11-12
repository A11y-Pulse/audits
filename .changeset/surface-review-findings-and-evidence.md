---
"@a11y-pulse/audit-runner": minor
---

Surface review findings and evidence in the runner's output. `--format simple` now lists the `incomplete` results under "needs review" (including audits that could not run) and prints why each element was flagged, so a page with a keyboard trap no longer reads as clean. Every node's evidence check carries the audit's structured measurements in `data`, with the screenshot optional, and keyboard-trap, focus-order, orphaned-tab-roles and suspicious-accessible-name gain evidence checks. Audits that ran but could not reach a conclusion are reported as `incomplete` with the tag `a11y-pulse.audit-inconclusive` and a reason instead of nothing, audits with nothing to check are `inapplicable`, and passing nodes no longer carry a failure message.
