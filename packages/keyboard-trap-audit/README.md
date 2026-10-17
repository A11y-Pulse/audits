# @a11y-pulse/keyboard-trap-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/keyboard-trap-audit)](https://www.npmjs.com/package/@a11y-pulse/keyboard-trap-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit that aims to verify compliance with [**WCAG 2.2: 2.1.2 No Keyboard Trap**](https://www.w3.org/WAI/WCAG22/Understanding/no-keyboard-trap). It tabs through a page's focusable elements and watches for focus cycling within part of the page. When it does, the audit tries the standard keyboard exits (Escape, Shift+Tab, arrow keys, and Tab again) over several rounds, and only reports a trap if none of them frees focus. It is built to be framework-agnostic and can be used in any environment that allows you to press keys and evaluate scripts in the page, such as Puppeteer, Playwright, or Selenium.

A modal dialog that keeps Tab inside itself is correct behaviour as long as Escape closes it, so confinement alone is never reported. Even a confirmed trap needs a human to review it, because WCAG allows a non-standard exit key as long as users are told about it.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/keyboard-trap-audit @a11y-pulse/tab-orchestrator @a11y-pulse/browser-adaptor puppeteer
```

## Quickstart

```js
import { runKeyboardTrapAudit } from "@a11y-pulse/keyboard-trap-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const result = await runKeyboardTrapAudit(new PuppeteerAdaptor(page));

console.log(result.outcome);
// 'trapped'

console.log(result.container);
// { selector: '#editor', html: '<div id="editor" class="code-editor">' }

await browser.close();
```

## Shared tab session

`runKeyboardTrapAudit` builds a private `@a11y-pulse/tab-orchestrator` session. If you run other tab-driven audits against the same page, attach this audit to a shared orchestrator instead so the page is only tabbed through once, then call `verify` once the session has run:

```ts
import { createTabOrchestrator } from "@a11y-pulse/tab-orchestrator";
import { createKeyboardTrapAudit } from "@a11y-pulse/keyboard-trap-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";

const adaptor = new PuppeteerAdaptor(page);
const orchestrator = createTabOrchestrator(adaptor);

const keyboardTrap = createKeyboardTrapAudit();
orchestrator.attach(keyboardTrap);

await orchestrator.run();

const result = await keyboardTrap.verify(adaptor);
```

Call `verify` once `run()` has finished. It can change the page, because pressing Escape can dismiss an overlay, so run anything that only reads the page first. The audit declares no capabilities, so it adds nothing to the cost of each tab stop.

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
| `elementLimit` | `number` | `1024` | Max focusable elements to tab through. A session cut short by this limit is inconclusive. |
| `screenshotSettleDelay` | `number` | `33` | How long to wait (in ms) after each key press for the page to settle. |
| `timeout` | `number` | `0` (no timeout) | Limit how long (in ms) the tab loop runs. A session cut short by the timeout is inconclusive. |
| `escapeAttemptRounds` | `number` | `2` | How many times to run the whole set of escape attempts before reporting a trap, so a transient state cannot produce a finding on its own. |

## Result shape

```ts
type KeyboardTrapResult = {
  outcome: "no-cycle" | "small-ring" | "escaped" | "trapped" | "inconclusive" | "no-focusable";
  /** The elements focus cycled through, in tab order (at most 10). Empty unless a cycle formed. */
  ring: Array<{ selector: string; html: string }>;
  /** How many elements focus cycled through, including any beyond those listed in `ring`. */
  ringSize: number;
  /** The ring's nearest common ancestor, when a cycle shut out part of the page. */
  container: { selector: string; html: string } | null;
  /** Tabbable elements the cycle never reached, including any a modal dialog or `inert` shuts out. */
  excludedCount: number;
  escapedVia: "escape-key" | "shift-tab" | "arrow-key" | "tab" | null;
  roundsAttempted: number;
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

### Outcomes

- **`no-cycle`**: tabbing ran off the end of the page. Pass.
- **`small-ring`**: focus cycled, but through every tabbable element on the page, so nothing was shut out. Pass.
- **`escaped`**: focus cycled within part of the page, and a standard exit freed it. `escapedVia` names the exit. Pass.
- **`trapped`**: focus cycled within `container` and no standard exit freed it in any round. Needs review.
- **`inconclusive`**: the session ended early (limit, timeout, lost focus, navigation, focus stuck in an iframe), the cycle was scattered across the whole document, or the page changed between escape attempts. Nothing is reported.
- **`no-focusable`**: nothing on the page took focus.

## Limitations

- **Load-time state only.** Traps that appear after activating something, such as a modal opened by a button, are not reached.
- **Keys that change values are avoided.** Arrow keys are never pressed on form fields, media players, splitters, scrollbars or anything inside a composite widget, and Escape is pressed from a member that takes no text where there is one, since it clears a search field. A widget whose only exit is one of those keys is reported.
- **Navigation is inconclusive.** A page that loads another document when Escape or Tab is pressed is reported as inconclusive and left on that document, as with any navigation the tab loop triggers.
- **Elements must still be the same.** Members are found again by selector after the tab loop. If a selector now names a different kind of element (inside an open shadow root, or after a re-render), the result is inconclusive.
- **Escape is pressed.** On a suspected trap, pressing Escape can legitimately dismiss an overlay, changing the page state afterwards.
- **One trap per page.** The audit stops at the first cycle. Traps inside closed shadow roots or cross-origin iframes are not detected.

## Known false positives

Cases where the audit reports a problem that is not one. Each says which bucket it lands in: `incomplete` asks for a human to check, `violations` claims a failure.

Every finding is `incomplete`: none of these is ever reported as a violation.

- **Dialogs whose only exit is a button.** Enter and Space are never pressed, because activating an unknown widget could be destructive, so a dialog that traps Tab and ignores Escape but has a working close button is reported.
- **Widgets that tell users how to leave.** WCAG allows a non-standard exit key as long as users are told about it, which the audit cannot read. A code editor that keeps Tab for indentation and documents another way out is still reported.

## Releasing

Releases are managed in the [A11y-Pulse/audits](https://github.com/A11y-Pulse/audits) monorepo with [Changesets](https://github.com/changesets/changesets). Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC). There is no long-lived `NPM_TOKEN`.

### Ship a change

1. Open a PR against `main` that includes a changeset (`npx changeset`) naming `@a11y-pulse/keyboard-trap-audit`.
2. After merge, the Release workflow opens a Version PR. Merging that PR publishes this package to npm and tags `@a11y-pulse/keyboard-trap-audit@<version>`.

Trusted Publisher on npm must stay configured for:

| Field | Value |
| --- | --- |
| Organization or user | `A11y-Pulse` |
| Repository | `audits` |
| Workflow filename | `release.yml` |

## License

Released under the [PolyForm Shield License 1.0.0](./LICENSE.md), in plain language:

- **Source-available.** The source is public and you can read, fork, and modify it.
- **Permitted for non-competing use.** You can use this package freely in your own products and services, as long as they don't compete with A11y Pulse.
- **Competing products are forbidden.** You may not use this software (or a modified version of it) to build a product or service that competes with A11y Pulse's accessibility monitoring offering.

See [LICENSE.md](./LICENSE.md) for the full, binding terms.
