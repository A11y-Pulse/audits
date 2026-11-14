# @a11y-pulse/audit-runner

## 0.11.0

### Minor Changes

- [#110](https://github.com/A11y-Pulse/audits/pull/110) [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Check the contrast of focus indicators (WCAG 1.4.11 Non-text Contrast).
  
  - `@a11y-pulse/focus-appearance-audit`: each element whose indicator can be measured gains `indicatorContrast`: the ratio, the two colours, what they were compared against and how they were found. The indicator is compared with the colours next to it, as 1.4.11 asks, not with how the element looked before focus: an outline or box-shadow outside the element with the background behind the element; an inset shadow or an outline pulled inside by a negative `outline-offset` with the element's own fill; a border with either; a background fill with the surroundings; an indicator found only in the screenshots with the unchanged pixels next to it. Text colour is never measured. Where the unfocused colour of the measured part is known, `stateChangeRatio` gives the contrast between the two states, for information only. The ratio is `null`, with a `reason`, for translucent colours, when too little changed, when what is next to the indicator has no single colour, and when a weak indicator was still transitioning in; over an image or gradient, or for an element positioned over other content, the screenshots are used. The browser's default focus ring is not measured, however it was found. `summary.lowContrastIndicators` counts indicators under the new `MIN_INDICATOR_CONTRAST` (3), less those whose only change is one colour that `colorOnly` measured; the new `hasLowContrastIndicator` is the test. `passed` is unaffected.
  - `@a11y-pulse/tab-orchestrator`: when styles are read, a tab stop's `activeElement` also carries `backdrop` (the first opaque background colour behind the element, or `null` when it cannot be told from the ancestors: behind an image or translucent colour, or for an element positioned out of the flow) and `animating` (a transition or animation was running on or around it). `outline-offset` joins `FOCUS_STYLE_PROPERTIES`.
  - `@a11y-pulse/audit-runner`: new `focusIndicatorContrastToAxe` mapping for the `focus-indicator-contrast` audit. An element whose only focus change is one colour is left to `focus-color-only` when that audit measured the change, and reported here when it could not.

- [#114](https://github.com/A11y-Pulse/audits/pull/114) [`12583d4`](https://github.com/A11y-Pulse/audits/commit/12583d478a46af27bfa173f6233357840e2e6d68) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Run the new audits from the audit runner. `runAllAudits` and the CLI now also report `focus-indicator-contrast` (WCAG 1.4.11, read from the focus appearance audit's measurements), `keyboard-reachability` and `control-without-role` (WCAG 2.1.1 and 4.1.2, sharing the tab pass), `accessible-authentication` (WCAG 3.3.8), `resize-text` (WCAG 1.4.4), `moving-content` (WCAG 2.2.2) and `disclosure-operability` (WCAG 2.1.1 and 4.1.2). The moving content audit watches the page for five seconds, so every run now takes at least that long.
  
  Audits can be left out with the new `--skip <ids>` flag or the `skip` option, by the ids in the exported `AUDIT_IDS` (`--list-audits` prints them); a skipped audit does no work and is not reported, and an unknown id is an error. `AuditAdaptors` gains two optional adaptors, `unreachableControls` and `resizeText`. The resize text audit is reported as `inapplicable` from a viewport narrower than 640 CSS px. The evidence of `focus-indicator-contrast` now carries the measurement in `data` on every node, `moving-content-evidence` names its `finding` as `reason`, and `disclosure-operability-evidence` includes `signals`.
  
  `@a11y-pulse/resize-text-audit`: text that an ellipsis or line clamp cuts short is no longer reported as overlapping the element its unclipped length would reach.

- [#114](https://github.com/A11y-Pulse/audits/pull/114) [`12583d4`](https://github.com/A11y-Pulse/audits/commit/12583d478a46af27bfa173f6233357840e2e6d68) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Make the runner robust to hostile pages. An audit that throws or runs out of time is reported as `incomplete` under its own id (tagged `a11y-pulse.audit-failed`) instead of losing every other result. A page that navigates away while being tabbed through is reloaded before the remaining audits. HTTP errors and non-HTML responses are no longer audited as valid pages unless `--ignore-http-errors` is given, a network that never goes idle is a warning rather than a failure, and axe-core now runs inside same-origin iframes. Adds `--timeout`, `--max-duration`, the `maxDuration`, `tabSession`, `url` and `onWarning` options, and documented exit codes. The time limit holds on a page that has stopped responding, and when it falls inside the shared tab pass the keyboard-driven audits report on the stops reached. A browser or page that closes mid-run rejects with `BrowserClosedError` (CLI exit 1) rather than reporting every audit as incomplete, and an interrupted run (exit 130 for SIGINT, 143 for SIGTERM) never writes a report.

- [#114](https://github.com/A11y-Pulse/audits/pull/114) [`12583d4`](https://github.com/A11y-Pulse/audits/commit/12583d478a46af27bfa173f6233357840e2e6d68) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Surface review findings and evidence in the runner's output. `--format simple` now lists the `incomplete` results under "needs review" (including audits that could not run) and prints why each element was flagged, so a page with a keyboard trap no longer reads as clean. Every node's evidence check carries the audit's structured measurements in `data`, with the screenshot optional, and keyboard-trap, focus-order, orphaned-tab-roles and suspicious-accessible-name gain evidence checks. Audits that ran but could not reach a conclusion are reported as `incomplete` with the tag `a11y-pulse.audit-inconclusive` and a reason instead of nothing, audits with nothing to check are `inapplicable`, and passing nodes no longer carry a failure message.

### Patch Changes

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

- [#110](https://github.com/A11y-Pulse/audits/pull/110) [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Catch more focus order failures, and stop reporting text set in columns.
  
  - `@a11y-pulse/focus-order-audit`:
    - One backwards jump to or from an element with a positive `tabindex` is now enough to report a page, so a form given `tabindex="1"`, `"2"`, `"3"` part-way down the page is found.
    - New `backwards-drift` transition kind: a run of three or more short climbs that together exceed a viewport, such as a long list stacked with `column-reverse`, is reported as one transition spanning the run. The run carries on across steps part of the way back down, so a reversed feed whose cards each hold two stacked controls is found too.
    - A climb to the top of the next column (CSS multi-column text, or a grid filled column by column) is no longer a backwards jump, however tall the columns are, including text with links part-way along its lines and cards with two controls side by side. The next column has to start level with or below the columns before it, give or take its first element's height, and a move to or from a positive `tabindex` is never taken for a wrap.
    - Each transition now carries `distance` (reading-order pixels), `direction` (on screen) and `steps`, and each element its `rect` and, when it has one, its own `positiveTabindex`. `SequenceStop` accepts an optional `positiveTabindex` for callers of `findDisorder`.
  - `@a11y-pulse/audit-runner`: describe a backwards drift, say which way on screen focus went (backwards is sideways on a vertical page), and name the element whose positive `tabindex` is behind a move.

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

- [#112](https://github.com/A11y-Pulse/audits/pull/112) [`7cce2b9`](https://github.com/A11y-Pulse/audits/commit/7cce2b9d752fc7fb122555016b05f75fff250402) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Refine the alt text and accessible name heuristics.
  
  `filename-alt-text-audit`:
  
  - Reads lazy-loading sources (`data-src`, `data-lazy-src`, `data-original`, `data-srcset`, `data-lazy-srcset`) and the CSS background of `role="img"` elements.
  - Matches the filename as it was uploaded, before a CMS or bundler added `-300x200`, `-scaled`, `@2x` or a content hash.
  - Checks `role="img"` elements with an `aria-label`, inline `<svg role="img">` titles and linked `<area>` elements, and skips images made presentational.
  - Adds the `artefact` signal, a failure, for alt text that is `undefined`, `null` or `NaN` in exactly that spelling, `[object Object]`, or an unrendered template token, including one written across several lines.
  - Stops reporting a single plain word that is also the filename ("GitHub" on `github.svg`), short numbers ("1", "2024") and "Pano 360".
  - Reports where the text came from as `altTextSource`.
  - Waits once, for up to 2 seconds in total, for the images it screenshots, instead of up to 2 seconds for each.
  
  `suspicious-accessible-name-audit`:
  
  - A name that matches the element's `id`, `class` or `name` is only reviewed when it comes from a visible `<label>`, `aria-labelledby` target or button value, and passes unless the value has a separator. A plain word that is also the `id`, `class` or `name` ("Title" on `id="title"`) no longer matches from any source. Only test-id attributes are compared among `data-*`.
  - "True", "False", "Test", "Label", "Banner", "Element" and "Module" are reviewed rather than failed, and can be changed with the new `reviewWords` vocabulary list.
  - A name that is nothing but a template token or `[object Object]` fails from any source, visible text included. A token among other words is reviewed rather than failed.
  - Translation keys with a namespace or a camelCase or snake_case part, such as `nav.homeTitle` and `common:buttons.submit`, are reviewed as an `identifier-pattern`. Hosts, packages and file names pass.
  - "undefined", "null" and "NaN" only fail in exactly that spelling.
  - Template tokens are matched in time linear in the length of the name.
  - "Please select" is no longer a role word.
  - An inline SVG's `<title>` now counts towards the name of the control around it.
  - `evidence` holds the matched template token, and the new `labelSelector` points at the labelling element of a flagged name. `classifyName` returns a `verdict`.
  - Elements past `elementLimit` are counted without computing their names.
  
  `audit-runner`: describes the new `artefact` alt text signal.

- [#111](https://github.com/A11y-Pulse/audits/pull/111) [`b5ef317`](https://github.com/A11y-Pulse/audits/commit/b5ef317b28ef92ed3d7712f71c169a2e191f2f0f) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Improve the reflow audit's accuracy and evidence.
  
  - Content clipped by a viewport-fitting `overflow: hidden` / `clip` ancestor is no longer reported as a violation.
  - The layout must hold still for `minSettleMs` (300ms by default) before it is measured, so debounced resize handlers have run. `settleAttempts` now defaults to 20.
  - Text that overflows without wrapping is attributed to its element (`text-overflow`).
  - New review-only offender reasons: `media-overflow` (an `img`, `video` or `iframe` wider than the viewport, previously a silent pass, and reported on the media itself when a `<picture>` or link wraps it), `clipped-content` (content cut off by `overflow-x: hidden` on `html` or `body`, or inside a `position: fixed` box that does not scroll it) and `scrolling-container` (most of the page inside a horizontal scroller, with the content that is too wide for it listed in the new `overflowing` field). Offenders with no document overflow now make the result `incomplete`.
  - A `position: fixed` box that scrolls or clips its own overflow, such as a tab bar or a dialog, contains its content like any other.
  - Only tables with header cells, a caption, `thead`, `scope`/`headers` or a table role are exempt as data tables.
  - Right-to-left pages are measured at their left edge, and measurement no longer depends on the scroll position.
  - Offenders carry their document `rect`, and screenshots are clipped in document coordinates and widened to show an offender that lies wholly beyond the viewport, on the left of a right-to-left page as well as on the right.
  - The bundled adaptors read the window's real size when the page has no emulated viewport, where they used to assume 800x600, and the Puppeteer adaptor clears its emulation again when the audit restores the viewport.
  - The audit no longer waits for the layout to settle again after restoring the viewport.
  
  The runner's failure summaries describe each new offender reason and name what is too wide inside a scrolling container.

- [#112](https://github.com/A11y-Pulse/audits/pull/112) [`7cce2b9`](https://github.com/A11y-Pulse/audits/commit/7cce2b9d752fc7fb122555016b05f75fff250402) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Reduce false results from the skip link audit.
  
  - Skip links whose target has nothing focusable inside (`<h1 id>`, an empty `<a id>`) now pass when the next Tab lands after the target.
  - Menu toggles and other in-page links are no longer treated as skip links: a link without skip wording counts only when its target is the page's main content (a heading, the `main` landmark or around it, or a conventional id such as `content`), is rendered and is not a navigation block. Links with `aria-expanded`, `role="tab"` or `role="button"` are never activated.
  - Skip wording is matched on whole words in the link's text and `aria-label`, and "go to" verbs need a content or navigation noun, so "Popular posts" or "Aller au panier" no longer count. `class` and `id` only count when they are a skip token such as `skip-link`.
  - Script-driven skip links whose fragment matches nothing are activated and pass when focus moves to later content.
  - Same-document links written as `/page#main` or an absolute URL are recognised.
  - A target that is not rendered is reported as `target-hidden`, and fragments no longer resolve to form controls or meta tags that share the name.
  - Skip links that can never receive focus are reported under the new `unreachable` field.
  - Results now carry the link text, the target, and where focus went after Enter and after the follow-up Tab.
  - The URL, `:target` and scroll position are restored after each activation, and when the audit ends focus is dropped and the next Tab press starts from the first tab stop again, whether or not a skip link was found. The history entry added by following a fragment link remains as a forward entry.
- Updated dependencies [[`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`7cce2b9`](https://github.com/A11y-Pulse/audits/commit/7cce2b9d752fc7fb122555016b05f75fff250402), [`7cce2b9`](https://github.com/A11y-Pulse/audits/commit/7cce2b9d752fc7fb122555016b05f75fff250402), [`b5ef317`](https://github.com/A11y-Pulse/audits/commit/b5ef317b28ef92ed3d7712f71c169a2e191f2f0f), [`12583d4`](https://github.com/A11y-Pulse/audits/commit/12583d478a46af27bfa173f6233357840e2e6d68), [`7cce2b9`](https://github.com/A11y-Pulse/audits/commit/7cce2b9d752fc7fb122555016b05f75fff250402), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`b5ef317`](https://github.com/A11y-Pulse/audits/commit/b5ef317b28ef92ed3d7712f71c169a2e191f2f0f)]:
  - @a11y-pulse/disclosure-operability-audit@0.1.0
  - @a11y-pulse/browser-adaptor@0.10.0
  - @a11y-pulse/moving-content-audit@0.2.0
  - @a11y-pulse/paste-blocking-audit@0.1.0
  - @a11y-pulse/resize-text-audit@0.1.0
  - @a11y-pulse/text-spacing-audit@0.4.0
  - @a11y-pulse/unreachable-controls-audit@0.1.0
  - @a11y-pulse/context-change-on-focus-audit@0.5.0
  - @a11y-pulse/tab-orchestrator@0.10.0
  - @a11y-pulse/focus-order-audit@0.2.0
  - @a11y-pulse/focus-appearance-audit@0.7.0
  - @a11y-pulse/focus-not-obscured-audit@0.5.0
  - @a11y-pulse/keyboard-trap-audit@0.2.0
  - @a11y-pulse/orphaned-tab-roles-audit@0.2.0
  - @a11y-pulse/filename-alt-text-audit@0.3.0
  - @a11y-pulse/suspicious-accessible-name-audit@0.2.0
  - @a11y-pulse/reflow-audit@0.4.0
  - @a11y-pulse/skip-link-audit@0.3.0

## 0.10.0

### Minor Changes

- [#103](https://github.com/A11y-Pulse/audits/pull/103) [`310963f`](https://github.com/A11y-Pulse/audits/commit/310963faf4c293c320800233d10656b3615e31ee) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/suspicious-accessible-name-audit`, which flags controls, links, labelled landmarks, dialogs and iframes whose accessible name is code rather than a name. A name that is the element's own `id`, `class`, `name` or `data-*` value, a leftover script value such as "undefined", an unrendered template token or a stock placeholder is a failure; a name shaped like an identifier, a numbered placeholder such as "banner1", or one that repeats the element's role is reported for review. Each element is mapped to WCAG 1.1.1 (icon-only controls and iframes), 2.4.4 (links with no surrounding text) or 2.4.6 (everything else), with role words as best practice. The audit runner reports it as `suspicious-accessible-name`, tagging each bucket with the criteria of the elements in it.

### Patch Changes

- Updated dependencies [[`310963f`](https://github.com/A11y-Pulse/audits/commit/310963faf4c293c320800233d10656b3615e31ee)]:
  - @a11y-pulse/suspicious-accessible-name-audit@0.1.0

## 0.9.0

### Minor Changes

- [#97](https://github.com/A11y-Pulse/audits/pull/97) [`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Screenshot elements with context-change-on-focus findings. Each element with a finding gets a `screenshot` (up to the new `screenshotLimit` option, default 10), except after a navigation, when the original page is gone. The tab orchestrator now lets a `screenshot` declarer capture the element behind a focus-removal stop. The audit runner attaches the screenshot as `context-change-on-focus-evidence`.

- [#97](https://github.com/A11y-Pulse/audits/pull/97) [`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Screenshot colour-only focus indicators. When the text colour change is under 3:1 or cannot be measured, `colorOnly.evidence` holds the element's focused and unfocused screenshots. `MIN_LIGHTNESS_CONTRAST` is now exported from `@a11y-pulse/focus-appearance-audit`. The audit runner attaches the screenshots to `focus-color-only` results as `focus-color-only-evidence`.

- [#97](https://github.com/A11y-Pulse/audits/pull/97) [`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Screenshot failed skip links and flagged image alt text.
  
  - `@a11y-pulse/skip-link-audit`: a failed skip link gets a `screenshot` of the link while focused. `SkipLinkAuditAdaptor` now requires `screenshotClip`; the bundled Puppeteer and Playwright adaptors already provide it.
  - `@a11y-pulse/filename-alt-text-audit`: listed `failed` and `needsReview` images get a `screenshot`, up to the new `screenshotLimit` option (default 10, `failed` first). Each image is scrolled into view, and a lazy image is loaded before capture. The page's scroll position is restored afterwards.
  - `@a11y-pulse/browser-adaptor`: add `captureElementScreenshot` and `stashedElementHandle`. The page scripts behind them (`pageDimensionsScript`, `elementRectScript`, `needsCentringScript`, `scrollToCenterScript`) move here from `@a11y-pulse/tab-orchestrator`, which still re-exports them.
  - `@a11y-pulse/tab-orchestrator`: centring an element before a capture now measures the viewport correctly on quirks-mode pages, where it previously measured the whole document and could capture a blank region.
  - `@a11y-pulse/audit-runner`: attach the screenshots as `skip-link-activation-evidence` and `filename-alt-text-evidence`.

### Patch Changes

- Updated dependencies [[`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5), [`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5), [`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5)]:
  - @a11y-pulse/context-change-on-focus-audit@0.4.0
  - @a11y-pulse/tab-orchestrator@0.9.0
  - @a11y-pulse/focus-appearance-audit@0.6.0
  - @a11y-pulse/browser-adaptor@0.9.0
  - @a11y-pulse/skip-link-audit@0.2.0
  - @a11y-pulse/filename-alt-text-audit@0.2.0

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
