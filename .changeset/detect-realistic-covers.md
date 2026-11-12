---
"@a11y-pulse/focus-not-obscured-audit": minor
"@a11y-pulse/tab-orchestrator": minor
"@a11y-pulse/audit-runner": patch
---

Detect realistic covers in the focus-not-obscured audit.

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
