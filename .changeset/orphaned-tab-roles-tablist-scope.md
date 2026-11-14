---
"@a11y-pulse/orphaned-tab-roles-audit": minor
---

Scope tab and panel matching to the tablist. Unselected tabs now pass when the selected tab in the same tablist is paired one-to-one with a mounted panel, so React Aria and Radix style tabs that mount only the active panel are no longer failed or sent for review. Results gain the tab's `tablist` selector, the `controls` targets of `aria-controls`, and the `href` of a tab used as a link.
