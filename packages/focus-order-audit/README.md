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

The audit declares no capabilities: it reads what the orchestrator already records at every stop (the element's position, and whether it sits on a fixed or sticky ancestor or inside a dialog), then makes one call into the page to read its size and writing direction. Pass `analyse` the page's URL from before the session so that a navigation it did not notice makes the result inconclusive.

## How it decides

Positions are first converted to reading order, so "backwards" means the same thing on right-to-left pages and in vertical writing modes. Then, for each move from one tab stop to the next:

- A **backwards jump** climbs more than one viewport against the reading order, or crosses more than 60% of the viewport's width backwards while also climbing at least a tenth of a viewport. Smaller upward moves are ordinary layout and never count. Forward jumps of any size, such as skip links, are always fine.
- **Column thrash** is three or more moves in a row that alternate between regions more than 60% of the viewport's width apart, at least one of which climbs. A grid read row by row alternates too, but its rows line up so it never climbs; columns of uneven height read across each other do.

A page is reported only with at least three backwards jumps, or column thrash plus at least one jump. Elements with zero size, on a fixed or sticky ancestor, or inside a dialog are left out of the sequence: their page position says nothing about where a user sees them.

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
    kind: "backwards-jump" | "column-thrash";
    from: { selector: string; html: string; tabIndex: number };
    to: { selector: string; html: string; tabIndex: number };
  }>;
  /** Some element on the page has a positive `tabindex`, a likely cause of disorder. */
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
```

`findDisorder(sequence, page)`, the pure analyser behind the audit, is also exported for use on sequences recorded elsewhere.

## Limitations

- **Meaning is not measured.** A swapped label and field, or checkout steps out of order but side by side, pass unnoticed.
- **One page state, one viewport.** Disorder that only appears in menus, dialogs or at other screen sizes is not reached.
- **Document direction only.** Elements whose own `direction` or `writing-mode` differs from the document's are measured in the document's.
- **The page itself must scroll.** Positions are measured on the page, so an app that scrolls inside an inner container never appears to climb by more than a viewport and is not reported. One wrapped entirely in a fixed element has every stop left out.

## Known false positives

Cases where the audit reports a problem that is not one. Each says which bucket it lands in: `incomplete` asks for a human to check, `violations` claims a failure.

Every finding is `incomplete`: the audit never reports a violation.

- **Meaningful orders that differ from the layout.** WCAG 2.4.3 allows a focus order that does not follow the visual layout as long as it preserves meaning, such as independent columns of different heights read one after the other, or navigation placed after the main content in the source and moved up with CSS.
- **CSS reordering.** Items rearranged with flex `order`, grid placement or `row-reverse` can produce the long backwards jumps the audit looks for, whether or not the order matters. Reordering within a single flex or grid container is better judged by checking the container's CSS directly, which this audit does not do.
- **Widgets late in the source but drawn near the top.** A help or chat button positioned (but not fixed) at the top of the page, but last in the source, is one long backwards jump. Several of them on one page can be enough to report it.

## License

Released under the [PolyForm Shield License 1.0.0](./LICENSE.md), in plain language:

- **Source-available.** The source is public and you can read, fork, and modify it.
- **Permitted for non-competing use.** You can use this package freely in your own products and services, as long as they don't compete with A11y Pulse.
- **Competing products are forbidden.** You may not use this software (or a modified version of it) to build a product or service that competes with A11y Pulse's accessibility monitoring offering.

See [LICENSE.md](./LICENSE.md) for the full, binding terms.
