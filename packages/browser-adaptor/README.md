# @a11y-pulse/browser-adaptor

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/browser-adaptor)](https://www.npmjs.com/package/@a11y-pulse/browser-adaptor)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

Shared browser adaptor primitives and DOM helpers used by [A11y Pulse](https://www.a11ypulse.com/) accessibility audits. Audit packages drive a page through a `BrowserAdaptor` without depending on a specific automation library. This package also exports `getSelector` and `truncateHtml` for building result metadata.

Released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/browser-adaptor
```

`puppeteer` is an optional peer dependency. It is only required if you use the bundled [Puppeteer adaptor](#puppeteer-adaptor).

## Exports

| Entry | Contents |
| --- | --- |
| `@a11y-pulse/browser-adaptor` | `BrowserAdaptor`, `ElementRef`, `Rect` |
| `@a11y-pulse/browser-adaptor/puppeteer` | `PuppeteerAdaptor` |
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
  screenshotClip(clip: Rect): Promise<Uint8Array>;
  ensureFocusReporting(): Promise<void>; // must not throw
}
```

Consumers may ignore methods they do not need. `ensureFocusReporting` is best-effort and must not throw.

## Puppeteer adaptor

`PuppeteerAdaptor` wraps a Puppeteer `Page`. Focus emulation is enabled at most once per page via a `WeakSet`, so reused pages across audit runs do not open extra CDP sessions.

## DOM helpers

```js
import { getSelector, truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
```

`getSelector` builds a compact selector for an element (intended to run in page context). `truncateHtml` shortens an element's opening tag for display in results.

## License

[PolyForm Shield License 1.0.0](./LICENSE.md). Read, fork, and use in non-competing products. Do not use this package to build a competing accessibility monitoring service.
