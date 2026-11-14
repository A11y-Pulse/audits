# @a11y-pulse/tab-orchestrator

## 0.10.0

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

- [#110](https://github.com/A11y-Pulse/audits/pull/110) [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Check the contrast of focus indicators (WCAG 1.4.11 Non-text Contrast).
  
  - `@a11y-pulse/focus-appearance-audit`: each element whose indicator can be measured gains `indicatorContrast`: the ratio, the two colours, what they were compared against and how they were found. The indicator is compared with the colours next to it, as 1.4.11 asks, not with how the element looked before focus: an outline or box-shadow outside the element with the background behind the element; an inset shadow or an outline pulled inside by a negative `outline-offset` with the element's own fill; a border with either; a background fill with the surroundings; an indicator found only in the screenshots with the unchanged pixels next to it. Text colour is never measured. Where the unfocused colour of the measured part is known, `stateChangeRatio` gives the contrast between the two states, for information only. The ratio is `null`, with a `reason`, for translucent colours, when too little changed, when what is next to the indicator has no single colour, and when a weak indicator was still transitioning in; over an image or gradient, or for an element positioned over other content, the screenshots are used. The browser's default focus ring is not measured, however it was found. `summary.lowContrastIndicators` counts indicators under the new `MIN_INDICATOR_CONTRAST` (3), less those whose only change is one colour that `colorOnly` measured; the new `hasLowContrastIndicator` is the test. `passed` is unaffected.
  - `@a11y-pulse/tab-orchestrator`: when styles are read, a tab stop's `activeElement` also carries `backdrop` (the first opaque background colour behind the element, or `null` when it cannot be told from the ancestors: behind an image or translucent colour, or for an element positioned out of the flow) and `animating` (a transition or animation was running on or around it). `outline-offset` joins `FOCUS_STYLE_PROPERTIES`.
  - `@a11y-pulse/audit-runner`: new `focusIndicatorContrastToAxe` mapping for the `focus-indicator-contrast` audit. An element whose only focus change is one colour is left to `focus-color-only` when that audit measured the change, and reported here when it could not.

- [#110](https://github.com/A11y-Pulse/audits/pull/110) [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Detect realistic covers in the focus-not-obscured audit.
  
  - `@a11y-pulse/focus-not-obscured-audit`:
    - A cover is judged as a whole instead of by the one element that was hit: a cookie banner whose background is on its container, a fixed image known to be solid, a gradient footer and a bar made of several children are now violations, and `obscuredBy` names the banner rather than the paragraph inside it.
    - Layers that paint nothing where the element is (an empty toast container over the viewport, a fully transparent image) are looked through to whatever lies beneath them. Frames, and canvases and images that cannot be established to be solid, make an element beneath them `incomplete` rather than a violation.
    - Opaque covers with `pointer-events: none` are found. Click-through layers that paint and hold nothing, and click-through canvases, frames and images not known to be solid, are left alone.
    - A custom checkbox or switch whose real input is transparent or clipped is no longer reported as hidden by its own visible part; its label is measured in its place.
    - Elements are measured once they have stopped moving, so `scroll-behavior: smooth` no longer leaves below-the-fold elements `incomplete`.
    - New scrolled-to-top check (`checkScrolledToTop`, run automatically by `runFocusNotObscuredAudit`, capped by the new `scrolledToTopLimit` option) finds elements a sticky header hides; they are reported with `foundBy: "scrolled-to-top"`.
    - The evidence screenshot is a strip of the viewport with the focused element outlined, rather than a clip that showed only the cover. `measurement` gains `rect`, `measured`, `notPainted`, and `obscuredBy.rect`, `.position` and `.ignoresPointerEvents`. `summary` gains `scrolledToTopChecked`.
  - `@a11y-pulse/tab-orchestrator`: the obscuring measurement behind the above; `TabSessionHandle.screenshotContext()`; exports `measureObscuringScript`, `obscurerHandleScript`, `clearObscurerScript`, `toObscuredMeasurement`, `captureContextScreenshot`, `OBSCURER_ATTR` and `OBSCURING_RECHECK_DELAY_MS`.
  - `@a11y-pulse/audit-runner`: runs the scrolled-to-top check after the tab pass and words its findings separately.

- [#110](https://github.com/A11y-Pulse/audits/pull/110) [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Fix focus appearance false passes and false failures.
  
  - `@a11y-pulse/focus-appearance-audit`:
    - A focused element that draws nothing itself (fully transparent, clipped to a pixel or positioned off the page, as the real input of a custom checkbox, radio or switch usually is) no longer passes on the browser's default outline. Its label, or else its nearest visible ancestor, is compared with and without focus instead; `measuredOn` says which.
    - Outlines, borders and box-shadows drawn in a fully transparent colour (`outline: 2px solid transparent`) and pseudo-elements that generate no content are no longer counted as indicators.
    - The text caret is hidden in the screenshots on every engine. A text field that shows only its caret on focus is reported with `detectionMethod: "caret"` and `needsReview: "caret"`.
    - Before an element fails, the styles of its three nearest ancestors and its labels are compared, so an indicator on a `:focus-within` wrapper or a label passes; `indicatorOn` says where it was found. A wrapper that holds other tab stops too (an input group) does not say which of them has focus, and one with a CSS animation running differs from one read to the next regardless: an element with nothing else to show is reported with `needsReview: "shared-indicator"` or `needsReview: "animating"` instead of passing.
    - For a hidden input with a label, the screenshots also take in the input's nearest visible ancestor, so an indicator drawn on a sibling box away from the label is found.
    - CSS transitions are given up to half a second to finish before each screenshot, so an indicator that fades in is compared in its final state.
    - An element that stays covered by other content while it is measured is reported with `needsReview: "obstructed"` instead of failing.
    - `colorOnly` now also covers an existing border, an existing outline or the background changing colour alone, and gains `property` and `backgroundColor`. A background that is see-through in one state is measured against the colour behind the element.
    - New `changedProperties` on style passes, `summary.needsReview` and `summary.reachedScreenshotLimit`. `summary.passed` and `summary.failed` no longer include elements that need review.
    - New `screenshotLimit` option (default 50) caps how many elements keep their screenshots.
  - `@a11y-pulse/tab-orchestrator`: an unfocused pair photographs the label or nearest visible ancestor of an element that draws nothing itself, hides the text caret, and reports `clipTarget`, `unpainted`, `obstructed`, `caretHidden`, `context` (the surrounding elements' styles with and without focus, each marked `shared` or `animating` where that applies) and `background`. With a label as the target, the pair also covers the element's nearest visible ancestor. Running transitions are waited for, and a capture that fails part-way puts the page back and returns focus before rethrowing. `opacity` joins `FOCUS_STYLE_PROPERTIES`.
  - `@a11y-pulse/audit-runner`: `focus-appearance` reports caret-only text fields, covered elements, and elements whose only indicator is on a shared or animating container as `incomplete`, and `focus-color-only` names which colour changed and what it is seen against.

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

### Patch Changes

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
- Updated dependencies [[`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb)]:
  - @a11y-pulse/browser-adaptor@0.10.0

## 0.9.0

### Minor Changes

- [#97](https://github.com/A11y-Pulse/audits/pull/97) [`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Screenshot elements with context-change-on-focus findings. Each element with a finding gets a `screenshot` (up to the new `screenshotLimit` option, default 10), except after a navigation, when the original page is gone. The tab orchestrator now lets a `screenshot` declarer capture the element behind a focus-removal stop. The audit runner attaches the screenshot as `context-change-on-focus-evidence`.

### Patch Changes

- [#97](https://github.com/A11y-Pulse/audits/pull/97) [`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Screenshot failed skip links and flagged image alt text.
  
  - `@a11y-pulse/skip-link-audit`: a failed skip link gets a `screenshot` of the link while focused. `SkipLinkAuditAdaptor` now requires `screenshotClip`; the bundled Puppeteer and Playwright adaptors already provide it.
  - `@a11y-pulse/filename-alt-text-audit`: listed `failed` and `needsReview` images get a `screenshot`, up to the new `screenshotLimit` option (default 10, `failed` first). Each image is scrolled into view, and a lazy image is loaded before capture. The page's scroll position is restored afterwards.
  - `@a11y-pulse/browser-adaptor`: add `captureElementScreenshot` and `stashedElementHandle`. The page scripts behind them (`pageDimensionsScript`, `elementRectScript`, `needsCentringScript`, `scrollToCenterScript`) move here from `@a11y-pulse/tab-orchestrator`, which still re-exports them.
  - `@a11y-pulse/tab-orchestrator`: centring an element before a capture now measures the viewport correctly on quirks-mode pages, where it previously measured the whole document and could capture a blank region.
  - `@a11y-pulse/audit-runner`: attach the screenshots as `skip-link-activation-evidence` and `filename-alt-text-evidence`.
- Updated dependencies [[`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5)]:
  - @a11y-pulse/browser-adaptor@0.9.0

## 0.8.0

### Minor Changes

- [#88](https://github.com/A11y-Pulse/audits/pull/88) [`1460dca`](https://github.com/A11y-Pulse/audits/commit/1460dca8c6328b292606a8b3925737708cdef7d9) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - `run()` now resolves to `TabSessionStats`: the tab stops delivered, unfocused pairs and screenshots captured, time spent capturing them, total duration, and how the session ended. Use it to monitor what the shared tab session costs.

## 0.7.0

### Minor Changes

- [#86](https://github.com/A11y-Pulse/audits/pull/86) [`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/keyboard-trap-audit`, a WCAG 2.1.2 No Keyboard Trap audit that rides the shared tab loop, detects focus cycling within part of the page, and tries Escape, Shift+Tab, arrow keys and Tab before reporting a trap for review. The audit runner reports it as `keyboard-trap`, and runs its escape attempts after every other audit because they can change the page. Tab consumers' `onSessionEnd` receives a second argument naming the element whose revisit ended the session.

- [#86](https://github.com/A11y-Pulse/audits/pull/86) [`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - The tab loop now marks elements the baseline missed (media players, `<summary>`, content added after load) when they first take focus, and treats consecutive Tab presses that leave focus on the same element as that control's internal stops instead of a revisit. A page with `<audio controls>` no longer runs the loop to its marker limit, and a date input no longer ends the session early. When focus stays put, the loop tells the page cancelling Tab (a cycle of one), the end of the tab order in browsers that keep focus on the last element (a normal end), and a control that never lets go (a cycle of one after ten presses) apart. `installTabObserverScript`, `tabPreventedScript`, `heldFocusScript` and `markActiveElementScript` are exported for consumers that press keys of their own. Focus that spends more than 256 consecutive Tab presses inside iframes ends the session with the new `"stuck"` reason, rather than tabbing forever.

### Patch Changes

- Updated dependencies [[`663f71f`](https://github.com/A11y-Pulse/audits/commit/663f71faaf33f1a872e7f3e1b06c4691dbcb232e)]:
  - @a11y-pulse/browser-adaptor@0.6.0

## 0.6.1

### Patch Changes

- [#69](https://github.com/A11y-Pulse/audits/pull/69) [`662a089`](https://github.com/A11y-Pulse/audits/commit/662a0893d6366a022c50c47ac126d7df072eb138) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Centre an element in the viewport before capturing its focused and unfocused screenshots when the padded clip would hang past a viewport edge, not only when its centre is covered. Screenshots only capture what is inside the viewport, and Tab scrolls an element just barely into view, so an indicator drawn in the clip padding at that edge could be lost.
  
  `scrollToCenterScript` scrolls the window directly instead of calling `scrollIntoView()`. Chromium moves the sequential focus navigation starting point to the element passed to `scrollIntoView()`, so when focus could not be handed back afterwards (a closed shadow host) the next Tab re-entered the same element and the session looped until it hit its element limit.
- Updated dependencies [[`662a089`](https://github.com/A11y-Pulse/audits/commit/662a0893d6366a022c50c47ac126d7df072eb138)]:
  - @a11y-pulse/browser-adaptor@0.5.0

## 0.6.0

### Minor Changes

- [#52](https://github.com/A11y-Pulse/audits/pull/52) [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Make `@a11y-pulse/browser-adaptor` the single home for the browser primitives that `@a11y-pulse/tab-orchestrator` had forked: `BrowserAdaptor`, `ElementRef`, `Rect`, `PuppeteerAdaptor`, `bufferedClip`, `getSelector` and `truncateHtml`. The copies were byte-identical and had already started to drift.
  
  `BrowserAdaptor` gains the `scale` parameter and optional `screenshotClipScale` that `ReflowAuditAdaptor` and `TextSpacingAuditAdaptor` already had, and the shared `PuppeteerAdaptor` picks up the fork's `screenshotClipScale = 2`, `optimizeForSpeed` and `clip.scale`.
  
  **Breaking:** `@a11y-pulse/tab-orchestrator` no longer exports `BrowserAdaptor`, `ElementRef`, `Rect`, `bufferedClip`, `getSelector`, `truncateHtml` or `TruncateHtmlOptions`, and its `./puppeteer` subpath is gone. Import them from `@a11y-pulse/browser-adaptor` (or `@a11y-pulse/browser-adaptor/dom` for `getSelector` and `truncateHtml`), and add that package to your dependencies. The tab-orchestrator no longer declares `puppeteer` as a peer dependency, since it ships no adaptor of its own.
  
  **Breaking:** `BrowserAdaptor` requires `pressEnter`, which the tab-orchestrator's fork did not declare. The bundled adaptors already implement it; a hand-written adaptor passed to `createTabOrchestrator` needs to add it, even though the tab loop itself never presses Enter.
  
  The audit packages re-export the same type names as before, so `FocusAppearanceAuditAdaptor` and friends are unchanged for their callers.

### Patch Changes

- [#52](https://github.com/A11y-Pulse/audits/pull/52) [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Recognise Playwright's closed-target message ("Target page, context or browser has been closed") as a destroyed execution context, so a mid-session navigation ends the tab session instead of throwing.
- Updated dependencies [[`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04), [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04)]:
  - @a11y-pulse/browser-adaptor@0.4.0

## 0.5.0

### Minor Changes

- [`abe4b4e`](https://github.com/A11y-Pulse/audits/commit/abe4b4e48bf8bfaa59e5be2d4c158803083e8ffd) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Relicense under MIT. These packages carry no automation-library or audit logic of their own, so the PolyForm Shield restrictions only discouraged contributions such as new browser adaptors. The audit packages remain under PolyForm Shield 1.0.0.

## 0.4.0

### Minor Changes

- [#40](https://github.com/A11y-Pulse/audits/pull/40) [`6514f41`](https://github.com/A11y-Pulse/audits/commit/6514f416171cfc36dfad4eb15f6081e3b2971978) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Verify the page still reports focus at the point each tab stop is measured, not only before the tab press.
  
  Chromium stops matching `:focus` and `:focus-visible` the moment a document loses focus, so an element measured in that state reads as having no indicator however correct its CSS is, and its focused and unfocused screenshots come out pixel-identical. The session previously checked `document.hasFocus()` once per stop, before `pressTab()`, which is the least informative moment: the tab press itself re-activates a backgrounded page. A page that lost focus after the press was measured anyway, and consumers reported the result as a genuine failure.
  
  The loop now re-checks at the point of measurement and re-asserts focus reporting once before giving up, ending the session as `lostFocus` rather than recording a measurement taken without focus.
  
  The check exempts a stop that probes as `<body>`. The tab press that leaves the last element takes focus out of the document with it, so the end of the tab order is indistinguishable from a stolen focus by `document.hasFocus()` alone, and focus emulation cannot restore it. Only a real element measured without focus ends the session; running out of elements to tab to still ends it as `completed`.
  
  Adds a `hasFocusScript` export so adaptors and tests can address the check directly.

## 0.3.0

### Minor Changes

- [#29](https://github.com/A11y-Pulse/audits/pull/29) [`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add a `screenshot` capability and `session.screenshotClip()` to `TabSessionHandle`, for a consumer to capture a clipped, padded screenshot of the currently focused element on demand (mirrors the existing `ensureUnfocusedPair()` lazy-capture pattern: only computed when a declaring consumer calls it, cached per stop).

### Patch Changes

- [#29](https://github.com/A11y-Pulse/audits/pull/29) [`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - `clearMarkersScript` (run automatically when a tab session ends) now scrolls the page back to `(0, 0)`. Walking through focusable elements scrolls later ones into view, and nothing previously undid that once the session finished, leaving the page scrolled wherever the walk left it.

## 0.2.0

### Minor Changes

- [#24](https://github.com/A11y-Pulse/audits/pull/24) [`6863b2e`](https://github.com/A11y-Pulse/audits/commit/6863b2eac852a2b54301d645c342f742b4edd6dc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Extract `@a11y-pulse/tab-orchestrator` and run focus-appearance as a consumer. Import `PuppeteerAdaptor` from `@a11y-pulse/tab-orchestrator/puppeteer`.
