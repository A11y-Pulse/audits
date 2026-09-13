---
"@a11y-pulse/audit-runner": minor
---

Run axe-core alongside the A11y Pulse audits, and report every audit in axe-core's own result format.

`runAllAudits` now returns axe-core's results object (`violations`, `incomplete`, `passes`, `inapplicable`, plus `url`, `timestamp` and `testEngine`) with each A11y Pulse audit converted into the same shape and appended to those arrays, so anything that reads axe-core JSON reads this too. Screenshot and style evidence moves onto the node it belongs to, as a single check under `any`, still as raw PNG bytes that `toJson` encodes as base64.

New `axe` option, passed straight to `axe.run()`, and a converter per audit (`focusAppearanceToAxe`, `reflowToAxe`, and so on) exported for running a single audit and converting only its result.

**Breaking:** the `{ url, audits }` return value is gone, along with the per-audit keys under `audits`. Read the results from the four buckets and filter by audit id (`focus-appearance`, `focus-not-obscured`, `context-change-on-focus`, `skip-link-activation`, `reflow`, `text-spacing`); the raw audit result types are still exported for callers that drive an audit themselves.
