# @a11y-pulse/browser-adaptor

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/browser-adaptor)](https://www.npmjs.com/package/@a11y-pulse/browser-adaptor)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE.md)

Shared browser adaptor primitives and DOM helpers used by [A11y Pulse](https://www.a11ypulse.com/) accessibility audits. Audit packages drive a page through a `BrowserAdaptor` without depending on a specific automation library. This package also exports `getSelector` and `truncateHtml` for building result metadata.

Released under the [MIT License](#license).

## Install

```bash
npm install @a11y-pulse/browser-adaptor
```

`puppeteer` and `playwright-core` are optional peer dependencies. Each is only required if you use the matching bundled adaptor ([Puppeteer](#puppeteer-adaptor), [Playwright](#playwright-adaptor)).

## Exports

| Entry | Contents |
| --- | --- |
| `@a11y-pulse/browser-adaptor` | `BrowserAdaptor`, `ElementRef`, `Rect` |
| `@a11y-pulse/browser-adaptor/puppeteer` | `PuppeteerAdaptor` |
| `@a11y-pulse/browser-adaptor/playwright` | `PlaywrightAdaptor` |
| `@a11y-pulse/browser-adaptor/dom` | `getSelector`, `truncateHtml` |

## Quickstart

```js
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://example.com/");

const adaptor = new PuppeteerAdaptor(page);
await adaptor.ensureFocusReporting();
await adaptor.pressTab();

await browser.close();
```

## BrowserAdaptor

Implement this interface against your automation library's page or session object:

```ts
interface BrowserAdaptor {
  evaluate<T>(fn: (...args: any[]) => T | Promise<T>, ...args: unknown[]): Promise<T>;
  evaluateHandle(fn: () => Element | null): Promise<ElementRef>;
  disposeRef(ref: ElementRef): Promise<void>;
  pressTab(): Promise<void>;
  pressEnter(): Promise<void>;
  screenshotClip(clip: Rect, scale?: number): Promise<Uint8Array>;
  readonly screenshotClipScale?: number;
  ensureFocusReporting(): Promise<void>; // must not throw
}
```

Consumers may ignore methods they do not need. `ensureFocusReporting` is best-effort and must not throw.

## Puppeteer adaptor

`PuppeteerAdaptor` wraps a Puppeteer `Page`. Its CDP session is cached per page, so reusing a page across audit runs does not open extra sessions.

## Playwright adaptor

`PlaywrightAdaptor` wraps a Playwright `Page`, and works with either `playwright` or `playwright-core`.

```js
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 2 });
await page.goto("https://example.com/");

const adaptor = new PlaywrightAdaptor(page);
await adaptor.ensureFocusReporting();
await adaptor.pressTab();

await browser.close();
```

Two differences from the Puppeteer adaptor are worth knowing about.

**`evaluate` needs `unsafe-eval`.** Playwright's `evaluate` takes a single argument, so the adaptor packs the page function's source and its arguments into one tuple and rebuilds the function in the page with `new Function`. A page whose Content-Security-Policy omits `unsafe-eval` from `script-src` will reject that; the adaptor throws a message naming CSP as the cause rather than letting it read as a page failure. Puppeteer is unaffected, because CDP serialises the function itself.

**Screenshot scale depends on the engine.** On Chromium the adaptor screenshots over CDP, which honours `screenshotClipScale` per capture and captures clips that lie outside the viewport, so evidence images match Puppeteer's. Firefox and WebKit expose no CDP, so the adaptor falls back to a full-page capture at the context's own `deviceScaleFactor`. There, create the context with a `deviceScaleFactor` matching `screenshotClipScale` (2 by default), or pass the scale you want:

```js
new PlaywrightAdaptor(page, { screenshotClipScale: 1 });
```

## DOM helpers

```js
import { getSelector, truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
```

`getSelector` builds a compact selector for an element (intended to run in page context). `truncateHtml` shortens an element's opening tag for display in results.

## License

[MIT](./LICENSE.md). Use it however you like, including in commercial and competing products.

The audit packages in this repository are licensed separately, under the
[PolyForm Shield License 1.0.0](../../LICENSE.md).
