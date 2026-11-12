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
| `timeout` | `number` | `0` (no timeout) | Limit how long (in ms) the tab loop runs, and then how long the escape attempts in `verify` run. Either one cut short by the timeout is inconclusive. |
| `escapeAttemptRounds` | `number` | `2` | How many times to run the whole set of escape attempts before reporting a trap, so a transient state cannot produce a finding on its own. |

## Result shape

```ts
type KeyboardTrapResult = {
  outcome: "no-cycle" | "small-ring" | "escaped" | "trapped" | "inconclusive" | "no-focusable";
  /** Why an `inconclusive` result could not be decided. See below. */
  inconclusiveReason:
    | "stuck-in-frame"
    | "page-edge-only"
    | "ring-sampled"
    | "session-ended"
    | "element-limit"
    | "timed-out"
    | "ring-unresolved"
    | "scattered-ring"
    | "ring-changed"
    | "navigated"
    | null;
  /** The elements focus cycled through, in tab order (at most 10). Empty unless a cycle formed. */
  ring: Array<{ selector: string; html: string }>;
  /** How many elements focus cycled through, including any beyond those listed in `ring`. */
  ringSize: number;
  /**
   * The ring's nearest common ancestor, when a cycle shut out part of the page. For
   * `stuck-in-frame`, the iframe focus never left.
   */
  container: { selector: string; html: string } | null;
  /** The dialog the ring sits in, if any. `buttons` counts its enabled, visible buttons and links. */
  dialog: {
    role: "dialog" | "alertdialog";
    native: boolean;
    modal: boolean;
    buttons: number;
  } | null;
  /** Tabbable elements the cycle never reached, including any a modal dialog or `inert` shuts out. */
  excludedCount: number;
  escapedVia: "escape-key" | "shift-tab" | "arrow-key" | "tab" | null;
  roundsAttempted: number;
  /** Every key the escape attempts pressed, in the order they first pressed them. */
  keysTried: Array<"Tab" | "Shift+Tab" | "Escape" | "ArrowDown" | "ArrowRight">;
  /** What each key did, in the order pressed. */
  attempts: Array<{
    round: number;
    key: "Tab" | "Shift+Tab" | "Escape" | "ArrowDown" | "ArrowRight";
    /** How many times the key was pressed in a row. */
    presses: number;
    /** Opening tag of the ring member focused before the first press. */
    from: string | null;
    /** Opening tag of the element focused after the last press, or `null` when nothing was. */
    landed: string | null;
    /** The key moved focus out of the ring, or dismissed its container. */
    exited: boolean;
    /** Tab and Shift+Tab only: the page cancelled the last press with `preventDefault()`. */
    cancelled?: boolean;
    /** Tab and Shift+Tab only: the key took focus past the edge of the page, to the browser's own interface. */
    pageEdge?: boolean;
  }>;
  /**
   * The ring had more than 32 members, so Tab and Shift+Tab were pressed only either side of its
   * wrap. Such a ring is never `trapped`: when no key leaves it, the outcome is `inconclusive` with
   * `ring-sampled`.
   */
  sampledRing: boolean;
  summary: {
    checked: number;
    passed: number;
    failed: number;
    reachedLimit: boolean;
    reachedFailedElementLimit: boolean;
    timedOut: boolean;
    sessionEnd: "completed" | "lostFocus" | "navigation" | "failed" | "stuck" | "limit" | null;
  };
};
```

### Outcomes

- **`no-cycle`**: tabbing ran off the end of the page. Pass.
- **`small-ring`**: focus cycled, but through every tabbable element on the page, so nothing was shut out. Pass.
- **`escaped`**: focus cycled within part of the page, and a standard exit freed it. `escapedVia` names the exit. Pass.
- **`trapped`**: focus cycled within `container`, every member was tried, and no standard exit freed it in any round. Needs review.
- **`inconclusive`**: the result could not be decided. `inconclusiveReason` says why. Three of the reasons name a `container` and need review; the rest report nothing.
- **`no-focusable`**: nothing on the page took focus.

### Inconclusive reasons

| Reason | Meaning | Needs review |
| --- | --- | --- |
| `stuck-in-frame` | Focus went into an iframe and had not come back out after 256 Tab presses. The frame may hold a trap, or just a very long form. `container` is the iframe. | Yes |
| `page-edge-only` | The only way out of the ring was past the edge of the page to the browser's own interface, and the page pulled focus back into the ring when it came in again at the other end, or the elements outside the ring had gone by then so that could not be checked. The elements it shuts out stay unreachable. | Yes |
| `ring-sampled` | No key left the ring, but it has more than 32 members and only those either side of its wrap were tried, so a way out from the middle of it may exist. `container` is the ring's component. | Yes |
| `session-ended` | The tab loop ended early: lost focus, navigation, or its own limit. | No |
| `element-limit` | The audit stopped itself at `elementLimit`. | No |
| `timed-out` | `timeout` ran out, in the tab loop or during the escape attempts. | No |
| `ring-unresolved` | The cycle's elements could not be found again, or are different elements now. | No |
| `scattered-ring` | The cycle's elements share no ancestor below `<body>`, so it names no component. | No |
| `ring-changed` | The cycle stopped holding focus between escape attempts. | No |
| `navigated` | A key press loaded another document. | No |

### Escape attempts

Each round presses, in order: Escape, Shift+Tab, the arrow keys (each followed by Tab), then Tab. `keysTried` lists the keys that were pressed for this ring, which leaves out Escape for a ring of search fields and the arrows for a ring of form controls. `attempts` records what each did.

- **Tab and Shift+Tab stop early.** A walk ends as soon as focus comes back to a member it has already been on, since the loop is then closed.
- **Large rings are sampled.** A ring of more than 32 members is not walked in full. Tab and Shift+Tab are pressed 16 times each, across the 8 members either side of where the ring wraps round, which is where a focus trap decides whether to let focus go. `sampledRing` says when this happened. A sampled ring that no key leaves is reported as `inconclusive` with `ring-sampled`, never as `trapped`.
- **Escape is not waited on when the page ignores it.** Focus is re-read for up to a second after Escape, in case a dialog closes after an exit animation or a delay. The wait ends after 150ms when the key reached the page uncancelled, the document has not changed, nothing is animating, and no timer of a second or less that the page set while handling the key is still to fire. To see those timers the audit wraps `setTimeout` for the length of that one key event and puts it back straight after.
- **A late close is still Escape's.** If the wait was cut short and the ring's container then disappears within the second Escape is given, Escape gets the credit (`escapedVia: "escape-key"`) and not the Tab, Shift+Tab or arrow key that happened to be pressed in the meantime.
- **The edge of the page is checked.** Tab off the last element of a page, or Shift+Tab off the first, goes to the browser's own interface, and the same key again comes back in at the other end of the page. The audit puts focus there to see whether it stays. If the page pulls it back into the ring, that exit is not counted. The element to focus is looked for again if the page has re-created it since the ring was inspected; if nothing is left outside the ring by then, the exit is not counted either.
- **The edge check is undone.** Focusing that element runs the page's own focus handlers. Afterwards the audit takes focus off it again and gives a form control back the value it held. If focusing it changed the document outside the ring (a search field showing its suggestions, say) and focus is still on it, Escape is pressed once first to close whatever opened, unless it is a field that holds text, which Escape could clear.

## Limitations

- **Load-time state only.** Traps that appear after activating something, such as a modal opened by a button, are not reached.
- **Keys that change values are avoided.** Arrow keys are never pressed on form fields, media players, splitters, scrollbars or anything inside a composite widget, and Escape is pressed from a member that takes no text where there is one, since it clears a search field. A widget whose only exit is one of those keys is reported.
- **Navigation is inconclusive.** A page that loads another document when Escape or Tab is pressed is reported as inconclusive and left on that document, as with any navigation the tab loop triggers.
- **Elements must still be the same.** Members are found again by selector after the tab loop. If a selector now names a different kind of element after a re-render, the result is inconclusive.
- **Iframe content is not inspected.** The tab loop cannot tell the elements inside an iframe apart, so focus that stays in one for 256 Tab presses is reported as `stuck-in-frame` for review whether the frame holds a trap or a form with more than 256 fields. The rest of the page is not reached either way. A real trap inside a frame therefore takes all 256 presses to report, about four seconds in Chromium.
- **Large rings are sampled.** In a ring of more than 32 members, an exit that only works from a member in the middle of the ring is not tried. Such a ring is sent for review as `ring-sampled` whether or not it has one, so a large ring is never reported as `trapped`.
- **Escape is pressed.** On a suspected trap, pressing Escape can legitimately dismiss an overlay, changing the page state afterwards.
- **The edge check can leave something open.** When the only exit from a ring is past the edge of the page, the first or last element outside the ring is given focus by script, which runs its focus handlers. The audit blurs it again and presses Escape if the document changed, but a page that opens something on focus and closes it only on a click, or a text field that already holds text (where Escape is not pressed), is left with it open. An Escape handler there that navigates leaves the page on the new document. Run `verify` after audits that need the page untouched, as the audit runner does.
- **A late close is put down to Escape.** A container that disappears within a second of an Escape the page showed no sign of handling is credited to Escape, even if it was in fact the next key pressed that closed it.
- **One trap per page.** The audit stops at the first cycle. Elements inside open shadow roots are counted like any others; traps inside closed shadow roots are not detected.

## Known false positives

Cases where the audit reports a problem that is not one. Each says which bucket it lands in: `incomplete` asks for a human to check, `violations` claims a failure.

Every finding is `incomplete`: none of these is ever reported as a violation.

- **Dialogs whose only exit is a button.** Enter and Space are never pressed, because activating an unknown widget could be destructive, so a dialog that traps Tab and ignores Escape but has a working close button is reported. Cookie consent dialogs are the usual case. `dialog` says when the ring sits in a dialog and how many buttons it has, so these can be worded differently or ranked lower.
- **Long forms in iframes.** An embedded form or document with more than 256 tab stops is reported as `stuck-in-frame`.
- **Large widgets that wrap Tab.** A grid or picker of more than 32 tab stops that wraps Tab at its ends but lets focus out from somewhere in the middle is reported as `ring-sampled`.
- **Pages that restore focus on purpose.** A page that sends focus back to its one widget whenever focus lands elsewhere, with the widget first or last on the page, is reported as `page-edge-only`.
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
