# @a11y-pulse/orphaned-tab-roles-audit

## 0.1.0

### Minor Changes

- [#92](https://github.com/A11y-Pulse/audits/pull/92) [`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/orphaned-tab-roles-audit`, which checks that every ARIA tab is associated with a tab panel and every tab panel with a tab (WCAG 1.3.1 and 4.1.2). Navigation links with the tab role, tabs on a page whose panels all belong to other tabs, and panels no tab could control are failures; tabs and panels that declare no association but may be wired up another way are reported for review. The audit runner reports it as `orphaned-tab-roles`.

### Patch Changes

- Updated dependencies [[`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319)]:
  - @a11y-pulse/browser-adaptor@0.8.0
