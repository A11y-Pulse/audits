# @a11y-pulse/skip-link-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/skip-link-audit)](https://www.npmjs.com/package/@a11y-pulse/skip-link-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit that aims to verify the skip-link technique for [**WCAG 2.4.1 Bypass Blocks**](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html). When a skip-link-like in-page fragment anchor appears in the first few tab stops, it activates the link with Enter and checks that keyboard focus moves to the target. It is built to be framework-agnostic and can be used in any environment that allows you to programmatically tab, press Enter, and read the focused element, such as Puppeteer, Playwright, or Selenium.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

WCAG 2.4.1 can also be satisfied by landmarks or a heading structure. A page with no skip link is not necessarily failing. This audit only evaluates pages that have a skip-link-like anchor; it stays silent otherwise.

## Install

```bash
npm install @a11y-pulse/skip-link-audit puppeteer
```

`puppeteer` is an optional peer dependency. It is only required if you use the bundled [Puppeteer adaptor](#adaptors). Other frameworks can supply their own adaptor without installing Puppeteer at all.

## Quickstart

```js
import { runSkipLinkAudit } from "@a11y-pulse/skip-link-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/skip-link-audit/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const result = await runSkipLinkAudit(new PuppeteerAdaptor(page));

console.log(result.summary);
// { found: 1, passed: 1, failed: 0 }

console.log(result.skipLinks);
// [
//   {
//     selector: 'a[href="#main"]',
//     html: '<a href="#main">',
//     fragment: "#main",
//     tabIndex: 1,
//     passed: true,
//     failureReason: null
//   }
// ]

await browser.close();
```

See [`examples/puppeteer`](./examples/puppeteer) for a complete, runnable example.

## Options

The following options can be passed to `runSkipLinkAudit` as `SkipLinkOptions`:

| Option           | Type     | Default | Description                                                                                          |
| ---------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `candidateLimit` | `number` | `3`     | Max tab stops to scan for skip-link candidates. A skip link beyond this limit is not evaluated.      |

## Result shape

`runSkipLinkAudit` resolves to a `SkipLinkResult`:

```ts
type SkipLinkResult = {
  /** Skip-link candidates found in the first tab stops. Empty when none were found. */
  skipLinks: Array<{
    selector: string;
    html: string;
    fragment: string;
    tabIndex: number;
    passed: boolean;
    failureReason: "target-missing" | "activation-no-effect" | null;
  }>;
  summary: {
    found: number;
    passed: number;
    failed: number;
  };
};
```

When no candidate is found, `skipLinks` is empty and the summary is zeros. Landmark-only pages are not flagged.

## How it works

1. Enable focus reporting so Tab, Enter, and `:focus` behave as they would in a foreground tab.
2. Press Tab up to `candidateLimit` times. After each press, inspect the focused element (descending open shadow roots). An `<a>` whose `href` is an in-page fragment (`#name`, not bare `#` and not `#top`) is recorded as a candidate, along with whether a matching `id` or `name` exists. The scan stops early on `<body>` or if focus cycles.
3. For each candidate whose target is missing, record `target-missing`.
4. For each candidate whose target exists: re-focus the link, press Enter, and poll for up to 250ms. The candidate passes if `document.activeElement` is the target or inside it. If not, press Tab once and pass if the newly focused element is inside the target (browsers set the sequential focus navigation starting point on fragment navigation even when the target is not focusable). Otherwise record `activation-no-effect`.

Activation uses a real Enter keypress rather than a synthetic click, so the keyboard path is the one being checked.

## Adaptors

The audit itself is framework-agnostic: it drives a page through an **adaptor**, a small interface of primitives (evaluate JS in the page, press Tab, press Enter) that the audit calls without knowing which browser automation library is behind it.

The package ships one implementation, `PuppeteerAdaptor`, backed by a Puppeteer `Page`. Other environments (Playwright, Selenium, WebDriver) can be supported by implementing the same interface, exported as `SkipLinkAuditAdaptor` (aliased as `BrowserAdaptor` from the package root).

### `SkipLinkAuditAdaptor` / `BrowserAdaptor`

| Method                   | Description                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evaluate(fn, ...args)`  | Runs `fn` in the page context, passing in any serialisable `args`, and returns its result.                                                          |
| `evaluateHandle(fn)`     | Runs `fn` in the page context and returns an opaque `ElementRef` handle to the `Element` it returns, without serialising it.                        |
| `disposeRef(ref)`        | Releases a handle previously returned by `evaluateHandle`.                                                                                           |
| `pressTab()`             | Presses the Tab key, advancing focus to the next focusable element.                                                                                  |
| `pressEnter()`           | Presses the Enter key, activating the focused element.                                                                                               |
| `ensureFocusReporting()` | Ensures the page reports focus for its lifetime, in particular that `document.hasFocus()` works and `:focus` styles apply even when the page is not the foreground tab/window. Must not throw. |

### Writing a new adaptor

Implement `SkipLinkAuditAdaptor` from `@a11y-pulse/skip-link-audit` (or its `BrowserAdaptor` alias) against your automation library's page/session object, then pass an instance to `runSkipLinkAudit`:

```ts
import type { SkipLinkAuditAdaptor } from "@a11y-pulse/skip-link-audit";

class MyFrameworkAdaptor implements SkipLinkAuditAdaptor {
  // ...implement evaluate, evaluateHandle, disposeRef, pressTab,
  // pressEnter, and ensureFocusReporting for your framework
}
```

Use [`src/adaptors/puppeteer.ts`](./src/adaptors/puppeteer.ts) as a reference implementation. It is a small, self-contained example of every method the audit needs.

## Limitations

- **Chromium focus emulation.** Accurate `:focus` / `document.hasFocus()` reporting for a backgrounded page relies on Chromium's CDP focus emulation (used by `PuppeteerAdaptor.ensureFocusReporting`). Other browser engines may not offer an equivalent, and results may be less reliable if the page genuinely loses focus during the audit.
- **First tab stops only.** Skip links beyond `candidateLimit` (default 3) are not detected. The audit stays silent, which never flags a conformant page.
- **Fragment anchors only.** Button-based skip controls and JavaScript-only focus movers are out of scope.
- **Closed shadow roots** are opaque; a skip link inside one is invisible to the scan.
- **Landmarks and headings** that satisfy 2.4.1 without a skip link are out of scope by design.

## Releasing

Releases are managed in the [A11y-Pulse/audits](https://github.com/A11y-Pulse/audits) monorepo with [Changesets](https://github.com/changesets/changesets). Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC). There is no long-lived `NPM_TOKEN`.

### Ship a change

1. Open a PR against `main` that includes a changeset (`npx changeset`) naming `@a11y-pulse/skip-link-audit`.
2. After merge, the Release workflow opens a Version PR. Merging that PR publishes this package to npm and tags `@a11y-pulse/skip-link-audit@<version>`.

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
