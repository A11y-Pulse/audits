# @a11y-pulse/keyboard-trap-audit

## 0.2.0

### Minor Changes

- [#110](https://github.com/A11y-Pulse/audits/pull/110) [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Improve keyboard trap detection, evidence and speed.
  
  - `@a11y-pulse/keyboard-trap-audit`:
    - Focus that goes into an iframe and never comes back out is reported for review against the iframe (`inconclusiveReason: "stuck-in-frame"`), instead of producing nothing.
    - Tabbable elements inside open shadow roots count as shut out, so a trap on a page whose header and footer are web components is no longer passed as a `small-ring`.
    - An exit that only reaches the browser's own interface is checked: when the page pulls focus back as it re-enters at the other end, the result is `inconclusive` with `page-edge-only` rather than `escaped`. The element focus re-enters on is looked for again if the page has re-created it, and the check is undone afterwards: focus is taken off that element, a form control gets its value back, and Escape is pressed once if focusing it opened something.
    - New result fields: `inconclusiveReason`, `dialog` (whether the ring sits in a dialog, and how many buttons it has), `keysTried`, `attempts` (each key pressed, where focus landed, whether the page cancelled Tab) and `sampledRing`.
    - Faster escape attempts: a Tab or Shift+Tab walk stops once focus returns to a member it has been on, rings of more than 32 members are sampled either side of their wrap, the wait after Escape ends early when the page ignored the key, and ring members are no longer found by selector on every probe. A 150-element ring takes about 9s end to end where it took 31s.
    - A sampled ring that no key leaves is reported as `inconclusive` with the new `ring-sampled` reason rather than `trapped`, because an exit from a member in the middle of it was never tried.
    - The wait after Escape is not cut short while a timer the page set on handling the key is still to fire, and a container that closes late is credited to Escape (`escapedVia: "escape-key"`) rather than to the key pressed next.
    - `timeout` now also limits the escape attempts in `verify`.
  - `@a11y-pulse/tab-orchestrator`: `SessionEndDetail.stuckIn` names the iframe a session got stuck in.
  - `@a11y-pulse/audit-runner`: the keyboard-trap message lists only the keys that were pressed, says when the component is a dialog with buttons, and reports `stuck-in-frame`, `page-edge-only` and `ring-sampled` results as needing review, the last with a note that only part of the ring was tried.

### Patch Changes

- [#110](https://github.com/A11y-Pulse/audits/pull/110) [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Harden the shared tab loop, so that pages which used to cut a session short, hang it or leave the page altered are audited in full.
  
  - `@a11y-pulse/tab-orchestrator`:
    - A session starts at the first tab stop whatever was focused beforehand (an `autofocus` field, or where an earlier session stopped), and leaves the page ready to start from the top again.
    - A Tab press that leaves nothing focused no longer ends the session when the element it reached blurred itself or was removed. A focusable `<body>` is a tab stop. Tabbable content in a shadow root after a date input or media player is no longer skipped.
    - A focus cycle through controls the page re-renders on every lap is recognised as a revisit. A re-rendered node only counts as the one it replaced when it has the same id, href, name, label and text, so a list that swaps its next page into the same place is tabbed through to the end.
    - New `maxTabPresses` (default 4096) and `maxDuration` options end a session with the new end reason `limit`.
    - A consumer that throws is detached and ended as `failed` on its own; the others finish, and `run()` then rejects. The new `failures` property lists who threw.
    - Navigation is detected without a `contextSignals` consumer, and wherever in the loop the document goes away.
    - The context observer is uninstalled when the session ends: `window.open`, form submission and the History API work as before. A soft URL change is reported once, not again each time the page re-asserts the same URL.
    - `TabSessionStats.dialogsDismissed` and `ContextChangeSignals.openedDialog` report native dialogs raised on focus.
  - `@a11y-pulse/browser-adaptor`:
    - `PuppeteerAdaptor` and `PlaywrightAdaptor` dismiss native dialogs, so an `alert` on focus cannot hang an audit, and count them through the new optional `BrowserAdaptor.takeDismissedDialogs`. **This changes the default behaviour of both adaptors:** with the default `dismissDialogs: true` they dismiss dialogs for as long as a tab session runs (through the new optional `BrowserAdaptor.startDismissingDialogs`), answering each dialog only after any `dialog` listener of your own has been called. Outside a session they leave dialogs alone, and a dialog still open when a session starts is closed then. Pass `dismissDialogs: "always"` to dismiss for the page's lifetime, which the audit runner does, or `false` to opt out.
    - `truncateHtml` reads an input's type from its own `type` attribute, so text such as `type=submit` inside another attribute cannot stop a password's `value` being redacted.
    - `getSelector` prefixes each shadow host (`site-footer >>> a.link`) so a selector for an element in a shadow root can no longer resolve to a different element in the light DOM. New `resolveSelector` turns a selector back into its element.
    - `truncateHtml` finds the end of the opening tag when an attribute contains `>`, never cuts through a character reference or surrogate pair, trims `data:` URIs, and redacts the `value` of text-entry inputs.
    - `PlaywrightAdaptor.evaluate` falls back to calling the page function by handle when the page's Content-Security-Policy refuses `new Function`.
  - `@a11y-pulse/keyboard-trap-audit`: find cycle members named by a shadow-root selector instead of throwing on it.
- Updated dependencies [[`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb)]:
  - @a11y-pulse/browser-adaptor@0.10.0
  - @a11y-pulse/tab-orchestrator@0.10.0

## 0.1.0

### Minor Changes

- [#86](https://github.com/A11y-Pulse/audits/pull/86) [`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/keyboard-trap-audit`, a WCAG 2.1.2 No Keyboard Trap audit that rides the shared tab loop, detects focus cycling within part of the page, and tries Escape, Shift+Tab, arrow keys and Tab before reporting a trap for review. The audit runner reports it as `keyboard-trap`, and runs its escape attempts after every other audit because they can change the page. Tab consumers' `onSessionEnd` receives a second argument naming the element whose revisit ended the session.

### Patch Changes

- Updated dependencies [[`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e), [`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e), [`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e)]:
  - @a11y-pulse/browser-adaptor@0.6.0
  - @a11y-pulse/tab-orchestrator@0.7.0
