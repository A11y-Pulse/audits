---
"@a11y-pulse/resize-text-audit": minor
"@a11y-pulse/text-spacing-audit": minor
---

Add `@a11y-pulse/resize-text-audit`, an audit for WCAG 1.4.4 Resize Text.

- It halves the CSS viewport, which is the layout a page gets at 200% browser zoom, and reports text that the zoomed layout cuts off (`clipped`) or lays over other text (`overlap`), with the clipping element, the overflow in px, rects and a screenshot taken while zoomed.
- Text that only the zoomed layout renders (a header behind a `max-width` media query) is measured too. With no full-size measurement to compare it with, text among it that a box cuts into is reported with `noBaseline` and is meant for review.
- Text that can still be scrolled to, text an ellipsis or line clamp truncates, text that was already cut off, and content the narrow layout hides outright (an off-canvas menu) are not reported.
- Overlap counts text only as far as its clipping ancestors leave it showing, so the part of a title that an ellipsis hides does not overlap what it lies under, while text whose `text-overflow` has nothing to act on is compared like any other.
- The bundled adaptors read the window's own size when no viewport is being emulated (`defaultViewport: null`), and the Puppeteer adaptor drops its emulation again when the audit is done.
- The result carries the page's viewport meta tag and whether it stops users zooming (`user-scalable=no`, `maximum-scale` below 2).

The text measurement is shared with the text spacing audit, which now exports its page scripts from `@a11y-pulse/text-spacing-audit/measure`, adds a `remeasureScript` that re-measures without applying the spacing override (and can collect the candidates again under the styles that now apply), and describes how each finding's element is currently styled (`overflowX`, `overflowY`, `truncates`, `visible`). The text spacing audit uses that description to drop overlaps in which either element cannot be seen, such as a closed menu faded out with `opacity: 0`.
