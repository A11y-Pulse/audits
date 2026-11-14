# @a11y-pulse/moving-content-audit

## 0.2.0

### Minor Changes

- [#113](https://github.com/A11y-Pulse/audits/pull/113) [`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/moving-content-audit` for WCAG 2.2.2 Pause, Stop, Hide. It watches the page for five seconds and reports regions that are still moving at the end (endless or long CSS and script animations, carousels and tickers on a timer, `<marquee>`, playing videos) with no control to pause, stop or hide them. Large regions with no control fail; small regions, colour-only animations, hover-only pausing and uncertain cases are reported for review; loading indicators and status regions are left alone.

### Patch Changes

- Updated dependencies [[`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb)]:
  - @a11y-pulse/browser-adaptor@0.10.0
