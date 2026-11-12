---
"@a11y-pulse/audit-runner": minor
"@a11y-pulse/resize-text-audit": patch
---

Run the new audits from the audit runner. `runAllAudits` and the CLI now also report `focus-indicator-contrast` (WCAG 1.4.11, read from the focus appearance audit's measurements), `keyboard-reachability` and `control-without-role` (WCAG 2.1.1 and 4.1.2, sharing the tab pass), `accessible-authentication` (WCAG 3.3.8), `resize-text` (WCAG 1.4.4), `moving-content` (WCAG 2.2.2) and `disclosure-operability` (WCAG 2.1.1 and 4.1.2). The moving content audit watches the page for five seconds, so every run now takes at least that long.

Audits can be left out with the new `--skip <ids>` flag or the `skip` option, by the ids in the exported `AUDIT_IDS` (`--list-audits` prints them); a skipped audit does no work and is not reported, and an unknown id is an error. `AuditAdaptors` gains two optional adaptors, `unreachableControls` and `resizeText`. The resize text audit is reported as `inapplicable` from a viewport narrower than 640 CSS px. The evidence of `focus-indicator-contrast` now carries the measurement in `data` on every node, `moving-content-evidence` names its `finding` as `reason`, and `disclosure-operability-evidence` includes `signals`.

`@a11y-pulse/resize-text-audit`: text that an ellipsis or line clamp cuts short is no longer reported as overlapping the element its unclipped length would reach.
