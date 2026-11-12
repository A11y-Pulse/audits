# @a11y-pulse/unreachable-controls-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/unreachable-controls-audit)](https://www.npmjs.com/package/@a11y-pulse/unreachable-controls-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit for [**WCAG 2.2: 2.1.1 Keyboard**](https://www.w3.org/WAI/WCAG22/Understanding/keyboard) and [**4.1.2 Name, Role, Value**](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value). It tabs through a page, then scans it for two things:

- **Controls the keyboard never reaches:** elements that handle clicks or have a widget role, but are not in the tab order and have nothing focusable in or around them. A `<div>` with a click listener and no `tabindex` is the usual case.
- **Focusable controls with no role:** elements that did take focus and handle clicks or key presses, but expose no role, so a screen reader announces them as plain text.

It is built to be framework-agnostic and can be used in any environment that allows you to programmatically focus elements and observe the page, such as Puppeteer, Playwright, or Selenium. In Chromium it also asks the browser which event listeners each element has, which is the only way to see a control wired up with `addEventListener`.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/unreachable-controls-audit @a11y-pulse/tab-orchestrator @a11y-pulse/browser-adaptor puppeteer
```

## Quickstart

```js
import { runUnreachableControlsAudit } from "@a11y-pulse/unreachable-controls-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/unreachable-controls-audit/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch({ defaultViewport: { width: 1280, height: 800 } });
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const result = await runUnreachableControlsAudit(new PuppeteerAdaptor(page));

console.log(result.outcome);
// 'findings'

console.log(result.unreachable[0]);
// { selector: '#card-1', verdict: 'failed', reason: 'click-handler', signals: { listeners: ['click'], ... }, ... }

await browser.close();
```

For Playwright, import `PlaywrightAdaptor` from `@a11y-pulse/unreachable-controls-audit/playwright`.

## Shared tab session

To run alongside other tab-driven audits on one tab loop, attach the consumer to a shared orchestrator and call `analyse` once the session has run:

```ts
import { createTabOrchestrator } from "@a11y-pulse/tab-orchestrator";
import { createUnreachableControlsAudit } from "@a11y-pulse/unreachable-controls-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/unreachable-controls-audit/puppeteer";

const adaptor = new PuppeteerAdaptor(page);
const orchestrator = createTabOrchestrator(adaptor);

const unreachableControls = createUnreachableControlsAudit();
orchestrator.attach(unreachableControls);

const startHref = await page.url();
await orchestrator.run();

const result = await unreachableControls.analyse(adaptor, startHref);
```

The audit declares no capabilities, so it adds nothing to each tab stop: it only notes which element took focus. `analyse` then makes one call into the page to collect candidates, one round of browser inspection where the adaptor supports it, and two short calls per finding for its selector. Call `analyse` before anything else changes the page (activates a control, resizes the viewport), and pass it the page's URL from before the session so that a navigation the session did not notice makes the result inconclusive.

If you already have an adaptor of your own, give it an `inspectElements` method using the helper each adaptor module exports:

```ts
import { inspectElements } from "@a11y-pulse/unreachable-controls-audit/puppeteer";

const adaptor = Object.assign(existingAdaptor, {
  inspectElements: (stashKey, count, roles) => inspectElements(page, stashKey, count, roles),
});
```

## How it decides

### Controls the keyboard never reaches

An element is a candidate when it is rendered, is not itself in the tab order, and has nothing focusable inside it or around it. Among candidates:

| Evidence | Verdict | `reason` |
| --- | --- | --- |
| A widget role (`button`, `link`, `checkbox`, `switch`, `radio`, `tab`, `menuitem`, `option`, `slider`, `textbox`, `combobox`, `treeitem`...) | failed | `widget-role` |
| Handles `click` or `dblclick` (an `onclick` attribute or property, or a listener the browser reported) | failed | `click-handler` |
| A `<label>` whose form control is not drawn (it, or anything around it, is `display: none` or `visibility: hidden`) and has no focusable stand-in, so only clicking the label can change it | failed | `hidden-control-label` |
| Handles `click`, but holds more than ten elements or covers more than 30% of the viewport, and shows no pointer cursor | review | `container-handler` |
| Handles `click` only through a listener that at least half of the page's unreached elements also carry (20 or more elements examined), with no `onclick` and no pointer cursor of its own. At most five are listed | review | `blanket-listener` |
| A control with `tabindex="-1"` that is not part of a widget that manages focus | review | `script-focus-only` |
| Handles pointer or touch presses (`mousedown`, `pointerdown`, `touchstart`...) but not `click` | review | `press-handler` |
| Nothing but a pointer cursor set on this element | review | `pointer-cursor` |

These are left alone:

- **Anything around something focusable.** A card with a click listener and a link inside it, a table row that opens the record its first cell links to, and a listener delegated to a wrapper, `<body>` or `document` all hold a tab stop, so they are a convenience and not a control of their own.
- **Anything inside something focusable**, such as an icon with a handler inside a button.
- **Framework roots and portal containers.** An element listening for ten or more event types, at least three of which no single control listens for (`submit`, `change`, `input`, `paste`, `load`...), carries a framework's delegated event set: React attaches every event it supports to its root and to each portal container. Such an element is not reported unless it also has a widget role or an `onclick` of its own.
- **Labels of focusable controls**, and labels of a hidden control that a focusable widget stands in for: one named by the same label through `aria-labelledby`, or one right beside the hidden control (the way Chosen and Select2 replace a `<select>`). Beside a hidden checkbox or radio button, only a neighbour with the role `checkbox`, `switch`, `radio` or `button` counts.
- **Children of a composite widget that manages focus itself.** Inside a `tablist`, `menu`, `menubar`, `listbox`, `grid`, `treegrid`, `radiogroup`, `toolbar`, `tree` or `combobox`, one element takes the tab stop and arrow keys move among the rest. The widget counts as managed when it or one of its descendants is in the tab order, when it has `aria-activedescendant`, or when a focusable element points at it with `aria-controls`, `aria-owns` or `aria-activedescendant`. Children of a composite that nothing can focus are reported.
- **Roving tab stops without a composite role:** a `tabindex="-1"` element beside a tabbable element with the same tag and role.
- **Hidden, `aria-hidden`, `inert` and disabled content**, and native controls taken out of the tab order with `tabindex="-1"`.
- **Backdrops:** an element with no text or graphics that covers more than 30% of the viewport, which a dialog's close button duplicates.

A review of an element that contains, or sits inside, a failed control is dropped as saying nothing new.

### Focusable controls with no role

For each element that took focus during the tab pass and is not a native control:

| Evidence | Verdict | `reason` |
| --- | --- | --- |
| Handles `click` or key presses, with no `role` (or `presentation`, `none`, `generic`) | failed | `handler-without-role` |
| The same on a custom element, when the browser could not be asked what role it exposes | review | `custom-element` |
| No handler found, but a pointer cursor | review | `pointer-cursor` |
| Handles `click` or key presses but holds other tab stops (a scrolling region made focusable, whose listeners serve the buttons inside), or carries a framework's delegated event set | review | `container-handler` |
| Handles only `click`, through a listener most elements on the page also carry | review | `blanket-listener` |

An element with any other `role` attribute is passed, as is one the browser exposes with a control's role (a custom element that sets its role through `ElementInternals`). A focusable element with no handler and no pointer cursor, such as a scrollable region given `tabindex="0"`, is not reported.

### When the tab pass stops early

If the session ends for any reason other than reaching the end of the tab order (`limit`, `stuck`, `lostFocus`, `navigation`, `failed`), or the audit's own `elementLimit` or `timeout` cuts it short, the result is `inconclusive` and nothing is reported: the pass has not shown what Tab reaches, and may have left the page in another state.

## Browser support

| Adaptor | Browser | Supported | Listeners inspected |
| --- | --- | --- | --- |
| Puppeteer | Chrome | Yes | Yes |
| Playwright | Chromium | Yes | Yes |
| Playwright | Firefox | Yes | **No.** Only handlers set with an `on…` attribute or property are seen, so a control wired up with `addEventListener` alone is found by its role, or reported for review by its cursor. |
| Playwright | WebKit | **No.** WebKit does not move focus to links when Tab is pressed, so the audit only reaches a subset of the page. | No |

`result.listenersInspected` says which applied.

## Adaptor requirements

The audit runs against a `BrowserAdaptor` from `@a11y-pulse/browser-adaptor`. One optional method adds what only the browser knows:

```ts
interface UnreachableControlsAdaptor extends BrowserAdaptor {
  /**
   * Inspect each element of the array a page script left on window[stashKey], in order. `roles`
   * lists the indices whose accessibility role is wanted. Resolve to null when the browser cannot
   * be asked.
   */
  inspectElements?(
    stashKey: string,
    count: number,
    roles: readonly number[],
  ): Promise<Array<{ listeners: string[]; role: string | null }> | null>;
}
```

The bundled adaptors implement it over the Chrome DevTools Protocol (`DOMDebugger.getEventListeners` and `Accessibility.getPartialAXTree`), on a session they open and close for the call.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `elementLimit` | `number` | `1024` | Max focusable elements to tab through. Hitting it makes the result inconclusive. |
| `screenshotSettleDelay` | `number` | `33` | How long to wait (in ms) after each Tab for the page to settle. |
| `timeout` | `number` | `0` (no timeout) | Limit how long (in ms) the tab loop runs. Hitting it makes the result inconclusive. |
| `candidateLimit` | `number` | `500` | Max elements examined as possible controls. Elements with a sign of being one (a handler property, a widget role, a pointer cursor, `tabindex="-1"`) are taken first; the rest are only examined when listeners can be inspected. |
| `findingLimit` | `number` | `50` | Max findings reported across `unreachable` and `missingRole`. Failures are kept ahead of reviews. |

## Result shape

```ts
type UnreachableControlsResult = {
  /**
   * `clean` is not proof that every control is reachable: see Limitations.
   * `inconclusive` means the tab pass did not cover the page, or the page could not be scanned.
   */
  outcome: "findings" | "clean" | "inconclusive";
  inconclusiveReason?:
    | "session-ended-early"
    | "element-limit"
    | "timeout"
    | "navigated"
    | "scan-failed";
  /** Controls Tab never reached, in document order. */
  unreachable: Array<{
    selector: string;
    html: string;
    /** Start of the element's text. */
    text: string;
    verdict: "failed" | "review";
    reason:
      | "widget-role"
      | "click-handler"
      | "hidden-control-label"
      | "container-handler"
      | "script-focus-only"
      | "press-handler"
      | "pointer-cursor"
      | "blanket-listener";
    signals: ControlSignals;
  }>;
  /** Focused elements that act as controls but expose no role, in tab order. */
  missingRole: Array<{
    selector: string;
    html: string;
    text: string;
    verdict: "failed" | "review";
    reason:
      | "handler-without-role"
      | "custom-element"
      | "pointer-cursor"
      | "container-handler"
      | "blanket-listener";
    signals: ControlSignals;
    /** The role the browser exposes (`generic` for a plain div), or null when it was not asked. */
    computedRole: string | null;
    /** 1-based tab stop at which the element took focus. */
    tabIndex: number;
  }>;
  /** The browser was asked which listeners each element has. */
  listenersInspected: boolean;
  /**
   * `candidateLimit` or `findingLimit` cut the scan or the findings short, or only a sample of the
   * `blanket-listener` elements is listed.
   */
  truncated: boolean;
  summary: {
    /** Tab stops recorded. */
    checked: number;
    passed: number;
    /** Findings with verdict `failed`. */
    failed: number;
    reachedLimit: boolean;
    reachedFailedElementLimit: boolean;
    timedOut: boolean;
    sessionEnd: "completed" | "lostFocus" | "navigation" | "failed" | "stuck" | "limit" | null;
  };
};

/** Why an element was taken to be a control. */
type ControlSignals = {
  /** Pointer and keyboard event types handled on the element itself. */
  listeners: string[];
  /** The `role` attribute, or null. */
  role: string | null;
  /** The computed cursor is `pointer`. */
  cursorPointer: boolean;
  /** The `tabindex` attribute, or null. */
  tabindex: number | null;
};
```

## Limitations

- **Delegated listeners say nothing about the control.** A click handled by a listener on an ancestor, `<body>` or `document` leaves nothing on the element itself. The browser does report the listeners on the element a framework delegates to (React attaches every event it supports to its root and to each portal container), but those show where the framework listens, not which elements inside respond, so that element is recognised by its event set and left alone. A control in a React page, or one wired up by jQuery-style delegation, is therefore reported for review at most, by its pointer cursor.
- **Finding limit.** When more is found than `findingLimit` allows, failures are kept first, then reviews, then `blanket-listener` elements, and `truncated` is set.
- **Listeners need Chromium.** Elsewhere only `on…` handlers, roles and cursors are seen.
- **Reachable is not operable.** An element in the tab order that ignores Enter and Space is not reported, and neither is a composite widget whose arrow keys do nothing: the audit does not press keys on controls.
- **Shortcuts are not counted.** A control reachable only through a keyboard shortcut, or through another control that does the same thing elsewhere on the page, is still reported.
- **One page state, one viewport.** Controls inside closed menus, dialogs and collapsed sections are not rendered and so are not examined.
- **Shadow DOM.** Open shadow roots are scanned; closed ones are not. `aria-controls` and its relatives are only followed within the document, not into or out of a shadow root.
- **Frames are not entered.**
- **The page as it stands after the pass.** The scan runs once the tab pass has finished, so a control that was added or removed while tabbing is judged by its final state.

## Known false positives

Cases where the audit reports a problem that is not one. Each says which bucket it lands in.

- **A click target that duplicates another control** (`failed`). A card with a click listener beside, not around, its "View" link, or a hero image that opens the same page as the button below it. The audit only knows a control is duplicated when the focusable one is inside it.
- **Click listeners that are not controls** (`failed`). A listener that only tracks clicks for analytics, stops propagation or closes a menu when clicked outside is indistinguishable from one that does something. On small elements these fail; on large containers with no pointer cursor they are sent for review as `container-handler`, and when a script puts one on most elements of the page they are sent for review as `blanket-listener`. A tracking script that instruments fewer than half of the unreached elements, or a page with fewer than 20 of them, still fails each one.
- **A hidden control replaced by a widget that is not beside it** (`failed`). The label of a `display: none` select or checkbox is passed when a focusable widget sits right before or after the control or uses the label as its name. A replacement placed elsewhere and named some other way is not recognised, so the label is reported as `hidden-control-label`.
- **Widgets that manage focus without saying so** (`failed` or `review`). A custom listbox or menu with no composite role, whose items have a role but no `tabindex` and are moved through with arrow keys by a script, has its items reported. Giving the container the role it acts as, or the pattern's `aria-activedescendant`, fixes both the report and the widget.
- **Swipe areas and drag handles** (`review`). A carousel track or a splitter that listens for pointer presses is reported as `press-handler` even where arrow buttons or keys do the same.
- **Decorative pointer cursors** (`review`). A card with a hover effect and `cursor: pointer` but no behaviour is reported as `pointer-cursor`.
- **Focus targets with a pointer cursor** (`review`). A focusable element that is not a control but inherits `cursor: pointer` from a clickable ancestor is reported as a possible missing role.

## License

Released under the [PolyForm Shield License 1.0.0](./LICENSE.md), in plain language:

- **Source-available.** The source is public and you can read, fork, and modify it.
- **Permitted for non-competing use.** You can use this package freely in your own products and services, as long as they don't compete with A11y Pulse.
- **Competing products are forbidden.** You may not use this software (or a modified version of it) to build a product or service that competes with A11y Pulse's accessibility monitoring offering.

See [LICENSE.md](./LICENSE.md) for the full, binding terms.
