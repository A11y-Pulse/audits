# @a11y-pulse/skip-link-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/skip-link-audit)](https://www.npmjs.com/package/@a11y-pulse/skip-link-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit that aims to verify the skip-link technique for [**WCAG 2.4.1 Bypass Blocks**](https://www.w3.org/WAI/WCAG22/Understanding/bypass-blocks.html). When a skip link appears in the first few tab stops, it activates the link with Enter and checks that keyboard focus moves to the target or past it. It also reports skip links that are in the document but can never receive focus. It is built to be framework-agnostic and can be used in any environment that allows you to programmatically tab, press Enter, and read the focused element, such as Puppeteer, Playwright, or Selenium.

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
// { found: 1, passed: 1, failed: 0, unreachable: 0 }

console.log(result.skipLinks);
// [
//   {
//     selector: 'a[href="#main"]',
//     html: '<a href="#main">',
//     fragment: "#main",
//     tabIndex: 1,
//     passed: true,
//     failureReason: null,
//     linkText: "Skip to content",
//     target: { selector: "#main", html: '<main id="main" tabindex="-1">', rendered: true },
//     focusAfterEnter: { position: "inside-target", selector: "#main", html: '<main id="main" tabindex="-1">' },
//     focusAfterTab: null
//   }
// ]

await browser.close();
```

See [`examples/puppeteer`](./examples/puppeteer) for a complete, runnable example.

## Browser support

| Adaptor | Browser | Supported |
| --- | --- | --- |
| Puppeteer | Chrome | Yes |
| Playwright | Chromium | Yes |
| Playwright | WebKit | **No.** WebKit does not move focus to links when Tab is pressed, and a skip link is a link, so the audit finds nothing. |
| Playwright | Firefox | Yes |

Verified by this repo's integration suites, which run every audit against each of these engines. Unsupported and partial cases are skipped there with the reason printed alongside them.

## Options

The following options can be passed to `runSkipLinkAudit` as `SkipLinkOptions`:

| Option           | Type     | Default | Description                                                                                          |
| ---------------- | -------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `candidateLimit` | `number` | `3`     | Max tab stops to scan for skip-link candidates. A skip link beyond this limit is not evaluated.      |

## Result shape

`runSkipLinkAudit` resolves to a `SkipLinkResult`:

```ts
type SkipLinkResult = {
  /** Skip links found in the first tab stops. Empty when none were found. */
  skipLinks: Array<{
    selector: string;
    html: string;
    fragment: string;
    tabIndex: number;
    passed: boolean;
    failureReason: "target-missing" | "target-hidden" | "activation-no-effect" | null;
    /** Text of the link, falling back to its aria-label. */
    linkText?: string;
    /** The element the fragment resolves to, or null when nothing matches it. */
    target?: { selector: string; html: string; rendered: boolean } | null;
    /** Where focus was once Enter had been pressed on the link. */
    focusAfterEnter?: SkipLinkFocusLanding;
    /** Where focus was after the follow-up Tab, or null when it was not pressed. */
    focusAfterTab?: SkipLinkFocusLanding | null;
    /** PNG bytes of the focused skip link, clipped and padded. Only captured when it failed. */
    screenshot?: Uint8Array;
  }>;
  /** Skip links that can never be focused. Only looked for when tabbing reached no skip link. */
  unreachable: Array<{
    selector: string;
    html: string;
    fragment: string;
    linkText: string;
    reason: "not-rendered" | "visibility-hidden" | "inert" | "negative-tabindex";
  }>;
  summary: {
    found: number;
    passed: number;
    failed: number;
    unreachable: number;
  };
};

type SkipLinkFocusLanding = {
  position: "inside-target" | "after-target" | "after-link" | "skip-link" | "body" | "elsewhere";
  /** Selector and opening tag of the focused element, or null when nothing was focused. */
  selector: string | null;
  html: string | null;
};
```

When no skip link is found, `skipLinks` and `unreachable` are empty and the summary is zeros. Landmark-only pages are not flagged.

| `failureReason` | Meaning |
| --- | --- |
| `target-missing` | Nothing in the page matches the fragment (an `id`, or an `<a name>`), and activating the link did not move focus to later content. |
| `target-hidden` | The target exists but is not rendered, for example inside a `display: none` container, and activating the link did not focus it. |
| `activation-no-effect` | The target exists, but neither Enter nor the Tab after it put focus in or after the target. `focusAfterEnter` and `focusAfterTab` say where focus went instead. |

## How it works

1. Enable focus reporting so Tab, Enter, and `:focus` behave as they would in a foreground tab.
2. Press Tab up to `candidateLimit` times. After each press, inspect the focused element (descending open shadow roots). The scan stops early on `<body>` or if focus cycles.
3. A focused `<a>` is a skip link when its resolved `href` is a fragment of the current document (`#main`, `/this-page#main` or the absolute URL, but not a bare `#`, `#top` or a hash-router path such as `#/home`) and at least one of these holds:
   - its text or `aria-label` uses skip wording: "skip", or a "go to" verb followed by a content or navigation noun ("Jump to content", "Aller au contenu", "Ga naar inhoud", and equivalents in a handful of other languages). Matching is on whole words, so "Popular posts" and "Aller au panier" are not skip wording;
   - its `class` or `id` is a skip token such as `skip`, `skip-link` or `skip-to-content`;
   - its target comes after the link, is rendered, is not a navigation block, and is the page's main content: a heading, the `main` landmark, a wrapper around it or something inside it, or, on a page with no `main` landmark, an element with a conventional id such as `content` or `main-content`.

   Skipping past other tab stops is not enough on its own: a "Menu" link to a navigation block further down the page does that too, and following it would open the menu.

   Links with `aria-expanded`, `role="tab"` or `role="button"` are never skip links: they are disclosure triggers, tabs and buttons, and the audit must not activate them.
4. For each skip link: record the URL and scroll position, re-focus the link, press Enter, and poll for up to 250ms. It passes if focus is now in the target or after it. A link whose fragment matches nothing is activated too, and passes if a script moved focus to content after the link.
5. If focus did not visibly move and the target is rendered, press Tab once. Browsers move the sequential focus navigation starting point on fragment navigation even when the target is not focusable, so the link passes if the newly focused element is inside the target, or follows it in document order and the fragment was actually followed. That covers targets with nothing focusable inside, such as `<h1 id="title">` or an empty `<a id="content"></a>`. Otherwise record `activation-no-effect`.
6. Undo each activation: go back in history when following the link added an entry, which restores the URL and clears `:target`, or rewrite the URL in place when it did not, then put the scroll position back. When the audit finishes, including when it throws, drop focus and move the point Tab starts from back to the top of the document, so whatever runs next sees the page as it was loaded and tabs from its first stop.
7. If tabbing reached no skip link, look through the first links in the document for one whose text or `aria-label` has skip wording and that can never be focused (`display: none`, `visibility: hidden`, inert, or a negative `tabindex`) and report it under `unreachable`.

Activation uses a real Enter keypress rather than a synthetic click, so the keyboard path is the one being checked.

A failed skip link is focused again and screenshotted, so a link that only appears on focus is visible in the evidence.

## Adaptors

The audit itself is framework-agnostic: it drives a page through an **adaptor**, a small interface of primitives (evaluate JS in the page, press Tab, press Enter, take a screenshot) that the audit calls without knowing which browser automation library is behind it.

[`@a11y-pulse/browser-adaptor`](../browser-adaptor) ships two implementations, `PuppeteerAdaptor` and `PlaywrightAdaptor`. Other environments (Selenium, WebDriver) can be supported by implementing the same interface, exported as `SkipLinkAuditAdaptor` (aliased as `BrowserAdaptor` from the package root).

### `SkipLinkAuditAdaptor` / `BrowserAdaptor`

| Method                   | Description                                                                                                                                         |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evaluate(fn, ...args)`  | Runs `fn` in the page context, passing in any serialisable `args`, and returns its result.                                                          |
| `evaluateHandle(fn)`     | Runs `fn` in the page context and returns an opaque `ElementRef` handle to the `Element` it returns, without serialising it.                        |
| `disposeRef(ref)`        | Releases a handle previously returned by `evaluateHandle`.                                                                                           |
| `pressTab()`             | Presses the Tab key, advancing focus to the next focusable element.                                                                                  |
| `pressEnter()`           | Presses the Enter key, activating the focused element.                                                                                               |
| `screenshotClip(clip, scale?)` | Screenshots the `clip` region of the page, in document coordinates, at `scale` bitmap pixels per CSS pixel, and returns PNG bytes. |
| `screenshotClipScale`    | Optional. The scale for evidence screenshots. Defaults to 1.                                                                                         |
| `ensureFocusReporting()` | Ensures the page reports focus for its lifetime, in particular that `document.hasFocus()` works and `:focus` styles apply even when the page is not the foreground tab/window. Must not throw. |

### Writing a new adaptor

Implement `SkipLinkAuditAdaptor` from `@a11y-pulse/skip-link-audit` (or its `BrowserAdaptor` alias) against your automation library's page/session object, then pass an instance to `runSkipLinkAudit`:

```ts
import type { SkipLinkAuditAdaptor } from "@a11y-pulse/skip-link-audit";

class MyFrameworkAdaptor implements SkipLinkAuditAdaptor {
  // ...implement evaluate, evaluateHandle, disposeRef, pressTab,
  // pressEnter, screenshotClip, and ensureFocusReporting for your framework
}
```

Use [`@a11y-pulse/browser-adaptor`'s `src/adaptors/puppeteer.ts`](../browser-adaptor/src/adaptors/puppeteer.ts) as a reference implementation. It is a small, self-contained example of every method the audit needs.

## Limitations

- **Chromium focus emulation.** Accurate `:focus` / `document.hasFocus()` reporting for a backgrounded page relies on Chromium's CDP focus emulation (used by `PuppeteerAdaptor.ensureFocusReporting`). Other browser engines may not offer an equivalent, and results may be less reliable if the page genuinely loses focus during the audit.
- **First tab stops only.** Skip links beyond `candidateLimit` (default 3) are not detected. The audit stays silent, which never flags a conformant page.
- **Links only.** Button-based skip controls are out of scope. A script-driven skip link is checked as long as it is an `<a>` with a fragment `href`.
- **Skip wording is a short multilingual list.** A skip link whose target is missing, is a navigation block, or is not the page's main content is only recognised by its wording or a skip class or id. One in a language the list does not cover, pointing at a `<div>` with an unconventional id on a page with no `main` landmark, is not evaluated, which never flags a conformant page.
- **Changes made by activation are not all undone.** The URL, `:target`, scroll position, focus and tab starting point are restored, but anything else a page does when its skip link is activated stays done. The history entry that following a fragment link adds cannot be removed: the page is returned to the entry it was on, and the added one remains as a forward entry, so `history.length` stays one higher. A page whose URL changed without a new history entry has its URL rewritten in place, and `:target` then keeps pointing at the skip target.
- **A leftover node on positive-tabindex pages.** Where a page uses a positive `tabindex`, resetting the tab starting point leaves an empty, `aria-hidden` `<span data-a11y-pulse-skip-link-focus-start>` in front of the first element in the tab order. It removes itself the next time anything is focused.
- **Closed shadow roots** are opaque; a skip link inside one is invisible to the scan.
- **Landmarks and headings** that satisfy 2.4.1 without a skip link are out of scope by design.

## Known false positives

Cases where the audit reports a problem that is not one. Each says which bucket it lands in: `incomplete` asks for a human to check, `violations` claims a failure.

- **Skip links hidden at this viewport** (`violations`). A skip link that is `display: none` at the audited viewport size and shown at another is reported as unreachable.
- **Skip links that move focus slowly** (`violations`). The audit waits 250ms (`activationPollMs`) for focus to arrive. A skip link that only moves focus after a longer smooth-scroll animation is reported as having no effect.

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
