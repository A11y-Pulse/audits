# @a11y-pulse/audit-runner

## 0.8.0

### Minor Changes

- [#92](https://github.com/A11y-Pulse/audits/pull/92) [`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - `focus-order` and `focus-color-only` results now carry only their WCAG and category tags.

- [#92](https://github.com/A11y-Pulse/audits/pull/92) [`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/filename-alt-text-audit`, which flags image alt text that is not a text alternative (WCAG 1.1.1 Non-text Content, failure F30). Alt text that is the full filename of one of the image's own sources is a failure; alt text that only resembles a filename, a camera file name or placeholder text in the page's language or English is reported for review. The audit runner reports it as `filename-alt-text`: own filenames in `violations`, everything else in `incomplete`.

- [#92](https://github.com/A11y-Pulse/audits/pull/92) [`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/orphaned-tab-roles-audit`, which checks that every ARIA tab is associated with a tab panel and every tab panel with a tab (WCAG 1.3.1 and 4.1.2). Navigation links with the tab role, tabs on a page whose panels all belong to other tabs, and panels no tab could control are failures; tabs and panels that declare no association but may be wired up another way are reported for review. The audit runner reports it as `orphaned-tab-roles`.

### Patch Changes

- Updated dependencies [[`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319), [`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319), [`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319), [`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319)]:
  - @a11y-pulse/browser-adaptor@0.8.0
  - @a11y-pulse/focus-order-audit@0.1.1
  - @a11y-pulse/filename-alt-text-audit@0.1.0
  - @a11y-pulse/orphaned-tab-roles-audit@0.1.0

## 0.7.0

### Minor Changes

- [#90](https://github.com/A11y-Pulse/audits/pull/90) [`37f1354`](https://github.com/A11y-Pulse/audits/commit/37f135426322697d3bb11b7e52147a0f9d6b7bfc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Flag focus indicators that rely on a change of text colour alone. When the text colour is the only painted change on focus, `@a11y-pulse/focus-appearance-audit` adds a `colorOnly` entry with both colours and the contrast ratio between them. The audit runner reports these as `focus-color-only` for WCAG 1.4.1 Use of Color, tagged `experimental`: under 3:1 in `violations`, unmeasurable colours in `incomplete`.

### Patch Changes

- Updated dependencies [[`37f1354`](https://github.com/A11y-Pulse/audits/commit/37f135426322697d3bb11b7e52147a0f9d6b7bfc), [`37f1354`](https://github.com/A11y-Pulse/audits/commit/37f135426322697d3bb11b7e52147a0f9d6b7bfc)]:
  - @a11y-pulse/browser-adaptor@0.7.0
  - @a11y-pulse/focus-appearance-audit@0.5.0

## 0.6.0

### Minor Changes

- [#86](https://github.com/A11y-Pulse/audits/pull/86) [`2ab8af6`](https://github.com/A11y-Pulse/audits/commit/2ab8af68a62573b054b3695f26ff8300ef636af8) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add the experimental `@a11y-pulse/focus-order-audit`, which rides the shared tab loop and flags pages whose focus repeatedly jumps a long way against the reading order, as a review prompt for WCAG 2.4.3 Focus Order. The audit runner reports it as `focus-order` in `incomplete`, tagged `experimental`.

- [#86](https://github.com/A11y-Pulse/audits/pull/86) [`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/keyboard-trap-audit`, a WCAG 2.1.2 No Keyboard Trap audit that rides the shared tab loop, detects focus cycling within part of the page, and tries Escape, Shift+Tab, arrow keys and Tab before reporting a trap for review. The audit runner reports it as `keyboard-trap`, and runs its escape attempts after every other audit because they can change the page. Tab consumers' `onSessionEnd` receives a second argument naming the element whose revisit ended the session.

### Patch Changes

- Updated dependencies [[`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e), [`2ab8af6`](https://github.com/A11y-Pulse/audits/commit/2ab8af68a62573b054b3695f26ff8300ef636af8), [`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e), [`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e)]:
  - @a11y-pulse/browser-adaptor@0.6.0
  - @a11y-pulse/focus-order-audit@0.1.0
  - @a11y-pulse/keyboard-trap-audit@0.1.0
  - @a11y-pulse/tab-orchestrator@0.7.0

## 0.5.0

### Minor Changes

- [`41d6d77`](https://github.com/A11y-Pulse/audits/commit/41d6d773aafc59c2e9e293c9892cbbe94d544268) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `-o`/`--output <file>` to write results to a file instead of stdout, `--format simple` for a readable list of failed audits, and show a spinner on stderr with the current step while the audits run. `runAllAudits` accepts an `onProgress` callback that receives the same step descriptions.

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
