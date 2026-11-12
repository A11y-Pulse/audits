---
"@a11y-pulse/reflow-audit": minor
"@a11y-pulse/audit-runner": patch
---

Improve the reflow audit's accuracy and evidence.

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
