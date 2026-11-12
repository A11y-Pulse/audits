---
"@a11y-pulse/text-spacing-audit": minor
---

Improve the accuracy, evidence and speed of the text spacing audit.

- Clipping is measured on each line of an element's text against every clipping ancestor, so nested clipping boxes are caught, decoration that already overflowed no longer hides real clipping, and text that can still be scrolled to is not reported. Everything cut off by one element is a single finding.
- Overlap compares lines of text, each only as far as its clipping and scrolling ancestors leave it showing, so a wrapped inline link is no longer reported as overlapping the text around it, and text that a box cuts off is not reported as overlapping what lies beyond the box.
- A clipping box under a scaling transform is measured at the size it is drawn, so clipped text inside a scaled ancestor is found.
- The spacing override is applied inside open shadow roots and now beats author `!important` rules in stylesheets.
- `restored` is no longer `false` on pages that transition every property.
- Findings name the clipping element (`clippedBy`), the `axis`, how many text containers are affected, the element's `rect`, and for overlaps the shared area and region. Screenshots are matched to findings by element, are positioned correctly on a scrolled page, and show both elements of an overlap.
- `truncated` on the result says when `candidateLimit` left text unmeasured.
- Selectors are only computed for findings, ancestors are inspected once, and the fixed 200ms waits are gone: `settleMs` now defaults to `0` and adds to a wait for the layout to stop changing.

`CandidateSnapshot` gains the measurements above (including `visibleTextRects`, the lines as far as they show), its `rect` is now in document coordinates, and its `selector` and `html` are empty in snapshots taken by the audit.
