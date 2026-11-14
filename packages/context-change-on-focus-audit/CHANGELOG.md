# @a11y-pulse/context-change-on-focus-audit

## 0.5.0

### Minor Changes

- [#110](https://github.com/A11y-Pulse/audits/pull/110) [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Attribute context changes to the element that caused them, and say what happened.
  
  - `@a11y-pulse/context-change-on-focus-audit`:
    - Focus theft is reported against the element that received focus and passed it on, with a screenshot of that element and the destination in `redirectedTo`. It used to be reported against the element focus ended up on. It is also reported when focus is thrown back to an element already visited, which used to end the pass with nothing said.
    - A navigation on focus is now a finding. Where the browser has the Navigation API the navigation is cancelled, the finding names the element and the URL, and the rest of the page is still checked. Elsewhere the result carries a top-level `navigation` naming the element tabbed from and where the page went.
    - `form.submit()` on focus is detected (it fires no submit event), and a native dialog raised on focus is a new `dialog` finding.
    - A change is put down to an element only when there is evidence the element caused it: it happened in the element's own focus handling, or in a `setTimeout` of up to a second set there. In the second case the finding carries `delayed: true` when focus has moved on, and the session waits up to a second at the end of the tab order so the last elements' timers are still seen.
    - Anything else the page does during the pass (a session-expiry redirect, a poll loop that opens a window, a dialog raised on a schedule) is no longer blamed on whichever element is focused. It is listed under a new top-level `unattributed`, for review. The session still blocks it: a script-initiated navigation is cancelled whoever started it.
    - Focus guards are no longer reported as focus theft: elements a dialog library marks as its guards, and empty, unnamed sentinels that send focus into a dialog they sit in or beside. An empty element that throws focus somewhere with no dialog involved is still reported.
    - Findings carry evidence: `url`, `from`/`to`, `form` and `redirectedTo`.
  - `@a11y-pulse/tab-orchestrator`: `contextSignals` snapshots gain `details`, `late` and `unattributed`, `ContextChangeSignals` gains `navigationPrevented` and `focusGuard`, `screenshotClip("attributed")` captures the element that gave focus away, and `SessionEndDetail` gains `navigation` (where an uncancelled navigation came after and went to) and `contextSignals` (what the observer still had to report when the session ended). The context observer also stubs `form.submit()`, watches `alert`, `confirm` and `prompt`, and cancels script-initiated navigations for the length of the session. Two behaviours change for consumers: `signals.openedDialog` is now set by the same evidence rule as other signals rather than on whichever stop the adaptor dismissed a dialog at, and `onSessionEnd` is called once the tab loop is over (still before the page is restored) rather than from inside it.
  - `@a11y-pulse/audit-runner`: the context-change message lists every change an element set off with its evidence, a navigation that ended the pass is reported as a violation instead of being dropped, and a change no focused element caused is reported for review on the document.

### Patch Changes

- Updated dependencies [[`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb)]:
  - @a11y-pulse/browser-adaptor@0.10.0
  - @a11y-pulse/tab-orchestrator@0.10.0

## 0.4.0

### Minor Changes

- [#97](https://github.com/A11y-Pulse/audits/pull/97) [`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Screenshot elements with context-change-on-focus findings. Each element with a finding gets a `screenshot` (up to the new `screenshotLimit` option, default 10), except after a navigation, when the original page is gone. The tab orchestrator now lets a `screenshot` declarer capture the element behind a focus-removal stop. The audit runner attaches the screenshot as `context-change-on-focus-evidence`.

### Patch Changes

- Updated dependencies [[`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5), [`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5)]:
  - @a11y-pulse/tab-orchestrator@0.9.0
  - @a11y-pulse/browser-adaptor@0.9.0

## 0.3.0

### Minor Changes

- [#52](https://github.com/A11y-Pulse/audits/pull/52) [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Make `@a11y-pulse/browser-adaptor` the single home for the browser primitives that `@a11y-pulse/tab-orchestrator` had forked: `BrowserAdaptor`, `ElementRef`, `Rect`, `PuppeteerAdaptor`, `bufferedClip`, `getSelector` and `truncateHtml`. The copies were byte-identical and had already started to drift.
  
  `BrowserAdaptor` gains the `scale` parameter and optional `screenshotClipScale` that `ReflowAuditAdaptor` and `TextSpacingAuditAdaptor` already had, and the shared `PuppeteerAdaptor` picks up the fork's `screenshotClipScale = 2`, `optimizeForSpeed` and `clip.scale`.
  
  **Breaking:** `@a11y-pulse/tab-orchestrator` no longer exports `BrowserAdaptor`, `ElementRef`, `Rect`, `bufferedClip`, `getSelector`, `truncateHtml` or `TruncateHtmlOptions`, and its `./puppeteer` subpath is gone. Import them from `@a11y-pulse/browser-adaptor` (or `@a11y-pulse/browser-adaptor/dom` for `getSelector` and `truncateHtml`), and add that package to your dependencies. The tab-orchestrator no longer declares `puppeteer` as a peer dependency, since it ships no adaptor of its own.
  
  **Breaking:** `BrowserAdaptor` requires `pressEnter`, which the tab-orchestrator's fork did not declare. The bundled adaptors already implement it; a hand-written adaptor passed to `createTabOrchestrator` needs to add it, even though the tab loop itself never presses Enter.
  
  The audit packages re-export the same type names as before, so `FocusAppearanceAuditAdaptor` and friends are unchanged for their callers.

### Patch Changes

- [#52](https://github.com/A11y-Pulse/audits/pull/52) [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Document which browser engines each audit is verified against, and point the adaptor docs at `@a11y-pulse/browser-adaptor`, which now owns both the `BrowserAdaptor` interface and the bundled Puppeteer and Playwright implementations.
- Updated dependencies [[`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04), [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04), [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04)]:
  - @a11y-pulse/browser-adaptor@0.4.0
  - @a11y-pulse/tab-orchestrator@0.6.0

## 0.2.1

### Patch Changes

- [#44](https://github.com/A11y-Pulse/audits/pull/44) [`94c45ef`](https://github.com/A11y-Pulse/audits/commit/94c45ef081b9dde56a0b0d11eff4a6e303c93d2b) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/audit-runner`, a worked example that runs every audit against a page and ships an `npx @a11y-pulse/audit-runner [url]` CLI that outputs JSON results.
  
  Each audit package now also declares a `source` export condition, matching `@a11y-pulse/tab-orchestrator`, so cross-package typechecking resolves to source and no longer depends on workspace build order.

## 0.2.0

### Minor Changes

- [#24](https://github.com/A11y-Pulse/audits/pull/24) [`6863b2e`](https://github.com/A11y-Pulse/audits/commit/6863b2eac852a2b54301d645c342f742b4edd6dc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add WCAG 3.2.1 On Focus (Context Change on Focus) as a standalone audit on the shared tab-orchestrator loop.

### Patch Changes

- Updated dependencies [[`6863b2e`](https://github.com/A11y-Pulse/audits/commit/6863b2eac852a2b54301d645c342f742b4edd6dc)]:
  - @a11y-pulse/tab-orchestrator@0.2.0
