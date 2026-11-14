---
"@a11y-pulse/moving-content-audit": minor
---

Add `@a11y-pulse/moving-content-audit` for WCAG 2.2.2 Pause, Stop, Hide. It watches the page for five seconds and reports regions that are still moving at the end (endless or long CSS and script animations, carousels and tickers on a timer, `<marquee>`, playing videos) with no control to pause, stop or hide them. Large regions with no control fail; small regions, colour-only animations, hover-only pausing and uncertain cases are reported for review; loading indicators and status regions are left alone.
