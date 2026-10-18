---
"@a11y-pulse/focus-appearance-audit": minor
"@a11y-pulse/audit-runner": minor
---

Flag focus indicators that rely on a change of text colour alone. When the text colour is the only painted change on focus, `@a11y-pulse/focus-appearance-audit` adds a `colorOnly` entry with both colours and the contrast ratio between them. The audit runner reports these as `focus-color-only` for WCAG 1.4.1 Use of Color, tagged `experimental`: under 3:1 in `violations`, unmeasurable colours in `incomplete`.
