# @a11y-pulse/moving-content-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/moving-content-audit)](https://www.npmjs.com/package/@a11y-pulse/moving-content-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit for [**WCAG 2.2: 2.2.2 Pause, Stop, Hide**](https://www.w3.org/WAI/WCAG22/Understanding/pause-stop-hide). Content that starts moving on its own, keeps moving for more than five seconds and sits beside other content needs a way to pause, stop or hide it. Carousels on a timer, news tickers and background videos are the usual offenders: they pull attention away from the rest of the page, and some people cannot read past them at all.

Static analysis cannot see movement. This audit loads nothing and presses nothing: it watches the page for five seconds, works out which regions are still moving at the end, and looks for a control that pauses them.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/moving-content-audit @a11y-pulse/browser-adaptor puppeteer
```

## Quickstart

```js
import { runMovingContentAudit } from "@a11y-pulse/moving-content-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const result = await runMovingContentAudit(new PuppeteerAdaptor(page));

console.log(result.summary);
// { checked: 2, failed: 1, needsReview: 0, passed: 1, unchecked: 0,
//   ignored: { essential: 1, tooSmall: 0 } }

console.log(result.failed);
// [
//   {
//     selector: "#offers",
//     html: '<div class="carousel__viewport" id="offers">',
//     rect: { x: 20, y: 132, width: 760, height: 280 },
//     motion: "script",
//     detectedBy: "dom-observation",
//     finding: "no-pause-control",
//     observedMs: 4900,
//     animations: [],
//     pauseControl: null,
//     pausesOn: [],
//     reducedMotion: null,
//     screenshot: Uint8Array(…),
//     laterScreenshot: Uint8Array(…)
//   }
// ]

await browser.close();
```

The audit takes at least as long as its observation window: five seconds by default, plus up to about a second and a half for screenshots when something is reported. Run it on a page nothing else is driving, since focus changes, key presses and scrolling by another audit would be seen as movement.

## How it decides

### What counts as moving

| Movement | How it is found | `motion` / `detectedBy` |
| --- | --- | --- |
| A CSS animation that is endless, or runs for more than five seconds in total, and changes at least one property | `document.getAnimations()` at the end of the window | `css-animation` / `animation-api` |
| The same, started by a script with `element.animate()` | `document.getAnimations()` | `web-animation` / `animation-api` |
| A carousel, ticker or slideshow driven by a script | Elements a script touches during the window (their style, class or SVG geometry attributes, their children, their scroll offset) are sampled about fifty times; a region counts when its position, size, opacity, visibility, transform, scroll offset or image keeps changing, or short animations keep starting on it | `script` / `dom-observation` |
| `<marquee>` | The element itself | `marquee` / `element` |
| A `<video>` that is playing | Its playback state at the start and end of the window | `video` / `media-element` |

Script-driven movement has to be sustained and still going in the last two fifths of the window. Changes are grouped into bursts, a burst ending when the region holds still for a tenth of the window. Sustained means the movement came back after a pause (a carousel turning at least twice) or ran on without one for two fifths of the window (a ticker a script moves every frame). One burst late in the window, such as one turn of a slow carousel, is reported for review as `changed-once`.

Content arriving is not movement. The changes that bring an element into view (a consent bar sliding up, a slide fading in, a slot being filled) are left out, and a region whose moving elements all arrived during the window has to change more than once after that to be reported. So a region that settles early or arrives once (an entrance effect, a lazy-loaded banner, a notice that appears, an ad slot filled and then resized to its creative) is not reported. Animations that end within five seconds are allowed by the criterion and never reported, however short the observation window is.

At most 150 touched elements are watched at a time. Ones that were touched without changing, or that changed and have been still since, make room for new ones, so a burst of one-off changes while the page loads does not hide a carousel that starts later.

Moving elements are gathered into regions. A track sliding inside a smaller `overflow: hidden` box is reported as that box, an element moving inside another moving element is part of it, and slides stacked on top of each other are joined under their common parent. A region's `rect` is the part of it that can be seen.

### What is left alone

- **Loading and status indicators**: anything inside `role="progressbar"`, `status`, `alert`, `timer` or `log`, inside `aria-busy="true"`, a `<progress>` or `<meter>`, or with a class or id of `spinner`, `loader`, `loading`, `skeleton`, `shimmer` or `progress`. These are counted in `summary.ignored.essential`.
- **Small regions**: under `minRegionArea` (5000 CSS px², about 70 × 70). Counted in `summary.ignored.tooSmall`. An animated pseudo-element is measured by its own `width` and `height` where they can be read, so a ten-pixel "live" dot in the corner of a card is small however large the card is.
- **What nobody can see**: an element that is `visibility: hidden`, fully transparent (itself or through an ancestor), outside the page, or fixed outside the viewport, and that was not seen showing at any point in the window. A hidden preloader whose animation never stops is not reported; a slide that had just faded out when the window closed still counts.
- **Text updates**: a clock, counter or score changing its text is updating, not moving.

### Looking for a way to pause

For each moving region the audit looks for, in order:

1. A button, switch, checkbox or `<summary>` (an element with `role="button"` counts, a plain link does not) inside the region, or inside up to three ancestors that are no more than six times its size, or pointing at it with `aria-controls`, whose label says pause, stop, hide, close or dismiss (English plus Spanish, German, French, Dutch, Italian and Swedish words; see `controlNamePattern`). "Play" counts as the whole label, paired with pause ("Play/Pause"), or followed by what is moving ("Play slideshow"); "Play trailer" does not. Labels over 40 characters are ignored, so a slide headline such as "Stop wasting money on tents" is not taken for a control.
2. The same kind of control with no label but a class or id of `pause`, `play-pause` or `stop`. The missing label is another audit's finding.
3. A control or link anywhere on the page that turns animation off ("Pause animations", "Reduce motion").
4. For a video, the browser's own `controls`.

The audit does not press the control, so it does not check that it works.

### Verdicts

| List | `finding` | When |
| --- | --- | --- |
| `failed` | `no-pause-control` | A region of at least `largeRegionArea` (20000 CSS px², for example a 760 × 48 ticker) kept moving past the window and nothing above was found |
| `passed` | `pause-control` | A pause control was found |
| `passed` | `native-controls` | A playing video has `controls` |
| `needsReview` | `pauses-on-hover` | A stylesheet rule pauses the CSS animation on `:hover`. A keyboard user cannot hover |
| `needsReview` | `pauses-on-focus` | A stylesheet rule pauses the CSS animation on `:focus` or `:focus-within` |
| `needsReview` | `small-region` | The region is under `largeRegionArea` and may be decoration |
| `needsReview` | `subtle-animation` | The animation changes only colour, shadow or filter |
| `needsReview` | `changed-once` | The region changed in one burst late in the window, such as one slide of a carousel on a four-second timer |
| `needsReview` | `pseudo-element` | Only a pseudo-element is animated and its size could not be read (an inline `::after` cursor, for example). A pseudo-element of at least `largeRegionArea` is treated as the region itself |
| `needsReview` | `finite-loop` | A `<marquee>` with a `loop` count |
| `needsReview` | `uncertain-playback` | A video that started during the window, or whose length is unknown |

`reducedMotion` records whether a `prefers-reduced-motion` rule applies to the region's CSS animation. It is supporting evidence and never changes the verdict: the criterion asks for a mechanism on the page.

## Browser support

The audit uses `document.getAnimations()`, `MutationObserver` and `Element.checkVisibility()`, all available in current Chromium, Firefox and WebKit. Its integration suite runs on every engine the repository's CI covers; at the time of writing it has been run against Chromium through Puppeteer and Playwright. How `<marquee>` and stream-backed videos report themselves varies between engines, so treat Firefox and WebKit results for those two as less certain.

The adaptor must provide `evaluate`, `evaluateHandle`, `disposeRef` and `screenshotClip`. The bundled `PuppeteerAdaptor` and `PlaywrightAdaptor` do.

## Options

| Option | Default | Description |
| --- | --- | --- |
| `observationWindow` | `5000` | How long to watch the page, in ms. Content still moving at the end is reported. Five seconds is the limit in the criterion; a shorter window makes script-driven findings less certain, a longer one catches slower carousels. |
| `minRegionArea` | `5000` | Smallest visible area, in CSS px², of a moving region worth reporting. |
| `largeRegionArea` | `20000` | Smallest visible area, in CSS px², of a region that can fail. Smaller regions are reported for review. |
| `regionLimit` | `20` | Max moving regions to examine, largest first. |
| `controlNamePattern` | see `DEFAULT_CONTROL_NAME_PATTERN` | Regular expression source, matched case-insensitively (with the `u` flag) against the label of controls near a moving region. |
| `screenshotLimit` | `5` | Max failed and needs-review regions to screenshot, failed first. `0` takes none. |
| `screenshotInterval` | `1000` | Time between a region's two screenshots, in ms. |

## Result shape

```ts
type MovingContentRegion = {
  /** Selector for the moving region. */
  selector: string;
  /** Truncated opening tag. */
  html: string;
  /** The visible part of the region, in document coordinates. */
  rect: { x: number; y: number; width: number; height: number };
  motion: "video" | "marquee" | "css-animation" | "web-animation" | "script";
  detectedBy: "media-element" | "element" | "animation-api" | "dom-observation";
  /** Why the region is in the list it is in. See the verdicts table. */
  finding: MovingContentFinding;
  /** How long into the observation window the region was last seen moving. */
  observedMs: number;
  /** The long-running animations on the region. */
  animations: {
    name: string | null;
    infinite: boolean;
    activeDurationMs: number | null;
    /** The CSS properties whose value changes over the animation. */
    properties: string[];
    /** The pseudo-element the animation runs on, such as "::after", or null. */
    pseudoElement: string | null;
  }[];
  pauseControl: {
    selector: string;
    html: string;
    name: string;
    foundBy: "name" | "attribute" | "page-control";
  } | null;
  /** States in which a stylesheet rule pauses the region's CSS animation. */
  pausesOn: ("hover" | "focus")[];
  /** Whether a prefers-reduced-motion rule applies. Null when it is not a CSS animation. */
  reducedMotion: boolean | null;
  /** PNG bytes of the region at the end of the window, for failed and needs-review regions. */
  screenshot?: Uint8Array;
  /** PNG bytes of the region `screenshotInterval` later. */
  laterScreenshot?: Uint8Array;
};

type MovingContentResult = {
  failed: MovingContentRegion[];
  needsReview: MovingContentRegion[];
  passed: MovingContentRegion[];
  /** How long the page was observed for. */
  observedMs: number;
  summary: {
    checked: number;
    failed: number;
    needsReview: number;
    passed: number;
    /** Moving regions past `regionLimit`. */
    unchecked: number;
    ignored: { essential: number; tooSmall: number };
  };
};
```

The two screenshots are evidence for a person, and the audit does not compare them: a carousel can look the same in both if they fall between slides. Each region is scrolled into view for its captures and the page is scrolled back afterwards. The audit removes its observers and everything it left on `window` before it returns.

## Limitations

- **Slow carousels.** A carousel that advances less often than about every two and a half seconds changes once in the window and is reported for review; one on a timer longer than the window is not seen at all. Raise `observationWindow` to catch them.
- **Content that arrives and then moves slowly.** A carousel that is itself inserted during the window has its first changes read as its entrance, so it needs two further turns in the window to be reported.
- **Canvas, WebGL and animated images.** Movement drawn inside a `<canvas>`, an animated GIF, APNG or WebP, and an animated SVG using SMIL are not detected.
- **Only what a script touches is watched.** Script-driven movement is found through changes to `style`, `class`, `hidden`, `src`, `open` and SVG geometry attributes (`transform`, `d`, `points`, `x`, `y`, `cx`, `cy`, `r`, `width`, `height`, `viewBox` and the like), child changes and scroll events. Movement driven through any other attribute or through a CSS custom property set on a distant ancestor is not seen. Movement inside closed shadow roots, cross-origin iframes, or shadow roots attached after the audit starts is not seen.
- **Auto-updating content.** The second half of the criterion, content that updates on its own such as a live score, is out of scope.
- **The control is not operated.** A button labelled "Pause" that does nothing passes. So does a region whose only nearby match is an unrelated "Close" button. A pause control that is a plain link (`<a href="#">Pause</a>` with no `role="button"`) is not recognised.
- **Hover and focus pausing is read from stylesheets only.** A script that pauses a carousel on `mouseenter` or `focusin` is not recognised, and cross-origin stylesheets cannot be read.
- **Listed languages only.** A pause control labelled in another language is not recognised unless `controlNamePattern` covers it.
- **Parallax and scroll-linked effects** do not start on their own and are not reported, since nothing scrolls during the window.

## Known false positives

- **Decorative background animation.** A large hero with a slowly drifting gradient or floating shapes fails when it moves, resizes or fades. Whether that is "presented in parallel with other content" in a way that matters is a judgement call; a page-wide "Pause animations" control passes it.
- **Large loading placeholders with no semantics.** A skeleton screen that never resolves and has no `aria-busy`, status role or recognisable class is reported.
- **Live video feeds.** A webcam or stream preview with custom controls labelled in an unlisted language fails.

## License

Released under the [PolyForm Shield License 1.0.0](./LICENSE.md), in plain language:

- **Source-available.** The source is public and you can read, fork, and modify it.
- **Permitted for non-competing use.** You can use this package freely in your own products and services, as long as they don't compete with A11y Pulse.
- **Competing products are forbidden.** You may not use this software (or a modified version of it) to build a product or service that competes with A11y Pulse's accessibility monitoring offering.

See [LICENSE.md](./LICENSE.md) for the full, binding terms.
