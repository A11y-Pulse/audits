---
"@a11y-pulse/tab-orchestrator": patch
---

Centre an element in the viewport before capturing its focused and unfocused screenshots when the padded clip would hang past a viewport edge, not only when its centre is covered. Screenshots only capture what is inside the viewport, and Tab scrolls an element just barely into view, so an indicator drawn in the clip padding at that edge could be lost.

`scrollToCenterScript` scrolls the window directly instead of calling `scrollIntoView()`. Chromium moves the sequential focus navigation starting point to the element passed to `scrollIntoView()`, so when focus could not be handed back afterwards (a closed shadow host) the next Tab re-entered the same element and the session looped until it hit its element limit.
