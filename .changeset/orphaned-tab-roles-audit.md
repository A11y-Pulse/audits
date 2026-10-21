---
"@a11y-pulse/orphaned-tab-roles-audit": minor
"@a11y-pulse/audit-runner": minor
---

Add `@a11y-pulse/orphaned-tab-roles-audit`, which checks that every ARIA tab is associated with a tab panel and every tab panel with a tab (WCAG 1.3.1 and 4.1.2). Navigation links with the tab role, tabs on a page whose panels all belong to other tabs, and panels no tab could control are failures; tabs and panels that declare no association but may be wired up another way are reported for review. The audit runner reports it as `orphaned-tab-roles`.
