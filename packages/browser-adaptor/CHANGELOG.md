# Changelog

## 0.10.0

### Minor Changes

- [#113](https://github.com/A11y-Pulse/audits/pull/113) [`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/disclosure-operability-audit`, an audit for WCAG 2.1.1 Keyboard and 4.1.2 Name, Role, Value. It finds disclosure triggers (elements with `aria-expanded`), operates each with Enter and Space, and checks that it opens, updates `aria-expanded` and closes again. A trigger that a click or hover operates and the keyboard does not, or that shows content without updating its state, is a failure; unresponsive triggers, a state that changes with no content seen, popups only a click closes and triggers that open on focus are reported for review. Links that leave the page, submit buttons, text fields, checkboxes, radio buttons, composite-widget items and controls named for an action such as "Delete" or "Sign out" are never activated. A key is only pressed while the trigger holds keyboard focus, form submissions and navigations to another page are stopped while the audit runs, at most 20 triggers are operated, and each is put back as it was found along with focus and scrolling.
  
  `@a11y-pulse/browser-adaptor`: `KeyName` now includes `"Space"`, which both built-in adaptors already press.

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

### Patch Changes

- [#110](https://github.com/A11y-Pulse/audits/pull/110) [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Speed up the shared tab pass. On a 200-link page a pass with no captures drops from about 8.0s to 3.3s, and one that captures an unfocused pair on every stop from about 34s to 23s.
  
  - `@a11y-pulse/tab-orchestrator`:
    - The page scripts for each step travel as one composed function, so a stop that nobody captures takes two `adaptor.evaluate()` calls instead of five to eight, and an unfocused pair three more instead of seven. (These are calls on the adaptor; the driver beneath may make more than one round trip for each.) An adaptor whose `evaluate()` does not run a composed function is detected at session start and gets one call per script, with the same results. The new `composeScripts` option turns composing off.
    - The composed function is built when a session first sends one, not when the package is imported, so a host that forbids building code from strings can still import the package and gets one call per script.
    - A composed stop script that never comes back (a page whose timers and animation frames have both been stopped) is abandoned after the longest its waits could take plus three seconds, and the session carries on one script at a time. The waits inside the page end on a timer or an animation frame, whichever fires.
    - A capture is always of the element its stop was measured on, even if the page has moved focus on before a consumer asks for it.
    - `screenshotSettleDelay` is now the longest the session waits after a Tab press rather than a fixed pause. The wait ends after one animation frame unless the page set a timer for the press that comes due within the delay, or a transition, animation or smooth scroll is still moving the focused element. To tell which timers a focus handler set, the session wraps `window.setTimeout` while it runs and restores it when it ends. A capture is still never taken sooner than the full delay after the press.
    - Computed styles are only read when a consumer declares `baselineStyles` or `unfocusedPair`; other consumers get empty records in `ActiveElementInfo.styles`.
    - The element handle is only fetched on a stop where a consumer captures something, and the obscurer marker is only cleared when one was set.
    - A fully covered element whose cover is see-through is no longer measured a second time after 250ms, since it passes either way.
  - `@a11y-pulse/browser-adaptor`:
    - `PuppeteerAdaptor` and `PlaywrightAdaptor` no longer wait two animation frames before a CDP screenshot. Chromium renders a frame of the page as it stands for each capture, so the wait only cost time. The wait is kept where the capture goes through the driver's own screenshot API.
    - `getSelector` counts each candidate selector once per call and uses the browser's cached class collections, which makes it cheaper on large documents without changing what it returns.

## 0.9.0

### Minor Changes

- [#97](https://github.com/A11y-Pulse/audits/pull/97) [`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Screenshot failed skip links and flagged image alt text.
  
  - `@a11y-pulse/skip-link-audit`: a failed skip link gets a `screenshot` of the link while focused. `SkipLinkAuditAdaptor` now requires `screenshotClip`; the bundled Puppeteer and Playwright adaptors already provide it.
  - `@a11y-pulse/filename-alt-text-audit`: listed `failed` and `needsReview` images get a `screenshot`, up to the new `screenshotLimit` option (default 10, `failed` first). Each image is scrolled into view, and a lazy image is loaded before capture. The page's scroll position is restored afterwards.
  - `@a11y-pulse/browser-adaptor`: add `captureElementScreenshot` and `stashedElementHandle`. The page scripts behind them (`pageDimensionsScript`, `elementRectScript`, `needsCentringScript`, `scrollToCenterScript`) move here from `@a11y-pulse/tab-orchestrator`, which still re-exports them.
  - `@a11y-pulse/tab-orchestrator`: centring an element before a capture now measures the viewport correctly on quirks-mode pages, where it previously measured the whole document and could capture a blank region.
  - `@a11y-pulse/audit-runner`: attach the screenshots as `skip-link-activation-evidence` and `filename-alt-text-evidence`.

## 0.8.0

### Minor Changes

- [#92](https://github.com/A11y-Pulse/audits/pull/92) [`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `stashedElementSelectors` and `releaseStashedElements`, for audits that collect many elements in one evaluate and only need selectors for the ones they report.

## 0.7.0

### Minor Changes

- [#90](https://github.com/A11y-Pulse/audits/pull/90) [`37f1354`](https://github.com/A11y-Pulse/audits/commit/37f135426322697d3bb11b7e52147a0f9d6b7bfc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `parseOpaqueRgb`, `relativeLuminance` and `contrastRatio` for measuring WCAG contrast between computed colours.

## 0.6.0

### Minor Changes

- [#86](https://github.com/A11y-Pulse/audits/pull/86) [`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - `BrowserAdaptor` gains `pressKey(key)`, which presses Tab, Shift+Tab, Enter, Escape or an arrow key, so audits that press keys other than Tab and Enter share one primitive instead of extending the adaptor themselves. Both bundled adaptors implement it; a custom adaptor must add it.

## 0.5.0

### Minor Changes

- [#69](https://github.com/A11y-Pulse/audits/pull/69) [`662a089`](https://github.com/A11y-Pulse/audits/commit/662a0893d6366a022c50c47ac126d7df072eb138) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Capture clipped screenshots with `captureBeyondViewport` off, in both the Puppeteer and Playwright adaptors. To honour `captureBeyondViewport` Chromium shrinks the emulated viewport to 1x1 and resizes it for the clip before restoring it, and the page observes each of those as a real resize: `resize` fires and media queries flip to their narrowest breakpoint. On a busy renderer the page can run a whole frame at that size, so a responsive navigation collapses, the focused item is hidden and blurs, and the "focused" screenshot shows no indicator. The focus appearance audit then reported those elements as failing, more often the more load the machine was under.
  
  The Puppeteer adaptor now sends `Page.captureScreenshot` over its own CDP session rather than through `page.screenshot()`, which with `captureBeyondViewport` off would intersect the clip with the viewport and silently move the origin that callers align element rects against. **Breaking for callers of `screenshotClip`:** a clip is now only guaranteed to capture what lies inside the viewport, and what falls outside it comes back blank. `BrowserAdaptor.screenshotClip` documents that the caller scrolls the element into view first, and every audit in this repo does.
  
  Both adaptors take a `captureBeyondViewport` option to opt back in, for evidence of regions that cannot be scrolled to where the page's state does not matter. The reflow and text spacing adaptors set it, so their evidence is unchanged.

## 0.4.1

### Patch Changes

- [#65](https://github.com/A11y-Pulse/audits/pull/65) [`3e7a3ae`](https://github.com/A11y-Pulse/audits/commit/3e7a3ae187792c2a74b7656114f03032a745c1f6) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Wait for the page to paint before `screenshotClip` captures, in both the Puppeteer and Playwright adaptors. A capture taken straight after a style change could return a frame from before it, so a focus indicator that was applied but not yet painted was missing from the focused screenshot and reported as a failure.

## 0.4.0

### Minor Changes

- [#52](https://github.com/A11y-Pulse/audits/pull/52) [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Make `@a11y-pulse/browser-adaptor` the single home for the browser primitives that `@a11y-pulse/tab-orchestrator` had forked: `BrowserAdaptor`, `ElementRef`, `Rect`, `PuppeteerAdaptor`, `bufferedClip`, `getSelector` and `truncateHtml`. The copies were byte-identical and had already started to drift.
  
  `BrowserAdaptor` gains the `scale` parameter and optional `screenshotClipScale` that `ReflowAuditAdaptor` and `TextSpacingAuditAdaptor` already had, and the shared `PuppeteerAdaptor` picks up the fork's `screenshotClipScale = 2`, `optimizeForSpeed` and `clip.scale`.
  
  **Breaking:** `@a11y-pulse/tab-orchestrator` no longer exports `BrowserAdaptor`, `ElementRef`, `Rect`, `bufferedClip`, `getSelector`, `truncateHtml` or `TruncateHtmlOptions`, and its `./puppeteer` subpath is gone. Import them from `@a11y-pulse/browser-adaptor` (or `@a11y-pulse/browser-adaptor/dom` for `getSelector` and `truncateHtml`), and add that package to your dependencies. The tab-orchestrator no longer declares `puppeteer` as a peer dependency, since it ships no adaptor of its own.
  
  **Breaking:** `BrowserAdaptor` requires `pressEnter`, which the tab-orchestrator's fork did not declare. The bundled adaptors already implement it; a hand-written adaptor passed to `createTabOrchestrator` needs to add it, even though the tab loop itself never presses Enter.
  
  The audit packages re-export the same type names as before, so `FocusAppearanceAuditAdaptor` and friends are unchanged for their callers.

- [#52](https://github.com/A11y-Pulse/audits/pull/52) [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add a Playwright adaptor alongside the Puppeteer one, exported from `@a11y-pulse/browser-adaptor/playwright` and from the reflow and text-spacing packages' own `./playwright` subpaths. `playwright-core` is an optional peer dependency, so Puppeteer users are unaffected.
  
  Two behaviours differ from Puppeteer and are documented in `@a11y-pulse/browser-adaptor`'s README: `evaluate` rebuilds the page function with `new Function`, which needs `unsafe-eval` in the page's CSP; and clipped screenshots go over CDP on Chromium for pixel parity, falling back to a full-page capture at the context's own `deviceScaleFactor` on Firefox and WebKit.

## 0.3.0

### Minor Changes

- [`abe4b4e`](https://github.com/A11y-Pulse/audits/commit/abe4b4e48bf8bfaa59e5be2d4c158803083e8ffd) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Relicense under MIT. These packages carry no automation-library or audit logic of their own, so the PolyForm Shield restrictions only discouraged contributions such as new browser adaptors. The audit packages remain under PolyForm Shield 1.0.0.

## 0.2.2

### Patch Changes

- [#44](https://github.com/A11y-Pulse/audits/pull/44) [`94c45ef`](https://github.com/A11y-Pulse/audits/commit/94c45ef081b9dde56a0b0d11eff4a6e303c93d2b) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/audit-runner`, a worked example that runs every audit against a page and ships an `npx @a11y-pulse/audit-runner [url]` CLI that outputs JSON results.
  
  Each audit package now also declares a `source` export condition, matching `@a11y-pulse/tab-orchestrator`, so cross-package typechecking resolves to source and no longer depends on workspace build order.

## 0.2.1

### Patch Changes

- [#40](https://github.com/A11y-Pulse/audits/pull/40) [`6514f41`](https://github.com/A11y-Pulse/audits/commit/6514f416171cfc36dfad4eb15f6081e3b2971978) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Allow `PuppeteerAdaptor.ensureFocusReporting()` to re-assert focus emulation.
  
  Every call after the first was a permanent no-op for a given page, so emulation that had been cleared (Chrome clears it when another target takes the foreground, or when the CDP client disconnects) could never be restored. The adaptor now retains the CDP session per page and toggles the emulation off and back on, since Chromium ignores a redundant enable.

## 0.2.0

### Minor Changes

- [#29](https://github.com/A11y-Pulse/audits/pull/29) [`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - `ReflowOffender` now includes an optional `screenshot` (PNG bytes), a clipped shot of the offending element captured at the 320px measurement viewport before it's restored. `ReflowAuditAdaptor` gains a required `screenshotClip` method. `@a11y-pulse/browser-adaptor` gains a `bufferedClip` export (padded-clip geometry, ported from `@a11y-pulse/tab-orchestrator`'s implementation) that `reflow-audit` and `text-spacing-audit` both use for this.
  
  Capture is bounded: at most `screenshotLimit` (default 10) offenders are screenshotted per audit, since each is a real `page.screenshot()` call.

## 0.1.0

### Minor Changes

- [#20](https://github.com/A11y-Pulse/audits/pull/20) [`dd1fa04`](https://github.com/A11y-Pulse/audits/commit/dd1fa043ce9ae83a20d292c0336e4036d71ae0cc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/browser-adaptor` with shared `BrowserAdaptor`, `PuppeteerAdaptor`, and DOM helpers. Point `@a11y-pulse/focus-appearance-audit` at the workspace package and re-export the public adaptor types for back-compat.
