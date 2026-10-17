# @a11y-pulse/focus-order-audit

## 0.1.0

### Minor Changes

- [#86](https://github.com/A11y-Pulse/audits/pull/86) [`2ab8af6`](https://github.com/A11y-Pulse/audits/commit/2ab8af68a62573b054b3695f26ff8300ef636af8) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add the experimental `@a11y-pulse/focus-order-audit`, which rides the shared tab loop and flags pages whose focus repeatedly jumps a long way against the reading order, as a review prompt for WCAG 2.4.3 Focus Order. The audit runner reports it as `focus-order` in `incomplete`, tagged `experimental`.

### Patch Changes

- Updated dependencies [[`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e), [`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e), [`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e)]:
  - @a11y-pulse/browser-adaptor@0.6.0
  - @a11y-pulse/tab-orchestrator@0.7.0
