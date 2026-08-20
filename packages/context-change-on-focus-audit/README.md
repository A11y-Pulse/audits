# @a11y-pulse/context-change-on-focus-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/context-change-on-focus-audit)](https://www.npmjs.com/package/@a11y-pulse/context-change-on-focus-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit that aims to verify compliance with [**WCAG 2.2: 3.2.1 On Focus**](https://www.w3.org/WAI/WCAG22/Understanding/on-focus). It tabs through a page's focusable elements and detects whether merely receiving focus triggers a context change: a new window/tab, an auto-submitted form, a full navigation, focus being silently removed, or focus being redirected somewhere outside the element's own subtree. It is built to be framework-agnostic and can be used in any environment that allows you to programmatically focus elements and observe the page, such as Puppeteer, Playwright, or Selenium.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/context-change-on-focus-audit @a11y-pulse/tab-orchestrator puppeteer
```

`@a11y-pulse/tab-orchestrator` drives the page (tabbing, markers, context-change observation) and ships the bundled [Puppeteer adaptor](#adaptors); `puppeteer` itself is only required if you use that adaptor. Other frameworks can supply their own adaptor without installing Puppeteer at all.

## Quickstart

```js
import { runContextChangeOnFocusAudit } from "@a11y-pulse/context-change-on-focus-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/tab-orchestrator/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const result = await runContextChangeOnFocusAudit(new PuppeteerAdaptor(page), {
  elementLimit: 20,
});

console.log(result.summary);
// { checked: 2, passed: 1, failed: 1, reachedLimit: false, reachedFailedElementLimit: false, timedOut: false, sessionEnd: 'completed' }

console.log(result.elements);
// [
//   {
//     selector: 'html>body>input#popup',
//     html: '<input id="popup">',
//     tabIndex: 1,
//     failed: true,
//     findings: [{ kind: 'new-window', bucket: 'violation' }],
//   },
// ]

await browser.close();
```

See [`@a11y-pulse/focus-appearance-audit`'s `examples/puppeteer`](../focus-appearance-audit/examples/puppeteer) for a runnable example of the same shared-adaptor pattern.

## Shared tab session

`runContextChangeOnFocusAudit` is a convenience wrapper: it builds a private `@a11y-pulse/tab-orchestrator` session, attaches one consumer, runs it, and hands back that consumer's result. If you're running more than one tab-driven audit against the same page (for example alongside [`@a11y-pulse/focus-appearance-audit`](../focus-appearance-audit) or [`@a11y-pulse/focus-not-obscured-audit`](../focus-not-obscured-audit)), drive a single shared orchestrator instead so the page is only tabbed through once. Use `createContextChangeOnFocusAudit` to get a `TabConsumer` you can `attach()` yourself:

```ts
import { createTabOrchestrator } from "@a11y-pulse/tab-orchestrator";
import { createContextChangeOnFocusAudit } from "@a11y-pulse/context-change-on-focus-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/tab-orchestrator/puppeteer";

const orchestrator = createTabOrchestrator(new PuppeteerAdaptor(page));

const contextChange = createContextChangeOnFocusAudit({ elementLimit: 50 });
orchestrator.attach(contextChange);

await orchestrator.run();

console.log(contextChange.result);
```

`contextChange.result` is only complete once `contextChange` has disconnected (by hitting one of its own limits) or the session has ended — reading it before then is undefined. See [`@a11y-pulse/tab-orchestrator`](../tab-orchestrator) for the full session lifecycle and capability model. This audit declares only the `"contextSignals"` capability — it does not need `obscuring`, `unfocusedPair`, or `baselineStyles`, so it can run alongside the other audits on the same orchestrator without paying for their measurements.

Because a genuine navigation ends the whole shared session (`summary.sessionEnd === "navigation"`), any other consumers attached to the same orchestrator also stop receiving tab stops once one occurs — this is a property of the shared session, not something this audit can opt out of.

## Options

The following options can be passed to `runContextChangeOnFocusAudit` as `ContextChangeOnFocusOptions`:

| Option                  | Type     | Default         | Description                                                                                                                                         |
| ------------------------ | -------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `elementLimit`            | `number` | `1024`           | Max focusable elements to tab through.                                                                                                              |
| `screenshotSettleDelay`   | `number` | `33`             | How long to wait (in ms) after each Tab for the page to settle before observing context signals.                                                    |
| `failedElementLimit`      | `number` | `0` (never)      | Finish the audit early once this many elements have failed, leaving the rest unchecked. Useful as a fail-fast signal when you only need to know a page has focus problems, not their full extent. |
| `timeout`                 | `number` | `0` (no timeout) | Limit how long (in ms) the audit runs before returning the results it has gathered so far.                                                          |

## Result shape

`runContextChangeOnFocusAudit` resolves to a `ContextChangeOnFocusResult`:

```ts
type ContextChangeOnFocusResult = {
  /** Every focusable element that was checked, in tab order. */
  elements: Array<{
    selector: string;
    html: string;
    tabIndex: number;
    /** True if any of `findings` has `bucket === "violation"`. */
    failed: boolean;
    /** Every context-change finding observed at this tab stop, if any. */
    findings: Array<{
      kind:
        | "new-window"
        | "auto-submit"
        | "focus-removed"
        | "focus-redirected-outside"
        | "focus-redirected-same-subtree"
        | "url-changed"
        | "navigation";
      bucket: "violation" | "incomplete";
    }>;
  }>;
  summary: {
    checked: number;
    passed: number;
    /** Count of elements whose `failed` is `true`. */
    failed: number;
    /** True if `elementLimit` was hit before tabbing finished. */
    reachedLimit: boolean;
    /** True if the audit stopped early after hitting `failedElementLimit`. */
    reachedFailedElementLimit: boolean;
    /** True if the audit returned early because `timeout` elapsed. */
    timedOut: boolean;
    /**
     * Why the tab session ended, or `null` when this consumer disconnected
     * itself (element limit, failed-element limit, or timeout).
     */
    sessionEnd: "completed" | "lostFocus" | "navigation" | "failed" | null;
  };
};
```

### Findings

[3.2.1 On Focus](https://www.w3.org/WAI/WCAG22/Understanding/on-focus) is a Level A criterion: receiving focus must not, by itself, trigger a change of context. Each tab stop can carry zero or more findings:

- **`new-window`** (`violation`) — focusing the element opened a new window/tab (`window.open`). The audit intercepts the call so no real popup opens.
- **`auto-submit`** (`violation`) — focusing the element submitted a form. The audit prevents the actual submission/navigation.
- **`focus-removed`** (`violation`) — focusing the element caused focus to be removed entirely (no longer on any element).
- **`focus-redirected-outside`** (`violation`) — focusing the element moved focus to a different element outside its own DOM subtree (focus theft).
- **`focus-redirected-same-subtree`** (`incomplete`) — focus moved to a descendant/ancestor of the intended element (e.g. a composite widget delegating focus to an inner control). This is legitimate delegation, not a failure, but is recorded since it changes which element ends up focused.
- **`url-changed`** (`incomplete`) — the URL changed (hash or `pushState`/`replaceState`) without a full navigation. Not necessarily a failure on its own, but worth reviewing.
- **`navigation`** (`violation`) — focusing the element triggered a full page navigation.

`summary.failed` counts only elements with at least one `"violation"`-bucket finding; `"incomplete"` findings do not count as failures.

A full navigation also ends the shared tab session early (`summary.sessionEnd === "navigation"`) once it is detected, since there is no longer a page to keep tabbing through.

## Adaptors

The audit itself is framework-agnostic: it drives a page through an **adaptor**, a small interface of primitives (evaluate JS in the page, press Tab, hit-test the focused element, etc.) that the audit calls without knowing which browser automation library is behind it.

The `BrowserAdaptor` interface lives in [`@a11y-pulse/tab-orchestrator`](../tab-orchestrator), which also ships the bundled `PuppeteerAdaptor`, backed by a Puppeteer `Page`. This package re-exports the type so `runContextChangeOnFocusAudit`'s argument type is available without a separate import. Other environments (Playwright, Selenium, WebDriver) can be supported by implementing the same interface.

Use [`@a11y-pulse/tab-orchestrator`'s `src/adaptors/puppeteer.ts`](../tab-orchestrator/src/adaptors/puppeteer.ts) as a reference implementation.

## Limitations

- **Tab order only.** The audit tabs through elements in native tab order. It does not yet exercise arrow-key composite widgets (menus, comboboxes, toolbars, etc.) where focus moves via `aria-activedescendant` or roving `tabindex` instead of native Tab.
- **Navigation ends the session.** Once a full navigation is detected, the whole shared tab session ends (there is no more original page to tab through), so this audit — and any others sharing the same orchestrator — stop after that stop.
- **Best-effort interception.** `window.open` and form submission are intercepted so the audit does not actually leave the page or open real popups, but unusual navigation mechanisms (e.g. a service worker or extension-driven redirect) may not be caught.

## Releasing

Releases are managed in the [A11y-Pulse/audits](https://github.com/A11y-Pulse/audits) monorepo with [Changesets](https://github.com/changesets/changesets). Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC). There is no long-lived `NPM_TOKEN`.

### Ship a change

1. Open a PR against `main` that includes a changeset (`npx changeset`) naming `@a11y-pulse/context-change-on-focus-audit`.
2. After merge, the Release workflow opens a Version PR. Merging that PR publishes this package to npm and tags `@a11y-pulse/context-change-on-focus-audit@<version>`.

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
