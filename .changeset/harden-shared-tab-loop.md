---
"@a11y-pulse/tab-orchestrator": minor
"@a11y-pulse/browser-adaptor": minor
"@a11y-pulse/keyboard-trap-audit": patch
---

Harden the shared tab loop, so that pages which used to cut a session short, hang it or leave the page altered are audited in full.

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
