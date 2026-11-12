# @a11y-pulse/reflow-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/reflow-audit)](https://www.npmjs.com/package/@a11y-pulse/reflow-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit that aims to verify [**WCAG 1.4.10 Reflow**](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html). It sets the viewport to 320 CSS pixels wide (the criterion's 1280px-at-400% zoom equivalent), lets layout settle, and measures whether the page requires two-dimensional scrolling. Data tables and other content that needs two-dimensional layout are exempt. It is built to be framework-agnostic and can be used in any environment that can resize a page viewport and evaluate JavaScript, such as Puppeteer, Playwright, or Selenium.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/reflow-audit puppeteer
```

`puppeteer` is an optional peer dependency. It is only required if you use the bundled [Puppeteer adaptor](#adaptors). Other frameworks can supply their own adaptor without installing Puppeteer at all.

## Quickstart

```js
import { runReflowAudit } from "@a11y-pulse/reflow-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/reflow-audit/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const result = await runReflowAudit(new PuppeteerAdaptor(page));

console.log(result.bucket);
// "pass" | "violation" | "incomplete"

console.log(result.offenders);
// [
//   {
//     selector: "#app",
//     html: '<div id="app">',
//     overflowPx: 680,
//     reason: "element-overflow",
//     rect: { x: 0, y: 0, width: 1000, height: 480 },
//     screenshot: Uint8Array(…)
//   }
// ]

await browser.close();
```

## Browser support

| Adaptor | Browser | Supported |
| --- | --- | --- |
| Puppeteer | Chrome | Yes |
| Playwright | Chromium | Yes |
| Playwright | WebKit | Yes |
| Playwright | Firefox | Yes |

Verified by this repo's integration suites, which run every audit against each of these engines. Unsupported and partial cases are skipped there with the reason printed alongside them.

## Options

The following options can be passed to `runReflowAudit` as `ReflowOptions`:

| Option                 | Type     | Default | Description                                                                                                                                         |
| ---------------------- | -------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `settleDelayMs`        | `number` | `50`    | Delay between layout-fingerprint readings while waiting for media queries, resize handlers and lazy content to apply.                               |
| `settleAttempts`       | `number` | `20`    | Max fingerprint readings while the layout is still changing before measuring anyway and marking the result `unsettled`.                             |
| `minSettleMs`          | `number` | `300`   | How long the layout must hold still before it is measured, so that a debounced `resize` handler has run. Not applied to an already-narrow page.     |
| `screenshotClipBuffer` | `number` | `10`    | Vertical padding, in CSS pixels, above and below an offender in its screenshot.                                                                     |
| `screenshotLimit`      | `number` | `10`    | Max offenders to screenshot. Each is a real screenshot call; offenders past the limit are still reported, without a `screenshot`.                   |

## Result shape

`runReflowAudit` resolves to a `ReflowResult`:

```ts
type ReflowResult = {
  viewport: { width: number; height: number };
  restored: boolean;
  unsettled: boolean;
  alreadyNarrow: boolean;
  documentOverflowPx: number;
  bucket: "pass" | "violation" | "incomplete";
  offenders: Array<{
    selector: string;
    html: string;
    overflowPx: number;
    reason:
      | "element-overflow"
      | "text-overflow"
      | "fixed-width-container"
      | "media-overflow"
      | "clipped-content"
      | "scrolling-container";
    rect: { x: number; y: number; width: number; height: number };
    // `scrolling-container` only: what inside the scroller is too wide for it.
    overflowing?: Array<{
      selector: string;
      html: string;
      overflowPx: number;
      rect: { x: number; y: number; width: number; height: number };
    }>;
    screenshot?: Uint8Array;
  }>;
};
```

Each offender carries a `reason`:

| Reason | Meaning | Can cause |
| --- | --- | --- |
| `element-overflow` | The element's box extends past the viewport and adds horizontal scroll to the page. | `violation` |
| `text-overflow` | Text spills out of an element that itself fits (a `nowrap` heading, a long URL, a wide `<pre>`) and adds horizontal scroll. `rect` is the text's box. | `violation` |
| `fixed-width-container` | A layout container has a px `width` / `min-width` wider than the viewport. A hint to where unattributed overflow comes from. | `incomplete` |
| `media-overflow` | An `img`, `video` or `iframe` is wider than the viewport. It is exempt only if it needs two-dimensional layout, which a person has to judge. | `incomplete` |
| `clipped-content` | Content extends past the viewport where it cannot be scrolled to: the page clips it with `overflow-x: hidden` on `html` or `body`, or it is inside a `position: fixed` box that does not scroll it. It may be cut off. | `incomplete` |
| `scrolling-container` | A container that scrolls horizontally holds most of the page's text, so reading the page means scrolling in two directions. `overflowing` names what inside it is too wide. | `incomplete` |

`rect` is the offender's box in CSS pixels relative to the document (not the scroll position) at the measurement viewport. On a right-to-left page, which overflows to the left, `x` is negative for content past that edge.

`overflowing` is set on `scrolling-container` offenders only. It lists the outermost content inside the scroller that is wider than it (the first five), each with how far it reaches past the scroller's edge, so that the element that fails to reflow is named and not just the container around it.

`screenshot` is a PNG of the offender's row of the page: the clip starts at the left edge and is one viewport wide, so an offender that runs past the edge is visibly cut off there. It is widened (up to 1280px in all) only for an offender that lies wholly beyond the viewport: rightwards, or leftwards on a right-to-left page. Capturing leftwards scrolls the window sideways for the capture and puts it back; it is verified on Chromium, and an engine that refuses such a clip gets the ordinary viewport-wide one.

Bucket rules:

- **pass**: no meaningful horizontal overflow at 320px and nothing out of reach, or overflow that is fully explained by exempt 2D content such as a data table.
- **violation**: confirmed document overflow (above the 20px scrollbar-gutter band) with a non-exempt element or run of text that overflows.
- **incomplete**: overflow in the 2-20px gutter band, an unsettled layout, overflow that cannot be attributed to a node, or only offenders that need a person's judgement (`fixed-width-container`, `media-overflow`, `clipped-content`, `scrolling-container`).

The incoming viewport is restored even if measurement throws. Pages already 320px wide or narrower are measured in place with no resize.

## How it works

1. Read the current viewport. If it is already 320px wide or narrower, skip the resize. Otherwise stash it and set `{ width: 320, height: max(current.height, 1024) }`.
2. Settle: reread a layout fingerprint (`scrollWidth`, `clientWidth`, child count) with a short delay until it has held still for `minSettleMs`, or until the attempt cap while it is still changing. Hitting the cap marks the result `unsettled`.
3. Measure in one in-page evaluation, in document coordinates so the scroll position does not matter:
   - Document overflow is `documentElement`'s `scrollWidth - clientWidth` unless the viewport clips it (`overflow-x: hidden | clip` on `html`, or on `body` when `html` is left `visible`), or `body`'s when `html` has an `overflow-x` of its own and `body` is itself a scroller (`auto | scroll`). Up to 2px is treated as none (sub-pixel rounding). 2-20px is a low-confidence scrollbar-gutter signal.
   - Overflowing elements are visible nodes (open shadow roots included) whose box extends past the viewport edge the page scrolls towards (the left edge on a right-to-left page), excluding `aria-hidden="true"`, zero-area nodes and off-canvas nodes. Only the outermost offender in a chain is reported, except that an inline wrapper which is only as wide as the media inside it (`<picture>`, a link around an image) is passed over so that the media is the offender.
   - Overflowing text is found in elements whose content is wider than their box, by measuring their own text nodes.
   - Content inside a viewport-fitting ancestor that clips (`overflow-x: hidden | clip`) or scrolls (`auto | scroll`) its overflow does not widen the page and is not reported, taking into account that such an ancestor does not contain an absolutely positioned box unless it is that box's containing block. This holds for a `position: fixed` ancestor too: a fixed tab bar or dialog that scrolls sideways within itself keeps its content in reach. A scroller holding most of the page's text is reported as `scrolling-container`, with the content that is too wide for it.
   - Content that overflows where nothing scrolls (the page clips it, or it is in a `position: fixed` box that does not scroll or clip it) is reported as `clipped-content` unless it sits wholly beyond the edge, as an off-canvas menu does.
   - Fixed-width containers (`width` / `min-width` in px larger than the viewport) are a heuristic, never a violation on their own.
4. Exemptions: do not record overflow for a node that is, or descends from, a data `<table>`, `[role=table|grid|treegrid]`, `svg`, `canvas`, `embed`, `object`, `[role=toolbar]`, or a slide/presentation container. A `<table>` counts as a data table when it has a `<th>`, `<caption>`, `<thead>`, `scope` or `headers` of its own, or a table/grid role, and is not `role="presentation"` / `"none"`; any other table is laying out content and stays eligible. `img`, `video` and `iframe` are reported as `media-overflow` for review. Document overflow explained only by exempt content is not flagged.
5. Capture a screenshot of each offender (up to `screenshotLimit`) while still at the narrow viewport.
6. Restore the original viewport in `finally`.

## Adaptors

The audit itself is framework-agnostic: it drives a page through an **adaptor**, a small interface of primitives (evaluate JS in the page, get and set the viewport, screenshot a region) that the audit calls without knowing which browser automation library is behind it.

The package ships two implementations: `PuppeteerAdaptor` from the `./puppeteer` subpath, backed by a Puppeteer `Page`, and `PlaywrightAdaptor` from `./playwright`, backed by a Playwright `Page`. Other environments (Selenium, WebDriver) can be supported by implementing the same interface, exported as `ReflowAuditAdaptor` (aliased as `BrowserAdaptor` from the package root).

### `ReflowAuditAdaptor` / `BrowserAdaptor`

| Method                  | Description                                                                 |
| ----------------------- | --------------------------------------------------------------------------- |
| `evaluate(fn, ...args)` | Runs `fn` in the page context, passing in any serialisable `args`.          |
| `getViewport()`         | Returns the page's current CSS viewport `{ width, height }`.                |
| `setViewport(v)`        | Sets the page's CSS viewport to `{ width, height }`.                        |
| `screenshotClip(clip, scale?)` | Returns PNG bytes of the region `clip` (`{ x, y, width, height }` in CSS pixels relative to the document, which may lie outside the current viewport). Required: it is called once per offender, up to `screenshotLimit`. |
| `screenshotClipScale`   | Optional. Device scale factor passed to `screenshotClip`. Defaults to `1`.  |

### Writing a new adaptor

Implement `ReflowAuditAdaptor` from `@a11y-pulse/reflow-audit` (or its `BrowserAdaptor` alias) against your automation library's page/session object, then pass an instance to `runReflowAudit`:

```ts
import type { ReflowAuditAdaptor } from "@a11y-pulse/reflow-audit";

class MyFrameworkAdaptor implements ReflowAuditAdaptor {
  // ...implement evaluate, getViewport, setViewport, and screenshotClip for your framework
}
```

Use [`src/adaptors/puppeteer.ts`](./src/adaptors/puppeteer.ts) or [`src/adaptors/playwright.ts`](./src/adaptors/playwright.ts) as a reference implementation.

### Pages with no emulated viewport

A browser launched so that pages fill their window (Puppeteer's `defaultViewport: null`, a Playwright context with `viewport: null`) has no viewport for the library to report. Both bundled adaptors then read the window's real size from the page, so the audit narrows from, and restores to, the size the page actually had. The Puppeteer adaptor clears its emulation when restoring, leaving the page filling its window again. Playwright cannot hand a viewport back to the window, so its adaptor leaves the page emulated at the size it started with.

## Limitations

- **Clipped loss.** Content cut off by `overflow-x: hidden` on the page itself (`html`, `body` or both) is reported for review as `clipped-content`. Content cut off inside a smaller `overflow: hidden` container (a slider, a card, a fixed header that clips its own overflow) is not reported, because sliders hide content that way by design; where such a container loses real content at 320px, that is a false negative.
- **Application shells that scroll.** Where the whole page sits in one element that scrolls (a single-page app's `#root` with `overflow-y: auto`, which makes it scroll sideways as well), content that fails to reflow scrolls that element and not the document. It is reported for review as `scrolling-container` with the too-wide content listed in `overflowing`, never as a `violation`, because the audit cannot tell such a shell from a page that is one wide widget.
- **Closed shadow roots** can still contribute to document overflow but cannot be attributed to a node, so unattributed overflow lands in `incomplete`.
- **Iframes are not inspected.** The audit measures the top document only. An `<iframe>` wider than the viewport is reported as `media-overflow`; content that fails to reflow inside a frame, same-origin or not, is not detected.
- **Height reflow.** v1 measures the 320px-wide case for vertical-scrolling content. The criterion's 256px-tall case for horizontal-scrolling content is out of scope.
- **Requires-2D judgment.** Whether a given wide widget, image or embed truly needs two-dimensional layout is left to human review beyond the published exemptions.
- **Slow layout switches.** A page that changes layout more than `minSettleMs` (300ms) after the resize, for example behind a longer debounce, is measured in its wide layout. Raise `minSettleMs` for such pages.

## Known false positives

Cases where the audit reports a problem that is not one. Each says which bucket it lands in: `incomplete` asks for a human to check, `violations` claims a failure.

- **Two-dimensional content built from ordinary elements** (`violations`). Data tables, the ARIA `table`, `grid`, `treegrid` and `toolbar` roles, an `aria-roledescription` of `slide`, `slides` or `presentation`, and `svg`, `canvas`, `embed` and `object` are exempt. A spreadsheet-style grid or a map built from `div`s without any of those is reported even where it genuinely needs two-dimensional layout.
- **Data tables with no header markup** (`violations`). A wide `<table>` of data that has no `<th>`, `<caption>`, `<thead>`, `scope`, `headers` or table role is taken for a layout table.
- **Images and embeds that need their width** (`incomplete`). A map, diagram or video wider than the viewport is reported as `media-overflow` although the criterion exempts it.
- **Decoration that is cut off on purpose** (`incomplete`). A decorative element that deliberately runs off the edge of a page with `overflow-x: hidden`, or of a fixed header, is reported as `clipped-content`.
- **Pages that are one wide widget** (`incomplete`). A kanban board or timeline that holds most of the page's text in a horizontal scroller is reported as `scrolling-container`.
- **Overflow the width of a scrollbar** (`incomplete`). An excess of 2 to 20px, typically `100vw` beside a vertical scrollbar, is reported for review rather than ignored or flagged.

## Releasing

Releases are managed in the [A11y-Pulse/audits](https://github.com/A11y-Pulse/audits) monorepo with [Changesets](https://github.com/changesets/changesets). Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC). There is no long-lived `NPM_TOKEN`.

### Ship a change

1. Open a PR against `main` that includes a changeset (`npx changeset`) naming `@a11y-pulse/reflow-audit`.
2. After merge, the Release workflow opens a Version PR. Merging that PR publishes this package to npm and tags `@a11y-pulse/reflow-audit@<version>`.

Trusted Publisher on npm must stay configured for:

| Field | Value |
| --- | --- |
| Organization or user | `A11y-Pulse` |
| Repository | `audits` |
| Workflow filename | `release.yml` |

### Consumers (e.g. the A11y Pulse runner)

Bumping the published version in downstream apps is a separate change. Update the dependency range / lockfile there after the npm release lands.

## License

Released under the [PolyForm Shield License 1.0.0](./LICENSE.md), in plain language:

- **Source-available.** The source is public and you can read, fork, and modify it.
- **Permitted for non-competing use.** You can use this package freely in your own products and services, as long as they don't compete with A11y Pulse.
- **Competing products are forbidden.** You may not use this software (or a modified version of it) to build a product or service that competes with A11y Pulse's accessibility monitoring offering.

See [LICENSE.md](./LICENSE.md) for the full, binding terms.
