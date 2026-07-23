# @a11y-pulse/focus-appearance-audit

An accessibility audit that aims to verify compliance with [**WCAG 2.0: 2.4.7 Focus Visible**](https://www.w3.org/WAI/WCAG20/Understanding/focus-visible). It tabs through a page's focusable elements and detects whether each one shows a visible focus indicator. It is built to be framework-agnostic and can be used in any environment that allows you to programmatically focus elements and read their computed styles, such as Puppeteer, Playwright, or Selenium.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](./LICENSE.md).

## Usage

```js
import { runFocusAppearanceAudit } from "@a11y-pulse/focus-appearance-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/focus-appearance-audit/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const result = await runFocusAppearanceAudit(new PuppeteerAdaptor(page), {
  elementLimit: 20,
});

console.log(result.summary);
// { checked: 2, passed: 1, failed: 1, reachedLimit: false }

console.log(result.elements);
// [
//   {
//     selector: 'html>body>button',
//     html: '<button>',
//     tabIndex: 1,
//     passed: true,
//     detectionMethod: 'style'
//   },
//   {
//     selector: 'html>body>section.wrap>article.pb-3>ul>li>a',
//     html: '<a href="https://github.com/wildlyinaccurate/second">',
//     tabIndex: 2,
//     passed: false,
//     detectionMethod: null
//   },
// ]

await browser.close();
```

## Options

The following options can be passed to `runFocusAppearanceAudit`:

| Option                    | Type      | Default | Description                                                                                                                      |
| ------------------------- | --------- | ------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `elementLimit`            | `number`  | `1024`  | Max focusable elements to tab through.                                                                                           |
| `screenshotSettleDelay`   | `number`  | `33`    | How long to wait (in ms) after each Tab for focus styles/transitions to settle.                                                  |
| `screenshotClipBuffer`    | `number`  | `10`    | Padding (in px) around the element box for the pixel-diff screenshot.                                                            |
| `screenshotDiffThreshold` | `number`  | `4`     | Number of pixels that must differ to consider an indicator present.                                                              |
| `skipStyleCheck`          | `boolean` | `false` | Skip the computed-style stage and run a pixel diff for every element. Much slower, but may reduce false positives in rare cases. |

## Detection methods

Focus appearance detection runs in either one or two stages. The first stage is a fast and memory efficient comparison of computed styles. If no style changes are detected, a second stage captures screenshots of the focused element and compares them pixel by pixel. The second stage is more expensive but can detect focus appearance that does not show in computed styles.

### Stage 0: Preparation

At the beginning of the audit, a snapshot of each focusable element's computed styles is taken. This snapshot contains only [focus-relevant properties](./src/focus-style.ts) and the elements' `::before` & `::after` pseudo-elements. The audit then begins a loop of tabbing through each focusable element and running it through the next two stages.

### Stage 1: computed style comparison

![Three steps: a navigation menu with nothing focused, then Tab moving focus to the first link which gains a blue outline, then the link's computed style changing from outline none to a solid blue outline, which is detected as a pass](./docs/detection-style.svg)

Once an element is focused, its computed styles are captured again and compared to the baseline. If any property has changed, the element passes with `detectionMethod: "style"`; if not, it moves to Stage 2. This stage is very fast and has not produced any false positives in testing.

### Stage 2: pixel-diff fallback

![Five steps: the page, then Tab focusing a link styled only with a filter glow, then the watched computed styles looking identical before and after, then falling back to a pixel diff, then a focused versus unfocused versus diff comparison of the clipped link where the diff highlights the changed pixels](./docs/detection-pixel.svg)

Since focus appearance can be achieved without modifying style properties (a `filter`, an animated background), a more expensive pixel-diff fallback is used. In this stage, a clipped screenshot is taken of the element in both its focused and unfocused states. The two images are compared pixel by pixel, and if they differ beyond a certain threshold, the element passes with `detectionMethod: "pixel-diff"`.

## Accuracy

This audit is a heuristic and can be wrong in both directions. See [docs/accuracy.md](./docs/accuracy.md) for the known false positives, false negatives, and intentional failures.

## WCAG 2.0 2.4.7 (Focus Visible) vs WCAG 2.2 2.4.13 (Focus Appearance)

Both success criteria concern the keyboard focus indicator, but they set very different bars. [2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG20/Understanding/focus-visible) is a Level AA criterion from WCAG 2.0 and is purely existential: when an element receives keyboard focus, some visible focus indicator must appear. It says nothing about how large or how visible that indicator has to be, so even a faint one-pixel outline satisfies it.

[2.4.13 Focus Appearance](https://www.w3.org/WAI/WCAG22/Understanding/focus-appearance) is a Level AAA criterion added in WCAG 2.2 that closes that gap. On top of requiring an indicator, it sets a minimum size (at least the area of a 2 CSS pixel thick perimeter of the component) and a minimum contrast (a ratio of at least 3:1 between the focused and unfocused states of the same pixels).

At the time of writing this audit only checks for 2.4.7. Experimental support for 2.4.13 will be added in a future release.

## Adaptors

The audit comes with a Puppeteer adaptor, but can be used in many other environments by implementing [`FocusAppearanceAuditAdaptor`](./src/adaptor.ts).
