# @a11y-pulse/orphaned-tab-roles-audit

## 0.2.0

### Minor Changes

- [#112](https://github.com/A11y-Pulse/audits/pull/112) [`7cce2b9`](https://github.com/A11y-Pulse/audits/commit/7cce2b9d752fc7fb122555016b05f75fff250402) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Scope tab and panel matching to the tablist. Unselected tabs now pass when the selected tab in the same tablist is paired one-to-one with a mounted panel, so React Aria and Radix style tabs that mount only the active panel are no longer failed or sent for review. Results gain the tab's `tablist` selector, the `controls` targets of `aria-controls`, and the `href` of a tab used as a link.

### Patch Changes

- Updated dependencies [[`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb)]:
  - @a11y-pulse/browser-adaptor@0.10.0

## 0.1.0

### Minor Changes

- [#92](https://github.com/A11y-Pulse/audits/pull/92) [`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/orphaned-tab-roles-audit`, which checks that every ARIA tab is associated with a tab panel and every tab panel with a tab (WCAG 1.3.1 and 4.1.2). Navigation links with the tab role, tabs on a page whose panels all belong to other tabs, and panels no tab could control are failures; tabs and panels that declare no association but may be wired up another way are reported for review. The audit runner reports it as `orphaned-tab-roles`.

### Patch Changes

- Updated dependencies [[`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319)]:
  - @a11y-pulse/browser-adaptor@0.8.0
