---
"@a11y-pulse/audit-runner": minor
---

Add `-o`/`--output <file>` to write results to a file instead of stdout, `--format simple` for a readable list of failed audits, and show a spinner on stderr with the current step while the audits run. `runAllAudits` accepts an `onProgress` callback that receives the same step descriptions.
