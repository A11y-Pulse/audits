---
"@a11y-pulse/focus-appearance-audit": minor
"@a11y-pulse/audit-runner": minor
---

Screenshot colour-only focus indicators. When the text colour change is under 3:1 or cannot be measured, `colorOnly.evidence` holds the element's focused and unfocused screenshots. `MIN_LIGHTNESS_CONTRAST` is now exported from `@a11y-pulse/focus-appearance-audit`. The audit runner attaches the screenshots to `focus-color-only` results as `focus-color-only-evidence`.
