# @a11y-pulse/audit-runner

## 0.4.0

### Minor Changes

- [#62](https://github.com/A11y-Pulse/audits/pull/62) [`b4c5af5`](https://github.com/A11y-Pulse/audits/commit/b4c5af5bea23a229dda43bfb133f5e4fd3a4af43) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Run axe-core alongside the A11y Pulse audits, and report every audit in axe-core's own result format.
  
  `runAllAudits` now returns axe-core's results object (`violations`, `incomplete`, `passes`, `inapplicable`, plus `url`, `timestamp` and `testEngine`) with each A11y Pulse audit converted into the same shape and appended to those arrays, so anything that reads axe-core JSON reads this too. Screenshot and style evidence moves onto the node it belongs to, as a single check under `any`, still as raw PNG bytes that `toJson` encodes as base64.
  
  New `axe` option, passed straight to `axe.run()`, and a converter per audit (`focusAppearanceToAxe`, `reflowToAxe`, and so on) exported for running a single audit and converting only its result.
  
  **Breaking:** the `{ url, audits }` return value is gone, along with the per-audit keys under `audits`. Read the results from the four buckets and filter by audit id (`focus-appearance`, `focus-not-obscured`, `context-change-on-focus`, `skip-link-activation`, `reflow`, `text-spacing`); the raw audit result types are still exported for callers that drive an audit themselves.

- [#52](https://github.com/A11y-Pulse/audits/pull/52) [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `--engine puppeteer|playwright` and `--browser chromium|firefox|webkit` to the CLI. Puppeteer stays the default, so existing invocations are unchanged.
  
  `runAllAudits` now takes `{ browser, reflow, textSpacing }` adaptors rather than a Puppeteer `Page`, so the runner works with any engine. Callers passing a `Page` should construct the three adaptors themselves; see the README.

### Patch Changes

- Updated dependencies [[`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04), [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04), [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04), [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04)]:
  - @a11y-pulse/browser-adaptor@0.4.0
  - @a11y-pulse/tab-orchestrator@0.6.0
  - @a11y-pulse/focus-appearance-audit@0.4.0
  - @a11y-pulse/focus-not-obscured-audit@0.4.0
  - @a11y-pulse/context-change-on-focus-audit@0.3.0
  - @a11y-pulse/reflow-audit@0.3.0
  - @a11y-pulse/text-spacing-audit@0.3.0
  - @a11y-pulse/skip-link-audit@0.1.2

## 0.3.0

### Minor Changes

- [`abe4b4e`](https://github.com/A11y-Pulse/audits/commit/abe4b4e48bf8bfaa59e5be2d4c158803083e8ffd) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Relicense under MIT. These packages carry no automation-library or audit logic of their own, so the PolyForm Shield restrictions only discouraged contributions such as new browser adaptors. The audit packages remain under PolyForm Shield 1.0.0.

### Patch Changes

- Updated dependencies [[`abe4b4e`](https://github.com/A11y-Pulse/audits/commit/abe4b4e48bf8bfaa59e5be2d4c158803083e8ffd)]:
  - @a11y-pulse/browser-adaptor@0.3.0
  - @a11y-pulse/tab-orchestrator@0.5.0

## 0.2.0

### Minor Changes

- [#44](https://github.com/A11y-Pulse/audits/pull/44) [`94c45ef`](https://github.com/A11y-Pulse/audits/commit/94c45ef081b9dde56a0b0d11eff4a6e303c93d2b) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/audit-runner`, a worked example that runs every audit against a page and ships an `npx @a11y-pulse/audit-runner [url]` CLI that outputs JSON results.
  
  Each audit package now also declares a `source` export condition, matching `@a11y-pulse/tab-orchestrator`, so cross-package typechecking resolves to source and no longer depends on workspace build order.

### Patch Changes

- Updated dependencies [[`94c45ef`](https://github.com/A11y-Pulse/audits/commit/94c45ef081b9dde56a0b0d11eff4a6e303c93d2b)]:
  - @a11y-pulse/browser-adaptor@0.2.2
  - @a11y-pulse/context-change-on-focus-audit@0.2.1
  - @a11y-pulse/focus-appearance-audit@0.3.1
  - @a11y-pulse/focus-not-obscured-audit@0.3.1
  - @a11y-pulse/reflow-audit@0.2.1
  - @a11y-pulse/skip-link-audit@0.1.1
  - @a11y-pulse/text-spacing-audit@0.2.1
