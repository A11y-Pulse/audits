# @a11y-pulse/focus-order-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/focus-order-audit)](https://www.npmjs.com/package/@a11y-pulse/focus-order-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit that flags tab sequences worth a human review under [**WCAG 2.2: 2.4.3 Focus Order**](https://www.w3.org/WAI/WCAG22/Understanding/focus-order). It tabs through a page, records where each focused element sits, and reports a page whose focus repeatedly jumps a long way against the reading order. It is built to be framework-agnostic and can be used in any environment that allows you to programmatically focus elements and observe the page, such as Puppeteer, Playwright, or Selenium.

2.4.3 asks whether the focus order preserves meaning and operability, not whether it matches the layout, and the Understanding document gives conforming examples where it does not. Geometry cannot judge meaning, so this audit never reports a pass or a violation: a disordered page is a prompt to check it with the Tab key. Positive `tabindex` values are left to axe-core's `tabindex` rule, though the audit mentions them as a likely cause.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/focus-order-audit @a11y-pulse/tab-orchestrator @a11y-pulse/browser-adaptor puppeteer
```

## Quickstart

```js
import { runFocusOrderAudit } from "@a11y-pulse/focus-order-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch({ defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const result = await runFocusOrderAudit(new PuppeteerAdaptor(page));

console.log(result.outcome);
// 'disordered'

console.log(result.transitions[0]);
// { kind: 'backwards-jump', from: { selector: '#footer-help', tabIndex: 34, ... }, to: { selector: 'header nav a', tabIndex: 35, ... } }

await browser.close();
```

## Shared tab session

To run alongside other tab-driven audits on one tab loop, attach the consumer to a shared orchestrator and call `analyse` once the session has run:

```ts
import { createTabOrchestrator } from "@a11y-pulse/tab-orchestrator";
import { createFocusOrderAudit } from "@a11y-pulse/focus-order-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";

const adaptor = new PuppeteerAdaptor(page);
const orchestrator = createTabOrchestrator(adaptor);

const focusOrder = createFocusOrderAudit();
orchestrator.attach(focusOrder);

await orchestrator.run();

const result = await focusOrder.analyse(adaptor);
```

The audit declares no capabilities: it reads what the orchestrator already records at every stop (the element's position, and whether it sits on a fixed or sticky ancestor or inside a dialog), then makes two calls into the page: one to read its size and writing direction, one to read each visited element's `tabindex`. Pass `analyse` the page's URL from before the session so that a navigation it did not notice makes the result inconclusive.

## How it decides

Positions are first converted to reading order, so "backwards" means the same thing on right-to-left pages and in vertical writing modes. Then, for each move from one tab stop to the next:

- A **backwards jump** climbs more than one viewport against the reading order, or crosses more than 60% of the viewport's width backwards while also climbing at least a tenth of a viewport. Forward jumps of any size, such as skip links, are always fine.
- A **column wrap** is not a jump. Text set in CSS columns, or a grid filled column by column, climbs from the foot of one column to the top of the next: further along the line, and level with or below where the columns just read began. That is the reading order, however tall the columns are. Where they began is the highest of the stops leading up to the move that sit wholly before the target along the line, so links part-way along a line of text, or two controls side by side in a card, do not change it. "Level" allows the target's own height, since the first link in one column of text can sit a line above the first link in the last. A move to or from an element with a positive `tabindex` is never a wrap.
- A **backwards drift** is a run of three or more climbing moves, none long enough to be a jump, that together climb more than one viewport: a list stacked with `column-reverse`, say. The run carries on across neighbours that sit level (rows of a reversed grid) and across steps part of the way back down (a second control lower in each card of a reversed feed), and ends when focus drops below where it began. It is reported as one transition, from the element the run started at to the highest one it reached.
- **Column thrash** is three or more moves in a row that alternate between regions more than 60% of the viewport's width apart, at least one of which climbs. A grid read row by row alternates too, but its rows line up so it never climbs; columns of uneven height read across each other do.

One or two short upward moves are ordinary layout and never count. A page is reported with any of:

- at least three backwards jumps;
- one backwards jump to or from an element with a positive `tabindex`, which is what took it out of the source order;
- a backwards drift;
- column thrash plus at least one jump.

Elements with zero size, on a fixed or sticky ancestor, or inside a dialog are left out of the sequence: their page position says nothing about where a user sees them.

## Browser support

| Adaptor | Browser | Supported |
| --- | --- | --- |
| Puppeteer | Chrome | Yes |
| Playwright | Chromium | Yes |
| Playwright | WebKit | **No.** WebKit does not move focus to links when Tab is pressed, so the audit only reaches a subset of the page. |
| Playwright | Firefox | Yes |

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `elementLimit` | `number` | `1024` | Max focusable elements to tab through. A truncated sequence is analysed as far as it got. |
| `screenshotSettleDelay` | `number` | `33` | How long to wait (in ms) after each Tab for the page to settle. |
| `timeout` | `number` | `0` (no timeout) | Limit how long (in ms) the tab loop runs. |

## Result shape

```ts
type FocusOrderResult = {
  /**
   * `unremarkable` is not a pass: geometry cannot show that an order preserves meaning.
   * `inconclusive` means the page navigated, or could not be read, before the sequence was judged.
   */
  outcome: "disordered" | "unremarkable" | "inconclusive" | "no-focusable";
  /** The offending transitions in tab order. Empty unless `disordered`. */
  transitions: Array<{
    kind: "backwards-jump" | "backwards-drift" | "column-thrash";
    from: FocusOrderElement;
    to: FocusOrderElement;
    /**
     * Movement in reading-order pixels. `block` is negative when focus moved back towards the start
     * of the page (up, on a horizontal page); `inline` when it moved back towards the start of a line.
     */
    distance: { block: number; inline: number };
    /** Where focus went on screen, by the larger of its horizontal and vertical movement. */
    direction: "up" | "down" | "left" | "right";
    /** Tab presses between `from` and `to`: 1 except for `backwards-drift`, which spans a run. */
    steps: number;
  }>;
  /**
   * Some element on the page has a positive `tabindex`, a likely cause of disorder. Each reported
   * element that has one carries its own `positiveTabindex`.
   */
  positiveTabindex: boolean;
  summary: {
    checked: number;
    passed: number;
    failed: number;
    reachedLimit: boolean;
    reachedFailedElementLimit: boolean;
    timedOut: boolean;
    sessionEnd: "completed" | "lostFocus" | "navigation" | "failed" | "stuck" | null;
  };
};

type FocusOrderElement = {
  selector: string;
  html: string;
  /** 1-based tab stop at which this element was reached. */
  tabIndex: number;
  /** Page-relative rect when the element was focused. */
  rect: { x: number; y: number; width: number; height: number };
  /** The element's own `tabindex` when it is positive. */
  positiveTabindex?: number;
};
```

`findDisorder(sequence, page)`, the pure analyser behind the audit, is also exported for use on sequences recorded elsewhere.

## Limitations

- **Meaning is not measured.** A swapped label and field, or checkout steps out of order but side by side, pass unnoticed.
- **One page state, one viewport.** Disorder that only appears in menus, dialogs or at other screen sizes is not reached.
- **Document direction only.** Elements whose own `direction` or `writing-mode` differs from the document's are measured in the document's.
- **Content placed beside what was just read looks like a column.** Navigation that follows the main content in the source but is drawn to its right, level with or below its top, is taken for the next column and not counted as a jump.
- **Columns that start higher than the last.** A column whose first focusable element sits more than its own height above everything in the columns before it, with nothing focusable above them, is counted as a backwards jump. Three such columns on one page are enough to report it.
- **The page itself must scroll.** Positions are measured on the page, so an app that scrolls inside an inner container never appears to climb by more than a viewport and is not reported. One wrapped entirely in a fixed element has every stop left out.

## Known false positives

Cases where the audit reports a problem that is not one. Each says which bucket it lands in: `incomplete` asks for a human to check, `violations` claims a failure.

Every finding is `incomplete`: the audit never reports a violation.

- **Meaningful orders that differ from the layout.** WCAG 2.4.3 allows a focus order that does not follow the visual layout as long as it preserves meaning, such as independent columns of different heights read one after the other, or navigation placed after the main content in the source and moved up with CSS.
- **CSS reordering.** Items rearranged with flex `order`, grid placement or `row-reverse` can produce the long backwards jumps the audit looks for, whether or not the order matters. Reordering within a single flex or grid container is better judged by checking the container's CSS directly, which this audit does not do.
- **Lists that are meant to read upwards.** A chat log or activity feed stacked with `column-reverse`, newest at the bottom, is reported as a backwards drift once it is taller than the viewport.
- **A positive `tabindex` used on purpose.** One long backwards jump to or from an element with a positive `tabindex` is enough to report the page, even where the order was chosen deliberately.
- **Widgets late in the source but drawn near the top.** A help or chat button positioned (but not fixed) at the top of the page, but last in the source, is one long backwards jump. Several of them on one page can be enough to report it.

## License

Released under the [PolyForm Shield License 1.0.0](./LICENSE.md), in plain language:

- **Source-available.** The source is public and you can read, fork, and modify it.
- **Permitted for non-competing use.** You can use this package freely in your own products and services, as long as they don't compete with A11y Pulse.
- **Competing products are forbidden.** You may not use this software (or a modified version of it) to build a product or service that competes with A11y Pulse's accessibility monitoring offering.

See [LICENSE.md](./LICENSE.md) for the full, binding terms.
