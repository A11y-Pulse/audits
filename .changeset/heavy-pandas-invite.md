---
"@a11y-pulse/browser-adaptor": minor
"@a11y-pulse/reflow-audit": minor
"@a11y-pulse/text-spacing-audit": minor
---

Add a Playwright adaptor alongside the Puppeteer one, exported from `@a11y-pulse/browser-adaptor/playwright` and from the reflow and text-spacing packages' own `./playwright` subpaths. `playwright-core` is an optional peer dependency, so Puppeteer users are unaffected.

Two behaviours differ from Puppeteer and are documented in `@a11y-pulse/browser-adaptor`'s README: `evaluate` rebuilds the page function with `new Function`, which needs `unsafe-eval` in the page's CSP; and clipped screenshots go over CDP on Chromium for pixel parity, falling back to a full-page capture at the context's own `deviceScaleFactor` on Firefox and WebKit.
