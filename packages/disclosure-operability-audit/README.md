# @a11y-pulse/disclosure-operability-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/disclosure-operability-audit)](https://www.npmjs.com/package/@a11y-pulse/disclosure-operability-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit for [**WCAG 2.1.1 Keyboard**](https://www.w3.org/WAI/WCAG22/Understanding/keyboard) and [**4.1.2 Name, Role, Value**](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value) (both Level A). It finds the page's disclosure triggers, the menu buttons, accordion headers and "show more" toggles that carry `aria-expanded`, and operates each one with Enter and Space. A trigger must open, say that it opened by updating `aria-expanded`, and close again.

Static analysis can check that `aria-expanded` is present and valid. It cannot tell that a `div role="button"` only listens for clicks, that a mega menu only opens on hover, or that `aria-expanded="false"` was written once in a template and never touched again. This audit presses the keys and watches what the page does.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/disclosure-operability-audit @a11y-pulse/browser-adaptor puppeteer
```

## Quickstart

```js
import { runDisclosureOperabilityAudit } from "@a11y-pulse/disclosure-operability-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://example.com/");

const result = await runDisclosureOperabilityAudit(new PuppeteerAdaptor(page));

console.log(result.summary);
// { checked: 2, failed: 1, needsReview: 0, passed: 1, skipped: 1, unchecked: 0 }

console.log(result.failed);
// [
//   {
//     selector: "#brand-filter",
//     html: '<div id="brand-filter" role="button" tabindex="0" aria-expanded="false" aria-controls="brand-options">',
//     role: "button",
//     expanded: "false",
//     controls: "#brand-options",
//     signals: ["keyboard-inoperable"],
//     keysTried: ["Enter", "Space"],
//     attempts: [
//       { key: "Enter", expandedBefore: "false", expandedAfter: "false", contentChanged: false, restoredBy: null },
//       { key: "Space", expandedBefore: "false", expandedAfter: "false", contentChanged: false, restoredBy: null }
//     ],
//     pointer: { click: true, hover: null },
//     openedOnFocus: false,
//     restored: true
//   }
// ]

await browser.close();
```

A page with no triggers to operate returns `summary.checked: 0`, which is inapplicable.

**This audit activates controls on the page.** It presses Enter and Space on each trigger, which runs whatever the page's handler for that control does, then puts the trigger back. It cannot know in advance what a handler does. It guards against the harmful cases it can recognise (see [What it will not touch](#what-it-will-not-touch) and [Safeguards](#safeguards)), but a control that carries `aria-expanded` and does something irreversible when activated, under a name the audit does not recognise as risky, will be activated. Do not run it against a page where that matters, and run it after audits that expect an untouched page, never at the same time as anything else driving the page.

## How it decides

### Which elements are triggers

Every element, including those in open shadow roots, is considered in one call into the page. A trigger is any element with `aria-expanded`.

With the `includeControlsOnly` option, a button-like element (`<button>`, `role="button"`, `role="menuitem"`, a link that stays on the page, or anything with `tabindex`) with `aria-controls` and no `aria-expanded` is also a trigger when every element its `aria-controls` names is not rendered. This is the "button that reveals a region and never says so" case. It is off by default because nothing on such a button says it is a disclosure: `aria-controls` on an "Export" or "Load more" button is common, and operating it runs its handler.

Native `<details>`, `<summary>` and `<select>` are never triggers: the browser guarantees their behaviour.

### What it will not touch

Some triggers are found and reported in `skipped` without being activated:

| Reason | When |
| --- | --- |
| `navigating-link` | An `<a href>` that leaves the page (anything other than `#…`, empty or `javascript:`), or a control inside one |
| `submits-form` | A submit or reset button, including a `<button>` in a form with no `type` |
| `checkable` | A native checkbox or radio button, or `role="checkbox"`, `"radio"`, `"switch"`, `"menuitemcheckbox"` or `"menuitemradio"`. Operating one changes a value, and Enter in a native one submits its form |
| `risky-name` | Its accessible name matches `riskyNamePattern`: by default delete, remove, erase, log out, sign out, unsubscribe, pay, buy, purchase, send, "order now" and "place/confirm/complete/submit order", as whole words in English |
| `text-entry` | A text field, `role="combobox"` or editable content, which opens by typing or arrow keys |
| `composite-item` | A tree item, grid row or cell, option or tab, which expands with arrow keys inside its widget |
| `disabled` | `disabled`, `aria-disabled="true"`, or inside `inert` content or a disabled fieldset |
| `hidden` | Not rendered, such as a mobile menu button at a desktop width |
| `state-on-container` | Not focusable itself but wraps something that is: `aria-expanded` sits on a container |

At most `triggerLimit` triggers (20 by default) are operated. A page with more is sampled evenly from top to bottom, and the rest are counted in `summary.unchecked`.

### Safeguards

These apply to every trigger that is operated:

- **A key is only pressed while the trigger holds keyboard focus.** Before each Enter or Space the trigger is focused, and focus is checked again a moment later. If it is anywhere else, as when a dialog the trigger opened keeps focus to itself, the key is not pressed.
- **A click is only made while focus has not moved elsewhere**, and neither a key nor a click is sent while a modal dialog (`<dialog>` opened modally, or a rendered `aria-modal="true"` element) that the trigger is not part of is on show.
- **Escape is the only key pressed anywhere else.** When what a trigger opened takes focus and Escape does not close it, the audit stops there. The trigger is reported `not-restored` and the page is left with it open.
- **Form submissions are stopped** for as long as the audit runs: `submit` events are cancelled before the page's own handlers see them, and `form.submit()` and `form.requestSubmit()` do nothing. A trigger that tried is reported `submit-blocked`.
- **Navigations to another document are stopped** where the browser has the Navigation API (Chromium). A trigger that tried is reported `navigation-blocked`. Fragment and history-state changes are let through.
- **A handler that shows nothing is run once.** When Enter clicks the trigger and nothing changes, Space and the scripted click are not sent: they would only run the same handler again.

All of this is undone when the audit finishes, on every way out including an error.

### How a trigger is operated

1. The page is recorded: the trigger's `aria-expanded`, whether its `aria-controls` target is rendered, and which elements outside the trigger are rendered at all. The page is then watched untouched for 50ms. If it changes by itself (a carousel, a ticker), only the trigger's own state and `aria-controls` target are trusted for that trigger.
2. The trigger is focused. If that alone opens it, no keys are pressed: it passes when `aria-expanded` changed with it and is reviewed otherwise.
3. Enter is pressed, then Space. Space is not sent to a native link, which it scrolls rather than activates. After each key the audit waits up to `activationTimeout` (250ms) for `aria-expanded` to change or content to appear or disappear. When the key clicked the trigger, so a handler is known to have run, or a transition is playing, it waits up to one second.
4. After a key that changed something, the audit waits for any transition on the content to finish, then puts the trigger back: with the same key, then Escape, then a click, each subject to the [safeguards](#safeguards). Escape is tried first when the popup took focus, because the key would land inside it.
5. Only when no key changed anything, a scripted click is tried, then scripted pointer events entering the trigger. This tells a control that is broken for everyone from one that is broken for keyboard users. The click is skipped when a key already clicked the trigger.
6. Last, the trigger's `aria-expanded` and `aria-controls` target are read once more. A change that arrived after the audit stopped waiting is put back the same way.

A trigger that starts expanded is treated the same way in reverse: the keys must collapse it, and it is expanded again afterwards.

When the audit finishes, focus and scrolling are returned to where they were.

### Signals

| Signal | Bucket | Meaning |
| --- | --- | --- |
| `not-focusable` | `failed` | A click or hover operates it, but it cannot take keyboard focus (2.1.1) |
| `keyboard-inoperable` | `failed` | A click or hover operates it, but neither Enter nor Space changes anything (2.1.1) |
| `state-not-exposed` | `failed` | A key shows or hides content while `aria-expanded` is missing or stays the same (4.1.2) |
| `unresponsive` | `needsReview` | Nothing changed with keys, a click or a hover. Broken for everyone, or it needs something the audit did not do |
| `state-without-content` | `needsReview` | `aria-expanded` changes but no content was seen to appear or disappear |
| `space-inoperable` | `needsReview` | A `<button>` or `role="button"` that Enter operates and Space does not |
| `enter-inoperable` | `needsReview` | Space operates it and Enter does not |
| `pointer-only-close` | `needsReview` | A key opened it but only a click closed it again |
| `not-restored` | `needsReview` | Once changed, nothing the audit could safely try put it back. The page was left changed (`restored: false`). When what opened took keyboard focus, only Escape was tried |
| `submit-blocked` | `needsReview` | Operating it tried to submit a form, which was stopped |
| `navigation-blocked` | `needsReview` | Operating it tried to load another page, which was stopped |
| `opens-on-focus` | `needsReview` | Content appears when it takes focus, without `aria-expanded` changing |
| `trigger-removed` | `needsReview` | The trigger left the document when activated |
| `not-in-tab-order` | `needsReview` | It works, but has a negative `tabindex` outside a menu, menubar, toolbar, tablist or listbox |
| `navigated` | `needsReview` | Activating it replaced the document. The audit stopped there (`stopped: "navigated"`) |

### When the page navigates

Links that leave the page are never activated, but a `<button>` can still navigate from script. Where the browser has the Navigation API the navigation is stopped, the trigger is reported with `navigation-blocked` and the audit carries on. Elsewhere, activating such a trigger replaces the document and the audit stops: that trigger is reported with `navigated`, the result has `stopped: "navigated"`, the triggers after it are counted in `summary.unchecked`, and the page is no longer the one the audit started on. The caller should reload before running anything else.

## Browser support

| Adaptor | Browser | Supported |
| --- | --- | --- |
| Puppeteer | Chrome | Yes |
| Playwright | Chromium | Yes |
| Playwright | WebKit | Not yet verified |
| Playwright | Firefox | Not yet verified |

The integration suite runs on every engine in CI; it has so far only been run on the two Chromium engines.

## Adaptor requirements

The audit uses `evaluate`, `evaluateHandle` and `disposeRef` to inspect the page and build selectors, `pressKey` with `"Enter"`, `"Space"` and `"Escape"`, and calls `ensureFocusReporting` first so that a trigger which opens on focus does so when the page is not in the foreground. It takes no screenshots. `"Space"` was added to `KeyName` in `@a11y-pulse/browser-adaptor` for this audit; a custom adaptor must accept it.

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `triggerLimit` | `number` | `20` | Max triggers to operate. A page with more is sampled evenly; the rest are counted in `summary.unchecked`. |
| `activationTimeout` | `number` | `250` | Milliseconds to wait for a key press to change something before deciding it did nothing. Raise it for slow, script-heavy pages. |
| `riskyNamePattern` | `string \| null` | `DEFAULT_RISKY_NAME_PATTERN` | Source of a case-insensitive regular expression. A trigger whose accessible name matches is skipped as `risky-name`. Pass your own for a page in another language, or `null` to operate every trigger whatever it is called. |
| `includeControlsOnly` | `boolean` | `false` | Also operate buttons with `aria-controls` naming hidden content and no `aria-expanded`. |

A trigger that works costs about 350ms, and up to a second when its panel animates. A `<button>` that responds to nothing is given a second to act after Enter, then a hover (about 1.4 seconds); a `div` that ignores keys waits out both keys, a click and a hover (about 900ms). A page of 20 dead buttons takes about 30 seconds.

## Result shape

```ts
type DisclosureAttempt = {
  key: "Enter" | "Space";
  /** `aria-expanded` before and after the key press. */
  expandedBefore: string | null;
  expandedAfter: string | null;
  /** Whether content was shown or hidden. */
  contentChanged: boolean;
  /** What undid the change, or null when nothing changed or nothing undid it. */
  restoredBy: "Enter" | "Space" | "Escape" | "click" | "blur" | null;
};

type DisclosureTrigger = {
  selector: string;
  /** Truncated opening tag. */
  html: string;
  /** The explicit `role`, or null. */
  role: string | null;
  /** `aria-expanded` as found. Null only for an `aria-controls`-only trigger (`includeControlsOnly`). */
  expanded: string | null;
  /** Selector for the first element `aria-controls` names, or null. */
  controls: string | null;
  /** Every signal that applies, most serious first. Empty when the trigger passes. */
  signals: DisclosureSignal[];
  keysTried: ("Enter" | "Space")[];
  attempts: DisclosureAttempt[];
  /** Whether a click or hover changed anything. Null when not tried. */
  pointer: { click: boolean | null; hover: boolean | null };
  openedOnFocus: boolean;
  /** Whether it was left as it was found. */
  restored: boolean;
};

type DisclosureOperabilityResult = {
  failed: DisclosureTrigger[];
  needsReview: DisclosureTrigger[];
  passed: DisclosureTrigger[];
  /** Triggers found but not operated, up to ten. */
  skipped: { selector: string; html: string; reason: DisclosureSkipReason }[];
  /** Set when activating a trigger replaced the document. */
  stopped: "navigated" | null;
  summary: {
    checked: number;
    failed: number;
    needsReview: number;
    passed: number;
    /** Every skipped trigger, including those past the ten listed. */
    skipped: number;
    /** Operable triggers left out by `triggerLimit` or not reached before the audit stopped. */
    unchecked: number;
  };
};
```

`classifyTrigger(observation)`, the pure classifier behind the audit, returns the `signals` and a `verdict` of `"failed"`, `"review"` or null for what was observed on one trigger.

## Limitations

- **Only declared disclosures.** A control without `aria-expanded` is not found, however much it behaves like a menu. A click-only `div` with no ARIA at all is a job for a keyboard-reachability check.
- **Risky names are English words.** The default pattern does not recognise "Supprimer" or "Abmelden". Pass `riskyNamePattern` for other languages. A destructive control with a neutral name ("Continue", an icon with no name) is not recognised at all.
- **Handlers run.** Activating a trigger runs its handler, at least once. Form submissions and, in Chromium, page loads are stopped, but a `fetch`, an analytics event or a change to stored state made by the handler is not.
- **Scripted pointer, not a real one.** The click is `element.click()` and the hover is dispatched `pointerover`, `pointerenter`, `mouseover` and `mouseenter` events. A menu opened purely by CSS `:hover` does not respond to those, so a CSS-only hover menu is reported as `unresponsive` for review, not as a keyboard failure.
- **Content is "rendered or not".** An `aria-controls` target counts as shown when it has a box, is not parked off the side of the page and passes `checkVisibility()` including opacity. Everywhere else on the page only being rendered counts, not where: a carousel or ticker moves its slides in and out of the document all the time, and that must not be taken for content a key press revealed. So a panel with no `aria-controls` that is parked off-screen and moved into view, one that slides in with a transform, and one revealed by `clip-path` are not seen to change, which is why `state-without-content` is only reviewed.
- **Pages over 5,000 elements** are not scanned for content appearing outside the `aria-controls` target, so there a trigger without a resolvable `aria-controls` can only be judged by its `aria-expanded`.
- **Arrow keys are not pressed.** Comboboxes, tree items and grid rows are skipped, and a menu button that only opens with ArrowDown is reported as `keyboard-inoperable` if a click opens it. The ARIA menu button pattern asks for Enter and Space as well.
- **What opened is not explored.** The audit does not tab through the opened content, check where focus went or test that focus returns to the trigger on close.
- **Triggers are sampled once.** Triggers that only exist after another one is opened (a submenu, a nested accordion) are not found.
- **Main document only.** Triggers inside iframes and closed shadow roots are not reached.
- **Other state is not restored.** The audit undoes what it can see: `aria-expanded`, rendered content, focus and scrolling. Anything else an activation did, such as an analytics event, a fetched panel left in the DOM or a URL fragment, stays.

## Known false positives

Cases where the audit reports a problem that is not one. Each says which bucket it lands in.

- **A trigger that needs more than a second** (`needsReview`). A panel fetched over the network before it opens looks like a key that did nothing, and is `unresponsive`. A custom control (not a `<button>`) that handles `keydown` itself is only given `activationTimeout`, so raise that for a page of slow custom controls.
- **`aria-controls` on a button that reveals unrelated hidden content** (`failed`, with `includeControlsOnly` only). A "Load more" button whose `aria-controls` names an empty, hidden list is taken for a disclosure with no expanded state.
- **A trigger that opens a dialog which ignores Escape** (`needsReview`). The dialog takes focus, the audit will not press anything but Escape inside it, and the trigger is `not-restored`. That a dialog cannot be dismissed with Escape is worth a look in its own right.
- **A page that adds and removes content by itself, but not during the 50ms watch** (`failed`). A rotating banner that swaps slides with `display` or `hidden`, or a feed that inserts items, can do so just as a key is pressed, which looks like content the key revealed. On a trigger that did nothing, that reads as `state-not-exposed`. A carousel that only moves its slides is not affected.
- **Consent or sign-up popups that open on first interaction** (`needsReview`). A page that reacts to the first key press or click anywhere by showing a dialog can leave a trigger `not-restored`.
- **A roving-tabindex widget without a container role** (`needsReview`). Triggers with `tabindex="-1"` in a custom toolbar that has no `role` are `not-in-tab-order`.
- **Deliberate open-on-focus menus** (`needsReview`). A navigation menu that opens when its link takes focus and has no `aria-expanded` change is `opens-on-focus`; it may be announced another way.

## License

Released under the [PolyForm Shield License 1.0.0](./LICENSE.md), in plain language:

- **Source-available.** The source is public and you can read, fork, and modify it.
- **Permitted for non-competing use.** You can use this package freely in your own products and services, as long as they don't compete with A11y Pulse.
- **Competing products are forbidden.** You may not use this software (or a modified version of it) to build a product or service that competes with A11y Pulse's accessibility monitoring offering.

See [LICENSE.md](./LICENSE.md) for the full, binding terms.
