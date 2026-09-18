---
"@a11y-pulse/browser-adaptor": minor
---

Capture clipped screenshots with `captureBeyondViewport` off, in both the Puppeteer and Playwright adaptors. To honour `captureBeyondViewport` Chromium shrinks the emulated viewport to 1x1 and resizes it for the clip before restoring it, and the page observes each of those as a real resize: `resize` fires and media queries flip to their narrowest breakpoint. On a busy renderer the page can run a whole frame at that size, so a responsive navigation collapses, the focused item is hidden and blurs, and the "focused" screenshot shows no indicator. The focus appearance audit then reported those elements as failing, more often the more load the machine was under.

The Puppeteer adaptor now sends `Page.captureScreenshot` over its own CDP session rather than through `page.screenshot()`, which with `captureBeyondViewport` off would intersect the clip with the viewport and silently move the origin that callers align element rects against. **Breaking for callers of `screenshotClip`:** a clip is now only guaranteed to capture what lies inside the viewport, and what falls outside it comes back blank. `BrowserAdaptor.screenshotClip` documents that the caller scrolls the element into view first, and every audit in this repo does.

Both adaptors take a `captureBeyondViewport` option to opt back in, for evidence of regions that cannot be scrolled to where the page's state does not matter. The reflow and text spacing adaptors set it, so their evidence is unchanged.
