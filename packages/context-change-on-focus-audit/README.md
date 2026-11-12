# @a11y-pulse/context-change-on-focus-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/context-change-on-focus-audit)](https://www.npmjs.com/package/@a11y-pulse/context-change-on-focus-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit that aims to verify compliance with [**WCAG 2.2: 3.2.1 On Focus**](https://www.w3.org/WAI/WCAG22/Understanding/on-focus). It tabs through a page's focusable elements and detects whether merely receiving focus triggers a context change: a new window/tab, an auto-submitted form, a navigation, a native dialog, focus being silently removed, or focus being redirected somewhere outside the element's own subtree. Each finding is reported against the element that caused it, with the evidence to act on it: the URL opened or navigated to, the form submitted, the URLs before and after, where focus went. It is built to be framework-agnostic and can be used in any environment that allows you to programmatically focus elements and observe the page, such as Puppeteer, Playwright, or Selenium.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/context-change-on-focus-audit @a11y-pulse/tab-orchestrator @a11y-pulse/browser-adaptor puppeteer
```

`@a11y-pulse/tab-orchestrator` drives the page (tabbing, markers, context-change observation), and [`@a11y-pulse/browser-adaptor`](../browser-adaptor) ships the bundled [Puppeteer and Playwright adaptors](#adaptors); `puppeteer` and `playwright-core` are optional peers of that package, each only required if you use the matching adaptor. Other frameworks can supply their own adaptor without installing either.

## Quickstart

```js
import { runContextChangeOnFocusAudit } from "@a11y-pulse/context-change-on-focus-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
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
//     findings: [{ kind: 'new-window', bucket: 'violation', url: '/offers' }],
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
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";

const orchestrator = createTabOrchestrator(new PuppeteerAdaptor(page));

const contextChange = createContextChangeOnFocusAudit({ elementLimit: 50 });
orchestrator.attach(contextChange);

await orchestrator.run();

console.log(contextChange.result);
```

`contextChange.result` is only complete once `contextChange` has disconnected (by hitting one of its own limits) or the session has ended. Reading it before then is undefined. See [`@a11y-pulse/tab-orchestrator`](../tab-orchestrator) for the full session lifecycle and capability model. This audit declares the `"contextSignals"` and `"screenshot"` capabilities: it does not need `obscuring`, `unfocusedPair`, or `baselineStyles`, so it can run alongside the other audits on the same orchestrator without paying for their measurements.

While the session runs, the `contextSignals` observer stubs `window.open` and `form.submit()`, cancels form submissions, and, in browsers with the [Navigation API](https://developer.mozilla.org/docs/Web/API/Navigation_API), cancels navigations the page starts by script. That is what lets every other consumer on the same orchestrator carry on past an element that would otherwise have taken the page away. All of it is put back when the session ends.

**Every script-initiated navigation is blocked for the length of the session, whoever started it.** That includes ones that have nothing to do with focus, such as a session-expiry redirect or a refresh timer that happens to come due during the pass: the page stays where it is, the redirect does not happen later, and the attempt is reported under `unattributed` (below) instead of against an element. If the page you are auditing relies on such a redirect, expect it to be listed there.

In a browser without the Navigation API a navigation on focus goes ahead and ends the whole shared session (`summary.sessionEnd === "navigation"`), so any other consumers attached to the same orchestrator also stop receiving tab stops. This is a property of the shared session, not something this audit can opt out of.

## Browser support

| Adaptor | Browser | Supported |
| --- | --- | --- |
| Puppeteer | Chrome | Yes |
| Playwright | Chromium | Yes |
| Playwright | WebKit | **No.** WebKit does not move focus to links when Tab is pressed, so the audit only reaches a subset of the page. |
| Playwright | Firefox | Yes |

Verified by this repo's integration suites, which run every audit against each of these engines. Unsupported and partial cases are skipped there with the reason printed alongside them.

## Options

The following options can be passed to `runContextChangeOnFocusAudit` as `ContextChangeOnFocusOptions`:

| Option                  | Type     | Default         | Description                                                                                                                                         |
| ------------------------ | -------- | --------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `elementLimit`            | `number` | `1024`           | Max focusable elements to tab through.                                                                                                              |
| `screenshotSettleDelay`   | `number` | `33`             | How long to wait (in ms) after each Tab for the page to settle before observing context signals.                                                    |
| `failedElementLimit`      | `number` | `0` (never)      | Finish the audit early once this many elements have failed, leaving the rest unchecked. Useful as a fail-fast signal when you only need to know a page has focus problems, not their full extent. |
| `timeout`                 | `number` | `0` (no timeout) | Limit how long (in ms) the audit runs before returning the results it has gathered so far.                                                          |
| `screenshotLimit`         | `number` | `10`             | Max elements with findings to screenshot. Each is a real page screenshot, so this bounds the cost on a page with many findings.                     |

## Result shape

`runContextChangeOnFocusAudit` resolves to a `ContextChangeOnFocusResult`:

```ts
type ContextChangeOnFocusResult = {
  /** Every focusable element that was checked, in tab order. */
  elements: Array<{
    /**
     * The element the findings are about. When focus was removed or
     * redirected, this is the element that received focus and gave it away,
     * not the one focus ended up on.
     */
    selector: string;
    html: string;
    tabIndex: number;
    /** True if any of `findings` has `bucket === "violation"`. */
    failed: boolean;
    /** Every context-change finding observed for this element, if any. */
    findings: Array<{
      kind:
        | "new-window"
        | "auto-submit"
        | "focus-removed"
        | "focus-redirected-outside"
        | "focus-redirected-same-subtree"
        | "url-changed"
        | "navigation"
        | "dialog";
      bucket: "violation" | "incomplete";
      /** `new-window`: the URL passed to `window.open`. `navigation`: where the page tried to go. */
      url?: string;
      /** `url-changed`: the address before and after. */
      from?: string;
      to?: string;
      /** `auto-submit`: the form that was submitted. */
      form?: { selector: string | null; html: string; action: string };
      /** `focus-redirected-*`: where focus ended up. */
      redirectedTo?: { selector: string; html: string };
      /** The change came from a timer the element set, after focus had moved on. */
      delayed?: boolean;
    }>;
    /**
     * PNG bytes of the element, clipped and padded. Only captured for an
     * element with findings, never after a navigation that went ahead, and
     * omitted past `screenshotLimit`.
     */
    screenshot?: Uint8Array;
  }>;
  /**
   * Present when the page navigated on focus and the element responsible
   * could not be read before its document was gone (browsers without the
   * Navigation API). `after` is the last element checked: the one that
   * navigated is next in the tab order. A violation no entry in `elements`
   * carries.
   */
  navigation?: {
    after: { selector: string; html: string } | null;
    url: string | null;
  };
  /**
   * Changes of context the page made during the pass that no focused element
   * can be shown to have caused (a timed redirect, a background script
   * opening a window, a dialog raised on a schedule). Findings of the same
   * shape as an element's, always `bucket: "incomplete"`, each kind and URL
   * listed once. Absent when there were none.
   */
  unattributed?: Array<{ kind: string; bucket: "incomplete"; url?: string; from?: string; to?: string }>;
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
    sessionEnd: "completed" | "lostFocus" | "navigation" | "failed" | "stuck" | "limit" | null;
  };
};
```

### Findings

[3.2.1 On Focus](https://www.w3.org/WAI/WCAG22/Understanding/on-focus) is a Level A criterion: receiving focus must not, by itself, trigger a change of context. Each element can carry zero or more findings:

- **`new-window`** (`violation`): focusing the element opened a new window/tab (`window.open`). The audit intercepts the call so no real popup opens. `url` is what it was asked to open.
- **`auto-submit`** (`violation`): focusing the element submitted a form, through a submit event or `form.submit()`. The audit prevents the actual submission/navigation. `form` names the form and its action.
- **`focus-removed`** (`violation`): focusing the element caused focus to be removed entirely (no longer on any element).
- **`focus-redirected-outside`** (`violation`): focusing the element moved focus to a different element outside its own DOM subtree (focus theft). The finding is on the element that took focus and passed it on; `redirectedTo` is where it went. The element focus went to is not reported for it.
- **`focus-redirected-same-subtree`** (`incomplete`): focus moved to a descendant/ancestor of the intended element (e.g. a composite widget delegating focus to an inner control). This is legitimate delegation, not a failure, but is recorded since it changes which element ends up focused.
- **`url-changed`** (`incomplete`): the URL changed (hash or `pushState`/`replaceState`) without a full navigation, from `from` to `to`. Not necessarily a failure on its own, but worth reviewing. It is reported once, on the element that changed it; a `replaceState` that leaves the URL as it is (scroll restoration, router state) is not a change.
- **`navigation`** (`violation`): focusing the element sent the page to another document. Where the browser has the Navigation API (Chromium, and current Firefox and Safari) the audit cancels the navigation, reports `url`, and carries on with the rest of the page.
- **`dialog`** (`violation`): focusing the element raised a native `alert`, `confirm` or `prompt`. The adaptor dismisses it.

`summary.failed` counts only elements with at least one `"violation"`-bucket finding; `"incomplete"` findings do not count as failures.

**A change is put down to an element only when there is evidence the element caused it.** That means it happened while the element's own focus event was being handled, or inside a `setTimeout` of up to one second that was set then (or set from such a timer). Anything else the page does during the pass is not blamed on whichever element happens to be focused: a redirect or window from a timer the page set as it loaded, a poll loop that re-arms itself, a dialog raised on a schedule. Those are collected under the result's top-level `unattributed`, as `incomplete` findings for a person to look at, and are still blocked like any other.

**Focus guards are not findings.** Dialog libraries put a focusable element at each edge of a modal whose only job is to catch focus and hand it to a control inside. An element is treated as one, and reported as nothing, when either:

- it is marked as a guard: `data-focus-guard` (react-focus-lock), `data-radix-focus-guard` (Radix), `data-floating-ui-focus-guard` (Floating UI), `data-headlessui-focus-guard` (Headless UI), `data-testid="sentinelStart"` / `"sentinelEnd"` (MUI), the `cdk-focus-trap-anchor` class (Angular CDK), or `aria-hidden="true"`; or
- it has no content, no accessible name, no role and no native behaviour, **and** the element it sends focus to is inside a `dialog`, `[role="dialog"]`, `[role="alertdialog"]` or `[aria-modal="true"]` container that the guard sits in or directly beside.

An empty, unnamed element that throws focus somewhere with no dialog involved is not a guard: it is reported as `focus-redirected-outside`, even when the element it sends focus to has already been visited.

**Changes on a short timer.** A focus handler that defers its work with `setTimeout` (up to one second) still has that work put down to its own element: if focus has already moved on by the time the timer fires, the finding is added to the earlier element with `delayed: true` rather than to whichever element is focused by then. When the tab order runs out, the session waits (up to one second) for any such timers still pending, so what the last elements deferred is reported too and does not happen to the page after the audit has finished with it.

**A navigation that cannot be cancelled** (a browser without the Navigation API, or a history traversal) goes ahead and ends the tab session (`summary.sessionEnd === "navigation"`), since there is no longer a page to keep tabbing through. The document is gone before the element responsible can be read from it, so the result carries a top-level `navigation` instead: the element focus was on before that Tab press (`after`) and where the page went (`url`). Treat it as a violation by the next element in the tab order.

## Adaptors

The audit itself is framework-agnostic: it drives a page through an **adaptor**, a small interface of primitives (evaluate JS in the page, press Tab, hit-test the focused element, etc.) that the audit calls without knowing which browser automation library is behind it.

The `BrowserAdaptor` interface lives in [`@a11y-pulse/browser-adaptor`](../browser-adaptor), which also ships the bundled `PuppeteerAdaptor` and `PlaywrightAdaptor`. This package re-exports the type so `runContextChangeOnFocusAudit`'s argument type is available without a separate import. Other environments (Selenium, WebDriver) can be supported by implementing the same interface.

Use [`@a11y-pulse/browser-adaptor`'s `src/adaptors/puppeteer.ts`](../browser-adaptor/src/adaptors/puppeteer.ts) as a reference implementation.

## Limitations

- **Tab order only.** The audit tabs through elements in native tab order. It does not yet exercise arrow-key composite widgets (menus, comboboxes, toolbars, etc.) where focus moves via `aria-activedescendant` or roving `tabindex` instead of native Tab.
- **A navigation that cannot be cancelled ends the session.** Without the Navigation API, or for a history traversal, the navigation goes ahead and the whole shared tab session ends (there is no more original page to tab through), so this audit (and any others sharing the same orchestrator) stops there, and the element responsible is only known as "the one after `navigation.after`".
- **Slow or indirect changes are not traced to their element.** Only work done in the focus handler itself, or in a `setTimeout` of up to one second set there, is traced back to the element. A change a focus handler makes after a longer delay, from a `setInterval` or `requestAnimationFrame`, after a network request resolves, or from a `blur` handler as focus leaves, is reported under `unattributed` for review instead of against the element, and one that comes more than a second after the last tab stop is not seen at all.
- **The page's own redirects are blocked during the pass.** A script-initiated navigation is cancelled whether or not focus caused it (see [Shared tab session](#shared-tab-session)), so a page that would have signed the user out or refreshed itself during the pass does not.
- **Dialogs the page cannot be seen to raise.** A native dialog is attributed by watching `alert`, `confirm` and `prompt` in the top document. One raised from inside a frame, or through a reference to `alert` the page saved before the session, is reported under `unattributed`.
- **URL changes inside iframes and native controls are missed.** A soft URL change made while focus is inside an iframe, or moving between the parts of a media player or date input, is not reported.
- **Best-effort interception.** `window.open` and form submission are intercepted so the audit does not actually leave the page or open real popups, but unusual navigation mechanisms (e.g. a service worker or extension-driven redirect) may not be caught.

## Known false positives

Cases where the audit reports a problem that is not one. Each says which bucket it lands in: `incomplete` asks for a human to check, `violations` claims a failure.

- **Changes the page makes on its own timer** (`incomplete`, under `unattributed`). A chat widget that opens a window, a session-timeout prompt, or a redirect the page had already scheduled is not reported against any element, but it is still listed for review, since the audit cannot tell that it has nothing to do with focus.
- **Focus the page moves on its own timer** (`violations`). Focus moving is judged by where it is once a tab stop has settled, so a carousel or timeout prompt that pulls focus away from the element just tabbed to, in the moment after it took focus, is reported as that element's `focus-redirected-outside`.
- **An unmarked focus sentinel outside a dialog** (`violations`). An unmarked guard is only recognised by where it sends focus: into a dialog it sits in or beside. A hand-rolled focus trap around something that is not marked up as a dialog, using sentinels with none of the recognised markers, is reported as `focus-redirected-outside`. So is an unmarked sentinel that carries text or an `aria-label`.
- **Focus delegated within a widget** (`incomplete`). A wrapper that forwards focus to its own inner control, or a composite widget that moves focus among its items, is a correct pattern. Focus moving within the element's own subtree is reported for review, never as a violation.
- **Soft URL changes on focus** (`incomplete`). A `pushState` or hash change on focus is suspicious but may not change what the page means, so it is reported for review.

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
