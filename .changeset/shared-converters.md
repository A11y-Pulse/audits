---
"@a11y-pulse/audit-runner": minor
---

Export the axe-core converters from `@a11y-pulse/audit-runner/to-axe`, along with `AUDIT_METADATA`, so a pipeline of your own can convert each audit's result the way the CLI does. Every package is now released together on one version, and each pins the exact versions of the others it depends on, so an install always gets a set that was tested together.
