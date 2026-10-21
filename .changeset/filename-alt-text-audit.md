---
"@a11y-pulse/filename-alt-text-audit": minor
"@a11y-pulse/audit-runner": minor
---

Add `@a11y-pulse/filename-alt-text-audit`, which flags image alt text that is not a text alternative (WCAG 1.1.1 Non-text Content, failure F30). Alt text that is the full filename of one of the image's own sources is a failure; alt text that only resembles a filename, a camera file name or placeholder text in the page's language or English is reported for review. The audit runner reports it as `filename-alt-text`: own filenames in `violations`, everything else in `incomplete`.
