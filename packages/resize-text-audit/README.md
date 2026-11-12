# @a11y-pulse/resize-text-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/resize-text-audit)](https://www.npmjs.com/package/@a11y-pulse/resize-text-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit for [**WCAG 1.4.4 Resize Text**](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html). It lays the page out as it would be at 200% browser zoom, and reports text that the zoomed layout cuts off or lays over other text. It is framework-agnostic and can run in any environment that can evaluate JavaScript in a page and resize its viewport, such as Puppeteer, Playwright, or Selenium.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/resize-text-audit puppeteer
```

`puppeteer` is an optional peer dependency. It is only required if you use the bundled [Puppeteer adaptor](#adaptors). Other frameworks can supply their own adaptor without installing Puppeteer at all.

## Quickstart

```js
import { runResizeTextAudit } from "@a11y-pulse/resize-text-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/resize-text-audit/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch({ defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const result = await runResizeTextAudit(new PuppeteerAdaptor(page));

console.log(result.summary);
// { clipped: 0, overlaps: 0 }

console.log(result.findings);
// []

await browser.close();
```

See [`examples/puppeteer`](./examples/puppeteer) for a complete, runnable example.

## What it checks

WCAG 1.4.4 requires that text can be resized up to 200% without assistive technology and without loss of content or functionality. Browser zoom is how almost everyone does that, and zooming to 200% gives the page half as many CSS pixels in each direction to lay itself out in. A layout that pins a box to a fixed height, or gives each item a fixed share of the width, loses text when that happens.

Static tools cannot see this. axe-core's `meta-viewport` rule flags a viewport tag that disables zooming, but says nothing about what the page looks like once it is zoomed. This audit zooms and looks. Leave axe's rule enabled: the two are complementary, and this audit reports the same tag as [`viewportMeta`](#result-shape) so that both signals arrive together.

## How it works

1. Wait for `document.fonts.ready`, freeze CSS animations and transitions, collect visible text containers (elements with a non-whitespace direct text node, capped at `candidateLimit`) and measure each line of their text.
2. Halve the CSS viewport's width and height. This is the layout the page gets at 200% zoom: the same media queries match and the same `vw`/`vh` lengths resolve.
3. Wait for the layout to hold still for `minSettleMs`, so that a debounced `resize` handler has run. Then collect the text containers again, because the zoomed layout can render text the full-size one does not and can change what clips or truncates the rest, and measure them.
4. Classify:
   - **clipped**: the element's lines of text fitted inside every ancestor with overflow `hidden`/`clip` before, and one of them now cuts into the text while part of it is still showing. Everything cut off by the same element is one finding, reported against the worst affected text that is still partly visible. Text that only the zoomed layout renders has no earlier measurement to be compared with: when a box cuts into it, the finding is marked `noBaseline`.
   - **overlap**: lines of text in two nearby elements that shared no space before and now do, counting each line only as far as its clipping ancestors leave it showing. Sticky and fixed elements are skipped.
5. Look up the selector, markup, box and current styles of the elements behind each finding, drop the findings the zoomed layout explains (see below), and screenshot the rest while the page is still zoomed.
6. Restore the viewport, wait for the layout to settle, remove the injected styles and verify that a sample of elements are back where they were. A mismatch sets `restored: false` but never throws.

Text that reflows, wraps onto more lines or moves is not a finding. That is the correct response to zoom.

### What is deliberately not reported

- **Text that can be scrolled to.** Text inside an `overflow: auto`/`scroll` ancestor is still reachable. Whether a page should need sideways scrolling is [WCAG 1.4.10 Reflow](../reflow-audit), not this.
- **Intentional truncation.** Text cut off by an element that truncates it with `text-overflow: ellipsis` or a line clamp is never reported as `clipped`, whether it was truncated before the zoom or only after. Nor does the part an ellipsis hides count as overlapping what it lies under, whether the ellipsis is on the element or on a wrapper around it. A `text-overflow` with nothing to act on (no clipped overflow) changes nothing: that text is compared like any other.
- **Text that was already cut off**, including visually hidden (`.sr-only`) text. Zoom did not cause it.
- **Text the zoomed layout hides outright.** An off-canvas menu, or a panel collapsed to nothing, is a layout putting content away, not text being cut into. It only counts towards `affectedCount` when the same box also cuts into other text.
- **Elements the zoomed layout stops rendering** (`display: none`, `visibility: hidden`, `opacity: 0`), and boxes that no longer clip in the zoomed layout.

## Shared measurement

The measurement is not this package's own. Finding lines of text, working out which ancestors clip them and by how much, comparing lines for overlap, and describing the elements behind a finding are exactly what [`@a11y-pulse/text-spacing-audit`](../text-spacing-audit) does for WCAG 1.4.12; only the change applied to the page between the two measurements differs. This package therefore depends on that one and imports its page scripts from `@a11y-pulse/text-spacing-audit/measure`, so there is one tested copy of about a thousand lines of page-side geometry instead of two that drift apart. What lives here is small: the viewport resize and its settle wait, the rules above for what a zoomed layout explains, and the viewport meta tag.

## Browser support

| Adaptor | Browser | Supported |
| --- | --- | --- |
| Puppeteer | Chrome | Yes |
| Playwright | Chromium | Yes |
| Playwright | WebKit | Yes |
| Playwright | Firefox | Yes |

Verified by this repo's integration suites, which run every audit against each of these engines. Unsupported and partial cases are skipped there with the reason printed alongside them.

## Options

The following options can be passed to `runResizeTextAudit` as `ResizeTextOptions`:

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `candidateLimit` | `number` | `500` | Max visible text containers to measure, in document order. |
| `clipTolerancePx` | `number` | `2` | Overflow in px that must be exceeded before text counts as clipped. |
| `settleDelayMs` | `number` | `50` | Delay between layout readings while waiting for the page to settle after a resize. |
| `settleAttempts` | `number` | `20` | Max layout readings before measuring anyway and setting `unsettled`. |
| `minSettleMs` | `number` | `300` | How long the layout must hold still before it is measured. Long enough for a debounced `resize` handler. |
| `screenshotClipBuffer` | `number` | `10` | Padding in px around a finding when clipping its screenshot. |
| `screenshotLimit` | `number` | `10` | Max findings to screenshot. Findings past the limit are still reported, without a `screenshot`. |

## Result shape

`runResizeTextAudit` resolves to a `ResizeTextResult`:

```ts
type ResizeTextResult = {
  findings: Array<{
    selector: string;
    html: string;
    kind: "clipped" | "overlap";
    metrics: {
      beforeOverflowPx: number;
      afterOverflowPx: number;
      beforeOverlapAreaPx2?: number;
      afterOverlapAreaPx2?: number;
    };
    rect: { x: number; y: number; width: number; height: number };
    axis?: "horizontal" | "vertical" | "both";
    clippedBy?: string;
    clippedByHtml?: string;
    clippedByRect?: { x: number; y: number; width: number; height: number };
    affectedCount?: number;
    noBaseline?: true;
    overlapsWith?: string;
    overlapsWithHtml?: string;
    overlapRect?: { x: number; y: number; width: number; height: number };
    screenshot?: Uint8Array;
  }>;
  candidateCount: number;
  truncated: boolean;
  viewport: { width: number; height: number };
  originalViewport: { width: number; height: number };
  unsettled: boolean;
  restored: boolean;
  viewportMeta: {
    content: string;
    html: string;
    userScalable: boolean;
    maximumScale: number | null;
    blocksZoom: boolean;
  } | null;
  summary: { clipped: number; overlaps: number };
};
```

`candidateCount` is the number of stable (non-moving) text containers that were measured at full size. `truncated` is `true` when the page has more text containers than `candidateLimit`, at full size or at 200%, so some of it was not measured. `viewport` is the size the page was measured at and `originalViewport` the size it arrived with. `unsettled` is `true` when the layout was still changing when it was measured, in which case the findings deserve less trust. `restored` is `true` when the viewport was put back and the layout returned to what it was.

`viewportMeta` is the page's `<meta name="viewport">` (the last one, as browsers read it), or `null` when there is none. `blocksZoom` is `true` when it sets `user-scalable` to `no`/`0` or a `maximum-scale` below 2, which stops many mobile browsers zooming to 200% at all. It is reported as corroborating evidence and does not create a finding on its own.

A vertical `clipped` finding is the confident loss-of-content signal: a box of fixed height cutting through text. Horizontal-only `clipped` findings and `overlap` findings are more often a matter of judgement (a carousel showing part of its next slide, labels that touch) and are best treated as needing review. So is any finding marked `noBaseline`: the text is cut into at 200%, but it was not shown at full size, so the audit cannot say that zooming is what cut it.

Each finding carries the evidence needed to locate it:

| Field | Kinds | Description |
| --- | --- | --- |
| `metrics.beforeOverflowPx` / `afterOverflowPx` | `clipped` | How far the text extends past its clipping box, before and at 200%. |
| `metrics.beforeOverlapAreaPx2` / `afterOverlapAreaPx2` | `overlap` | Area the two elements' text shares, before and at 200%. |
| `rect` | all | The element's box at 200%. |
| `axis` | `clipped` | The direction in which text is cut off. |
| `clippedBy` / `clippedByHtml` / `clippedByRect` | `clipped` | The element doing the clipping. It is the finding's own element when that clips its own text. |
| `affectedCount` | `clipped` | How many text containers that element cuts into or hides. They are reported once. |
| `noBaseline` | `clipped` | `true` when none of that text was rendered at full size (a header only the narrow layout shows), so there was nothing to compare with. |
| `overlapsWith` / `overlapsWithHtml` | `overlap` | The other element. |
| `overlapRect` | `overlap` | The largest region the two elements' text shares. |
| `screenshot` | all | PNG of the finding at 200%: a clipped element where it is cut off, or both overlapping elements. Omitted past `screenshotLimit`. |

Every rect is in document coordinates at 200%: CSS px from the top left of the page, not of the viewport.

## Adaptors

The audit itself is framework-agnostic: it drives a page through an **adaptor**, a small interface of primitives that the audit calls without knowing which browser automation library is behind it.

The package ships two implementations: `PuppeteerAdaptor` from the `./puppeteer` subpath, backed by a Puppeteer `Page`, and `PlaywrightAdaptor` from `./playwright`, backed by a Playwright `Page`. Other environments (Selenium, WebDriver) can be supported by implementing the same interface, exported as `ResizeTextAuditAdaptor` (aliased as `BrowserAdaptor` from the package root).

### `ResizeTextAuditAdaptor` / `BrowserAdaptor`

| Method | Description |
| --- | --- |
| `evaluate(fn, ...args)` | Runs `fn` in the page context, passing in any serialisable `args`, and returns its result. `fn` may be async. |
| `getViewport()` | Returns the page's current CSS viewport size as `{ width, height }`. When no viewport is being emulated (Puppeteer's `defaultViewport: null`, Playwright's `viewport: null`), that is the size of the window: `innerWidth` by `innerHeight`. |
| `setViewport({ width, height })` | Sets the page's CSS viewport size. The audit calls it twice: once with half the size `getViewport()` returned, and once with that size to put the page back. |
| `screenshotClip(clip, scale?)` | Returns PNG bytes of the region `clip` (`{ x, y, width, height }` in document coordinates, which may lie outside the viewport). `scale` is the device scale factor. |
| `screenshotClipScale` | Optional property: the device scale factor the audit passes to `screenshotClip`. Defaults to `1`. |

### Writing a new adaptor

Implement `ResizeTextAuditAdaptor` from `@a11y-pulse/resize-text-audit` (or its `BrowserAdaptor` alias) against your automation library's page/session object, then pass an instance to `runResizeTextAudit`:

```ts
import type { ResizeTextAuditAdaptor } from "@a11y-pulse/resize-text-audit";

class MyFrameworkAdaptor implements ResizeTextAuditAdaptor {
  // ...implement evaluate, getViewport, setViewport and screenshotClip for your framework
}
```

Use [`src/adaptors/puppeteer.ts`](./src/adaptors/puppeteer.ts) or [`src/adaptors/playwright.ts`](./src/adaptors/playwright.ts) as a reference implementation.

On a page with no emulated viewport, the Puppeteer adaptor stops emulating one when the audit puts the viewport back, so the page fills its window again. Playwright has no way to stop: the page is returned to the size it had, and keeps that size if its window is resized later.

## Limitations

- **Zoom is emulated by resizing the viewport.** That reproduces the layout of browser zoom on a desktop browser. It does not reproduce text-only zoom, an operating system font size setting, or pinch zoom on a touch device, which magnifies without re-laying out.
- **Start from a desktop-sized viewport.** The audit halves whatever viewport the page arrives with. Run it at 1280 CSS px wide or more, which is what the success criterion is usually tested at; halving a phone-sized viewport tests something narrower than any real zoom level.
- **Newly truncated text is not reported.** A title that fits at 100% and gains an ellipsis at 200% has lost content, but an ellipsis is also the most common deliberate response to a narrow layout, and the audit cannot tell the two apart. It errs towards silence.
- **Hidden-outright content is not reported.** A fixed-height box that happens to cut between two blocks, hiding the second without cutting into either, is missed.
- **Text only the zoomed layout renders has nothing to be compared with.** It is measured, and reported with `noBaseline` when a box cuts into it while part of it still shows. It is not checked for overlap, since there is no telling a new overlap from a designed one, and it does not count towards `candidateCount`.
- **Overlap is heuristic.** Nearby pairs only, with sticky and fixed elements skipped. A sticky header that covers most of a zoomed viewport is not detected.
- **Already-clipped content is not attributed to zoom.** Only text that fitted inside its clipping boxes before is reported.
- **Loss of functionality** without a geometric symptom (a control pushed off-screen with no way to scroll to it, a menu that stops opening) is not detected.
- **Transforms.** A clipping box under a scaling transform is measured at the size it is drawn. Rotation and skew are not accounted for, so text inside a rotated clipping ancestor can be misjudged.
- **Motion.** CSS animations are frozen before the first measurement. Elements whose rects move between two samples (JS-driven motion) are excluded.
- **Main frame only.** Text in canvas, images, or iframes is invisible to the audit. Closed shadow roots are opaque; open shadow roots are walked.

## Known false positives

- **Narrow-layout content that is cut off by design.** A `noBaseline` finding says that text the page only shows in its narrow layout is cut into. If that layout always cuts it (a one-line notice bar showing the start of a longer message), zooming is not the cause. These findings are for review.
- **Peeking carousels.** A slide that is fully in view at 100% and partly in view at 200% is reported as horizontally `clipped`. Treat horizontal-only findings as needing review.
- **Hover and focus content.** A tooltip or dropdown that is positioned over other text but hidden with a technique the visibility check does not see (for example clipped to zero size) can be reported as an `overlap`.

## License

Released under the [PolyForm Shield License 1.0.0](./LICENSE.md), in plain language:

- **Source-available.** The source is public and you can read, fork, and modify it.
- **Permitted for non-competing use.** You can use this package freely in your own products and services, as long as they don't compete with A11y Pulse.
- **Competing products are forbidden.** You may not use this software (or a modified version of it) to build a product or service that competes with A11y Pulse's accessibility monitoring offering.

See [LICENSE.md](./LICENSE.md) for the full, binding terms.
