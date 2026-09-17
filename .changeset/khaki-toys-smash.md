---
"@a11y-pulse/browser-adaptor": patch
---

Wait for the page to paint before `screenshotClip` captures, in both the Puppeteer and Playwright adaptors. A capture taken straight after a style change could return a frame from before it, so a focus indicator that was applied but not yet painted was missing from the focused screenshot and reported as a failure.
