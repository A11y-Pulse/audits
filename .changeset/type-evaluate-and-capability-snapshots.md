---
"@a11y-pulse/browser-adaptor": minor
"@a11y-pulse/tab-orchestrator": minor
"@a11y-pulse/context-change-on-focus-audit": minor
"@a11y-pulse/focus-not-obscured-audit": minor
"@a11y-pulse/reflow-audit": minor
"@a11y-pulse/resize-text-audit": minor
"@a11y-pulse/skip-link-audit": minor
"@a11y-pulse/text-spacing-audit": minor
---

Type `evaluate` from the page function it runs. `BrowserAdaptor.evaluate` and the reflow, resize text, skip link and text spacing adaptors now take `evaluate<F extends PageFunction>(fn: F, ...args: EvaluateArgs<Parameters<F>>)` and resolve to `Awaited<ReturnType<F>>`, where `EvaluateArgs` maps each element parameter to an `ElementRef`. `PageFunction` and `EvaluateArgs` are exported from `@a11y-pulse/browser-adaptor`.

`@a11y-pulse/tab-orchestrator`: `TabConsumer<C>` and `TabStopSnapshot<C>` take the capabilities a consumer declares, so a consumer declaring `obscuring` or `contextSignals` receives those fields as required. A `contextSignals` consumer is promised only `contextSignals`, because it is also shown elements that gave focus away. The bare `TabConsumer` and `TabStopSnapshot` are unchanged. `TabSessionHandle.screenshotContext` is now required. The context observer no longer marks the audited page with a `data-a11y-ctx-attr` attribute, a cleanup failure other than the page navigating away now fails the session, and `elementStylesScript` with no properties returns empty pseudo-element records.

`@a11y-pulse/context-change-on-focus-audit` and `@a11y-pulse/focus-not-obscured-audit`: the audits' types carry their declared capabilities, and the focus not obscured audit always screenshots the context strip around an obscured element rather than falling back to a clip of the element alone.
