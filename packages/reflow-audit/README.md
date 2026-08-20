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
//     reason: "element-overflow"
//   }
// ]

await browser.close();
```

## Options

The following options can be passed to `runReflowAudit` as `ReflowOptions`:

| Option           | Type     | Default | Description                                                                                          |
| ---------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `settleDelayMs`  | `number` | `50`    | Delay between layout-fingerprint readings while waiting for media queries and lazy content to apply. |
| `settleAttempts` | `number` | `10`    | Max fingerprint readings before measuring anyway and marking the result `unsettled`.                 |

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
    reason: "element-overflow" | "fixed-width-container";
  }>;
};
```

Bucket rules:

- **pass**: no meaningful horizontal overflow at 320px, or overflow that is fully explained by exempt 2D content such as a data table.
- **violation**: confirmed document overflow (above the 20px scrollbar-gutter band) with a non-exempt overflowing element.
- **incomplete**: overflow in the 2-20px gutter band, an unsettled layout, overflow that cannot be attributed to a node, or a fixed-width-container heuristic with no confirmed element overflow.

The incoming viewport is restored even if measurement throws. Pages already 320px wide or narrower are measured in place with no resize.

## How it works

1. Read the current viewport. If it is already 320px wide or narrower, skip the resize. Otherwise stash it and set `{ width: 320, height: max(current.height, 1024) }`.
2. Settle: reread a layout fingerprint (`scrollWidth`, `clientWidth`, child count) with a short delay until two consecutive readings agree, or until the attempt cap. Hitting the cap marks the result `unsettled`.
3. Measure in one in-page evaluation:
   - Document overflow is the max of `documentElement` and `body` `scrollWidth - clientWidth`. Up to 2px is treated as none (sub-pixel rounding). 2-20px is a low-confidence scrollbar-gutter signal.
   - Overflowing elements are visible nodes (open shadow roots included) whose `getBoundingClientRect().right` extends past the viewport, excluding `position: fixed`, `aria-hidden="true"`, zero-area nodes, off-screen nodes, and content inside a viewport-fitting `overflow-x: auto|scroll` ancestor. Only the outermost offender in a chain is reported.
   - Fixed-width containers (`width` / `min-width` in px larger than the viewport) are a heuristic, never a violation on their own.
4. Exemptions: do not record element overflow for a node that is, or descends from, a data `<table>` (not `role="presentation"` / `"none"`), `[role=table|grid|treegrid]`, `svg`, `canvas`, `video`, `img`, `iframe` / `embed`, `[role=toolbar]`, or a slide/presentation container. Layout tables stay eligible. Document overflow explained only by exempt content is not flagged.
5. Restore the original viewport in `finally` and settle once more.

## Adaptors

The audit itself is framework-agnostic: it drives a page through an **adaptor**, a small interface of primitives (evaluate JS in the page, get and set the viewport) that the audit calls without knowing which browser automation library is behind it.

The package ships one implementation, `PuppeteerAdaptor`, backed by a Puppeteer `Page`. Other environments (Playwright, Selenium, WebDriver) can be supported by implementing the same interface, exported as `ReflowAuditAdaptor` (aliased as `BrowserAdaptor` from the package root).

### `ReflowAuditAdaptor` / `BrowserAdaptor`

| Method                  | Description                                                                 |
| ----------------------- | --------------------------------------------------------------------------- |
| `evaluate(fn, ...args)` | Runs `fn` in the page context, passing in any serialisable `args`.          |
| `getViewport()`         | Returns the page's current CSS viewport `{ width, height }`.                |
| `setViewport(v)`        | Sets the page's CSS viewport to `{ width, height }`.                        |

### Writing a new adaptor

Implement `ReflowAuditAdaptor` from `@a11y-pulse/reflow-audit` (or its `BrowserAdaptor` alias) against your automation library's page/session object, then pass an instance to `runReflowAudit`:

```ts
import type { ReflowAuditAdaptor } from "@a11y-pulse/reflow-audit";

class MyFrameworkAdaptor implements ReflowAuditAdaptor {
  // ...implement evaluate, getViewport, and setViewport for your framework
}
```

Use [`src/adaptors/puppeteer.ts`](./src/adaptors/puppeteer.ts) as a reference implementation.

## Limitations

- **Clipped loss.** Content hidden by `overflow: hidden` rather than made reachable by horizontal scroll is a genuine 1.4.10 failure that v1 does not detect. That case is a documented false negative.
- **Closed shadow roots** can still contribute to document overflow but cannot be attributed to a node, so unattributed overflow lands in `incomplete`.
- **Cross-origin iframes** are opaque, consistent with the rest of the audit family.
- **Height reflow.** v1 measures the 320px-wide case for vertical-scrolling content. The criterion's 256px-tall case for horizontal-scrolling content is out of scope.
- **Requires-2D judgment.** Whether a given wide widget truly needs two-dimensional layout is left to human review beyond the published exemptions.

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
