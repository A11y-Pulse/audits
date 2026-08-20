# @a11y-pulse/focus-not-obscured-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/focus-not-obscured-audit)](https://www.npmjs.com/package/@a11y-pulse/focus-not-obscured-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit that aims to verify compliance with [**WCAG 2.2: 2.4.11 Focus Not Obscured (Minimum)**](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum). It tabs through a page's focusable elements and detects whether each one is entirely hidden behind other content (a sticky header/footer, a cookie banner, a modal overlay, etc.) while focused. It is built to be framework-agnostic and can be used in any environment that allows you to programmatically focus elements and hit-test the page, such as Puppeteer, Playwright, or Selenium.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/focus-not-obscured-audit @a11y-pulse/tab-orchestrator puppeteer
```

`@a11y-pulse/tab-orchestrator` drives the page (tabbing, markers, obscuring measurement) and ships the bundled [Puppeteer adaptor](#adaptors); `puppeteer` itself is only required if you use that adaptor. Other frameworks can supply their own adaptor without installing Puppeteer at all.

## Quickstart

```js
import { runFocusNotObscuredAudit } from "@a11y-pulse/focus-not-obscured-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/tab-orchestrator/puppeteer";
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
//       obscuredBy: { selector: '#sticky-footer', html: '<div id="sticky-footer">' }
//     }
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
import { PuppeteerAdaptor } from "@a11y-pulse/tab-orchestrator/puppeteer";

const orchestrator = createTabOrchestrator(new PuppeteerAdaptor(page));

const notObscured = createFocusNotObscuredAudit({ elementLimit: 50 });
orchestrator.attach(notObscured);

await orchestrator.run();

console.log(notObscured.result);
```

`notObscured.result` is only complete once `notObscured` has disconnected (by hitting one of its own limits) or the session has ended — reading it before then is undefined. See [`@a11y-pulse/tab-orchestrator`](../tab-orchestrator) for the full session lifecycle and capability model. This audit declares only the `"obscuring"` capability — it does not need `unfocusedPair` or `baselineStyles`, so it can run alongside `focus-appearance-audit` on the same orchestrator without either one paying for the other's measurements.

## Options

The following options can be passed to `runFocusNotObscuredAudit` as `FocusNotObscuredOptions`:

| Option                  | Type     | Default         | Description                                                                                                                                         |
| ------------------------ | -------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `elementLimit`            | `number` | `1024`           | Max focusable elements to tab through.                                                                                                              |
| `screenshotSettleDelay`   | `number` | `33`             | How long to wait (in ms) after each Tab for the page to settle before measuring.                                                                    |
| `failedElementLimit`      | `number` | `0` (never)      | Finish the audit early once this many elements have failed, leaving the rest unchecked. Useful as a fail-fast signal when you only need to know a page has focus problems, not their full extent. |
| `timeout`                 | `number` | `0` (no timeout) | Limit how long (in ms) the audit runs before returning the results it has gathered so far.                                                          |

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
    /** The raw obscuring measurement behind `bucket`. */
    measurement: {
      coveredFraction: number;
      fullyObscured: boolean;
      offscreen: boolean;
      opacity: "opaque" | "semi-transparent" | "unknown";
      obscuredBy: { selector: string; html: string } | null;
    };
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
  };
};
```

### Buckets

[2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum) is a Level AA criterion: when an element receives keyboard focus, it must not be **entirely** hidden by author-created content (partial coverage is allowed at this level — full protection from any coverage is [2.4.12 Focus Not Obscured (Enhanced)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-enhanced), a Level AAA criterion this audit does not check). Each element is placed in one of three buckets:

- **`violation`** — the element is entirely hidden behind opaque content while focused. Fails 2.4.11.
- **`incomplete`** — the audit could not confirm compliance either way: the element was scrolled fully offscreen when focused, or it's entirely covered by something of unknown opacity (rare; usually SVG/canvas-painted overlays the audit can't classify).
- **`pass`** — the element is not obscured at all, only partially obscured, or entirely covered by a semi-transparent overlay (still visible through the cover, so not "entirely hidden").

`summary.failed` counts only `"violation"` elements; `"incomplete"` elements count toward `summary.passed` since they are not confirmed failures.

## Adaptors

The audit itself is framework-agnostic: it drives a page through an **adaptor**, a small interface of primitives (evaluate JS in the page, press Tab, hit-test the focused element, etc.) that the audit calls without knowing which browser automation library is behind it.

The `BrowserAdaptor` interface lives in [`@a11y-pulse/tab-orchestrator`](../tab-orchestrator), which also ships the bundled `PuppeteerAdaptor`, backed by a Puppeteer `Page`. This package re-exports the type so `runFocusNotObscuredAudit`'s argument type is available without a separate import. Other environments (Playwright, Selenium, WebDriver) can be supported by implementing the same interface.

Use [`@a11y-pulse/tab-orchestrator`'s `src/adaptors/puppeteer.ts`](../tab-orchestrator/src/adaptors/puppeteer.ts) as a reference implementation.

## Limitations

- **Tab order only.** The audit tabs through elements in native tab order. It does not yet exercise arrow-key composite widgets (menus, comboboxes, toolbars, etc.) where focus moves via `aria-activedescendant` or roving `tabindex` instead of native Tab.
- **Minimum, not Enhanced.** This audit checks 2.4.11 only. It does not check 2.4.12 (AAA), which requires that *no part* of the focused element be obscured, including by the user's own assistive technology.
- **Opaque hit-testing.** Coverage is measured by sampling the focused element's box for unrelated content on top of it; unusual stacking/clip-path/mask combinations could in rare cases confuse the opacity classification, which is why those cases are routed to `"incomplete"` rather than guessed.

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
