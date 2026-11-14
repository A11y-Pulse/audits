---
"@a11y-pulse/tab-orchestrator": minor
"@a11y-pulse/browser-adaptor": patch
---

Speed up the shared tab pass. On a 200-link page a pass with no captures drops from about 8.0s to 3.3s, and one that captures an unfocused pair on every stop from about 34s to 23s.

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
