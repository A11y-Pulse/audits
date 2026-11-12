# @a11y-pulse/focus-not-obscured-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/focus-not-obscured-audit)](https://www.npmjs.com/package/@a11y-pulse/focus-not-obscured-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit that aims to verify compliance with [**WCAG 2.2: 2.4.11 Focus Not Obscured (Minimum)**](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum). It tabs through a page's focusable elements and detects whether each one is entirely hidden behind other content (a sticky footer, a cookie banner, a modal overlay, etc.) while focused, then scrolls a sample of them to the top of the viewport to find the ones a sticky header hides. It is built to be framework-agnostic and can be used in any environment that allows you to programmatically focus elements and hit-test the page, such as Puppeteer, Playwright, or Selenium.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/focus-not-obscured-audit @a11y-pulse/tab-orchestrator @a11y-pulse/browser-adaptor puppeteer
```

`@a11y-pulse/tab-orchestrator` drives the page (tabbing, markers, obscuring measurement), and [`@a11y-pulse/browser-adaptor`](../browser-adaptor) ships the bundled [Puppeteer and Playwright adaptors](#adaptors); `puppeteer` and `playwright-core` are optional peers of that package, each only required if you use the matching adaptor. Other frameworks can supply their own adaptor without installing either.

## Quickstart

```js
import { runFocusNotObscuredAudit } from "@a11y-pulse/focus-not-obscured-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const result = await runFocusNotObscuredAudit(new PuppeteerAdaptor(page), {
  elementLimit: 20,
});

console.log(result.summary);
// { checked: 2, passed: 1, failed: 1, reachedLimit: false, reachedFailedElementLimit: false, timedOut: false }

console.log(result.elements);
// [
//   {
//     selector: 'html>body>a#under-footer',
//     html: '<a id="under-footer" href="#under">',
//     tabIndex: 1,
//     bucket: 'violation',
//     measurement: {
//       coveredFraction: 1,
//       fullyObscured: true,
//       offscreen: false,
//       opacity: 'opaque',
//       obscuredBy: {
//         selector: '#sticky-footer',
//         html: '<div id="sticky-footer">',
//         rect: { x: 0, y: 688, width: 1024, height: 80 },
//         position: 'fixed'
//       },
//       rect: { x: 0, y: 734, width: 1024, height: 34 }
//     },
//     screenshot: Uint8Array(...)
//   },
// ]

await browser.close();
```

See [`@a11y-pulse/focus-appearance-audit`'s `examples/puppeteer`](../focus-appearance-audit/examples/puppeteer) for a runnable example of the same shared-adaptor pattern.

## Shared tab session

`runFocusNotObscuredAudit` is a convenience wrapper: it builds a private `@a11y-pulse/tab-orchestrator` session, attaches one consumer, runs it, and hands back that consumer's result. If you're running more than one tab-driven audit against the same page (for example alongside [`@a11y-pulse/focus-appearance-audit`](../focus-appearance-audit)), drive a single shared orchestrator instead so the page is only tabbed through once. Use `createFocusNotObscuredAudit` to get a `TabConsumer` you can `attach()` yourself:

```ts
import { createTabOrchestrator } from "@a11y-pulse/tab-orchestrator";
import { createFocusNotObscuredAudit } from "@a11y-pulse/focus-not-obscured-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";

const adaptor = new PuppeteerAdaptor(page);
const orchestrator = createTabOrchestrator(adaptor);

const notObscured = createFocusNotObscuredAudit({ elementLimit: 50 });
orchestrator.attach(notObscured);

await orchestrator.run();
// Once the session has ended: look for elements a sticky header hides.
await notObscured.checkScrolledToTop(adaptor);

console.log(notObscured.result);
```

`checkScrolledToTop` is the [scrolled-to-top check](#the-scrolled-to-top-check). `runFocusNotObscuredAudit` calls it for you; with a shared orchestrator you call it yourself, with the same adaptor, after `run()` resolves.

`notObscured.result` is only complete once `notObscured` has disconnected (by hitting one of its own limits) or the session has ended. Reading it before then is undefined. See [`@a11y-pulse/tab-orchestrator`](../tab-orchestrator) for the full session lifecycle and capability model. This audit declares only the `"obscuring"` capability: it does not need `unfocusedPair` or `baselineStyles`, so it can run alongside `focus-appearance-audit` on the same orchestrator without either one paying for the other's measurements.

## Browser support

| Adaptor | Browser | Supported |
| --- | --- | --- |
| Puppeteer | Chrome | Yes |
| Playwright | Chromium | Yes |
| Playwright | WebKit | **No.** WebKit does not move focus to links when Tab is pressed, so the audit only reaches a subset of the page. |
| Playwright | Firefox | **Partial.** Elements behind a sticky footer were not reported as obscured, where Chromium reports a violation. The cause has not been diagnosed, so the tests that depend on where the browser leaves a newly focused element are skipped on Firefox. The scrolled-to-top check does run there. |

Verified by this repo's integration suites, which run every audit against each of these engines. Unsupported and partial cases are skipped there with the reason printed alongside them.

## Options

The following options can be passed to `runFocusNotObscuredAudit` as `FocusNotObscuredOptions`:

| Option                  | Type     | Default         | Description                                                                                                                                         |
| ------------------------ | -------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `elementLimit`            | `number` | `1024`           | Max focusable elements to tab through.                                                                                                              |
| `screenshotSettleDelay`   | `number` | `33`             | How long to wait (in ms) after each Tab for the page to settle before measuring.                                                                    |
| `failedElementLimit`      | `number` | `0` (never)      | Finish the audit early once this many elements have failed, leaving the rest unchecked. Useful as a fail-fast signal when you only need to know a page has focus problems, not their full extent. |
| `timeout`                 | `number` | `0` (no timeout) | Limit how long (in ms) the audit runs before returning the results it has gathered so far.                                                          |
| `screenshotLimit`         | `number` | `10`             | Max `violation` and `incomplete` elements to screenshot. Each is a real capture; elements past the limit are still reported, without a `screenshot`. |
| `scrolledToTopLimit`      | `number` | `10`             | Max elements the [scrolled-to-top check](#the-scrolled-to-top-check) re-measures, spread evenly over the elements that passed. `0` turns the check off. |

## Result shape

`runFocusNotObscuredAudit` resolves to a `FocusNotObscuredResult`:

```ts
type FocusNotObscuredResult = {
  /** Every focusable element that was checked, in tab order. */
  elements: Array<{
    selector: string;
    html: string;
    tabIndex: number;
    /** The AA bucket for this element (see below). */
    bucket: "violation" | "incomplete" | "pass";
    /** The raw obscuring measurement behind `bucket`. Rects are relative to the viewport. */
    measurement: {
      coveredFraction: number;
      fullyObscured: boolean;
      offscreen: boolean;
      /** How the cover as a whole paints over the element (see "How a cover is judged"). */
      opacity: "opaque" | "semi-transparent" | "unknown";
      /** The cover: the banner, header or overlay the covering content belongs to. */
      obscuredBy: {
        selector: string;
        html: string;
        rect?: { x: number; y: number; width: number; height: number };
        /** Computed `position` of the cover, such as "fixed" or "sticky". */
        position?: string;
        /** Set when the cover has `pointer-events: none`. */
        ignoresPointerEvents?: boolean;
      } | null;
      /** The box that was measured, clipped to the viewport. */
      rect?: { x: number; y: number; width: number; height: number };
      /** "label" when the input is not painted and its label was measured instead. */
      measured?: "label";
      /** The element is not painted and has no label, so there was nothing to measure. */
      notPainted?: boolean;
    };
    /** "scrolled-to-top" when only the scrolled-to-top check found the element hidden. */
    foundBy?: "scrolled-to-top";
    /**
     * PNG of a strip the width of the viewport around the element, with the element's box drawn
     * as a dashed outline so it can be located behind its cover. Only for `violation` and
     * `incomplete` elements, up to `screenshotLimit`.
     */
    screenshot?: Uint8Array;
  }>;
  summary: {
    checked: number;
    passed: number;
    /** Count of elements whose `bucket` is `"violation"`. */
    failed: number;
    /** True if `elementLimit` was hit before tabbing finished. */
    reachedLimit: boolean;
    /** True if the audit stopped early after hitting `failedElementLimit`. */
    reachedFailedElementLimit: boolean;
    /** True if the audit returned early because `timeout` elapsed. */
    timedOut: boolean;
    /** Elements the scrolled-to-top check re-measured. */
    scrolledToTopChecked: number;
  };
};
```

### Failure evidence

Every `violation` and `incomplete` element carries what is needed to find and fix it:

- `measurement.obscuredBy` names the cover (selector, opening tag, box and `position`), and `measurement.rect` is the box of the focused element it covers.
- `screenshot` shows the strip of the viewport the element sits in. A clip of the element alone would be a rectangle of the cover's colour, so the element's box is drawn over the capture as a dashed outline instead. The outline is added to the page only for the capture and removed straight after.
- `foundBy: "scrolled-to-top"` says the element was fine where tabbing left it and is hidden when focus reaches it from below.

### Buckets

[2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum) is a Level AA criterion: when an element receives keyboard focus, it must not be **entirely** hidden by author-created content (partial coverage is allowed at this level; full protection from any coverage is [2.4.12 Focus Not Obscured (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-enhanced), a Level AAA criterion this audit does not check). Each element is placed in one of three buckets:

- **`violation`**: the element is entirely hidden behind opaque content while focused. Fails 2.4.11.
- **`incomplete`**: the audit could not confirm compliance either way: the element was fully offscreen when focused, or it's entirely covered by something the audit cannot call opaque (a gradient that fades to transparent, an SVG, a frame, a canvas or image it cannot establish to be solid, or several separate covers that no single box accounts for).
- **`pass`**: the element is not obscured at all, only partially obscured, or entirely covered by a semi-transparent overlay (still visible through the cover, so not "entirely hidden"). An element that is not painted at all, with no label, also passes: there is nothing for a cover to hide.

`summary.failed` counts only `"violation"` elements; `"incomplete"` elements count toward `summary.passed` since they are not confirmed failures.

## How a cover is judged

The focused element's box is sampled at 9 to 13 points. At each, everything stacked above the element is looked at from the top down, and each thing is traced up to the **cover** it belongs to: the outermost fixed, sticky or absolutely positioned element that does not also contain the focused element. That is the element reported as `obscuredBy`, so a cookie banner is named rather than the paragraph inside it, and a toolbar rather than one of its buttons.

The cover is then judged as a whole. At a sampled point it is opaque when anything between the content that was hit and the cover paints there: an opaque background colour, a background image or gradient, or replaced content that is known to be solid. `opacity` below 1 anywhere on the cover makes it see-through. A violation needs every point to be opaque and the cover's box to contain the element's.

- **Layers that paint nothing are looked through.** A layer with no background where the element is (an empty toast container or portal root stretched over the viewport, a fully transparent image) is not a cover, and whatever lies beneath it is judged instead. Of the things stacked above the element at a point, the one that hides the most decides: something opaque, else something that cannot be seen into, else something see-through.
- **Replaced content is only opaque when that can be established.** An `img` counts as solid when it has loaded, fills its box and is a JPEG or reads back with no transparent pixels; one that reads back fully transparent paints nothing. A `canvas` counts as solid when it reads back with no transparent pixels, and a `video` when it is showing a frame or a poster. A frame (`iframe`, `object`, `embed`), an image that cannot be read (another origin's, or one still loading), a partly transparent image and a canvas that reads back empty cannot be seen into, so an element entirely beneath one is `incomplete`. Any of them with an opaque background colour of its own is opaque.

- **Click-through covers.** Content with `pointer-events: none` is invisible to hit-testing. Positioned elements that take no pointer events, overlap the focused element and paint or hold something have pointer events switched on for the instant of the measurement, and are put back exactly as they were. A click-through `canvas`, frame or image that is not known to be solid is left alone: over a page it is all but always an empty effects layer.
- **Custom controls.** When the focused element is not painted (the transparent or clipped `input` of a custom checkbox or switch), its label is measured in its place, and the label's own content never counts as a cover.
- **Smooth scrolling.** An element that is off screen, or covered, when first measured is measured again once it has stopped moving, so `scroll-behavior: smooth` does not leave elements reported mid-scroll.

### The scrolled-to-top check

Tabbing forwards leaves each element in the middle or at the bottom of the viewport, so the tab pass finds sticky footers and banners but almost never a sticky header. A header hides an element when focus reaches it from below (Shift+Tab), which scrolls it to the top edge.

After the tab pass, on a page that has fixed or sticky content near the top, the audit takes up to `scrolledToTopLimit` of the elements that passed, scrolls each to the top edge the way the browser does (honouring `scroll-padding-top` and `scroll-margin-top`), measures it again and restores every scroll position. An element hidden there becomes a `violation` with `foundBy: "scrolled-to-top"`. Nothing is focused during this check. Elements that sit on fixed or sticky content themselves are skipped.

## Adaptors

The audit itself is framework-agnostic: it drives a page through an **adaptor**, a small interface of primitives (evaluate JS in the page, press Tab, hit-test the focused element, etc.) that the audit calls without knowing which browser automation library is behind it.

The `BrowserAdaptor` interface lives in [`@a11y-pulse/browser-adaptor`](../browser-adaptor), which also ships the bundled `PuppeteerAdaptor` and `PlaywrightAdaptor`. This package re-exports the type so `runFocusNotObscuredAudit`'s argument type is available without a separate import. Other environments (Selenium, WebDriver) can be supported by implementing the same interface.

Use [`@a11y-pulse/browser-adaptor`'s `src/adaptors/puppeteer.ts`](../browser-adaptor/src/adaptors/puppeteer.ts) as a reference implementation.

## Limitations

- **Tab order only.** The audit tabs through elements in native tab order. It does not yet exercise arrow-key composite widgets (menus, comboboxes, toolbars, etc.) where focus moves via `aria-activedescendant` or roving `tabindex` instead of native Tab.
- **Minimum, not Enhanced.** This audit checks 2.4.11 only. It does not check 2.4.12 (AAA), which requires that *no part* of the focused element be obscured, including by the user's own assistive technology.
- **Sampled, not painted.** Coverage is measured by sampling the focused element's box for unrelated content on top of it, and reading styles; nothing is rendered and compared. Unusual stacking, `clip-path` or `mask` combinations can confuse it.
- **Text on a transparent cover passes.** A cover that paints no background where the element is, only text or borders, is not counted as covering it.
- **Click-through canvases and frames are not examined** unless they are known to be solid, so an opaque click-through WebGL canvas or frame over an element is missed.
- **A WebGL canvas usually reads back empty** between frames, so an element beneath one is `incomplete` even when the canvas is solid.
- **Sticky headers are sampled.** The scrolled-to-top check re-measures at most `scrolledToTopLimit` elements, and a header that hides itself while the page scrolls down is not caught, because the check scrolls down to reach each element.
- **Click-through covers are found by a scan** of the page's positioned elements that is repeated at most once a second, and does not look inside shadow roots.

## Known false positives

Cases where the audit reports a problem that is not one. Each says which bucket it lands in: `incomplete` asks for a human to check, `violations` claims a failure.

- **Overlays that are only briefly on screen** (`violations`). Each element is measured once, the moment it takes focus, so a toast, loading veil or entrance animation covering it at that instant is reported as obscuring it.
- **Content whose own focus opens it** (`violations`). A panel opened by focusing one element that then fully covers the next tab stop is reported, although the user arguably opened it.
- **Transparent frames and canvases that take pointer events** (`incomplete`). An element entirely beneath an oversized chat-widget frame or an undrawn canvas is sent for review, since the audit cannot see whether anything is painted there.
- **Background images with transparent areas** (`violations`). Any background image or solid gradient counts as opaque, so a cover whose background is a mostly transparent PNG or SVG is reported although the element shows through it.
- **Every sampled element under a sticky header** (`violations`). On a page with a sticky header and no `scroll-padding-top`, each element the scrolled-to-top check samples is reported. They are all real, and share one fix.

## Releasing

Releases are managed in the [A11y-Pulse/audits](https://github.com/A11y-Pulse/audits) monorepo with [Changesets](https://github.com/changesets/changesets). Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC). There is no long-lived `NPM_TOKEN`.

### Ship a change

1. Open a PR against `main` that includes a changeset (`npx changeset`) naming `@a11y-pulse/focus-not-obscured-audit`.
2. After merge, the Release workflow opens a Version PR. Merging that PR publishes this package to npm and tags `@a11y-pulse/focus-not-obscured-audit@<version>`.

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
