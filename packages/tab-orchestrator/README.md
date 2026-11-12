# @a11y-pulse/tab-orchestrator

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/tab-orchestrator)](https://www.npmjs.com/package/@a11y-pulse/tab-orchestrator)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE.md)

A shared Tab-session runner for A11y Pulse's keyboard-driven accessibility audits. It drives a page through its focusable elements once (pressing Tab, tracking visited elements, capturing screenshots and styles on demand) while one or more **consumers** each score the tab stops for their own WCAG success criterion. This lets audits like [`@a11y-pulse/focus-appearance-audit`](../focus-appearance-audit) (WCAG 2.4.7) share a single tab loop with sibling audits instead of each re-tabbing the page from scratch.

It is not an audit itself: it has no opinion on what "passing" means. It only owns the mechanics of moving focus, tracking cycle completion, and capturing the primitives (computed styles, clipped screenshots, unfocused/focused pairs) that consumers need.

This package was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released under the [MIT License](#license).

## Install

```bash
npm install @a11y-pulse/tab-orchestrator
```

This package drives the page through a [`BrowserAdaptor`](#browseradaptor) you supply. It has no peer dependencies: install [`@a11y-pulse/browser-adaptor`](../browser-adaptor) alongside it for the bundled Puppeteer and Playwright implementations.

## `createTabOrchestrator`

```ts
import { createTabOrchestrator } from "@a11y-pulse/tab-orchestrator";

const orchestrator = createTabOrchestrator(adaptor, sessionOptions);

orchestrator.attach(consumerA);
orchestrator.attach(consumerB);

await orchestrator.run();
```

- `createTabOrchestrator(adaptor: BrowserAdaptor, options?: TabSessionOptions)` builds a session against a single page, driven through the given [`BrowserAdaptor`](#browseradaptor). `TabSessionOptions` covers shared cost controls (`screenshotSettleDelay`, `screenshotClipBuffer`, `markerLimit`, `baselineElementLimit`, `composeScripts`) and the session's own caps (`maxTabPresses`, 4096 by default, and `maxDuration` in milliseconds, off by default), not any particular audit's policy.
- `.attach(consumer)` registers a `TabConsumer`. Attaching after `run()` has started throws.
- `.run()` presses Tab repeatedly, dispatching each `TabStopSnapshot` to every still-attached consumer, until either a full tab cycle completes, focus is lost, navigation happens, a cap is reached, or every consumer has disconnected. Calling it twice throws; calling it with zero attached consumers returns immediately without tabbing. It resolves to `TabSessionStats` for monitoring the session's cost: tab stops delivered, unfocused pairs and screenshots captured, time spent capturing them (`captureMs`), total `durationMs`, native dialogs dismissed (`dialogsDismissed`), and the `endReason` (`null` when every consumer disconnected itself).
- `.failures` lists the consumers that threw, with what they threw. A consumer that throws is detached and told the session ended as `failed`; the others are seen through to the end, and only then does `run()` reject with the first error. Catch that rejection and read `.failures` to keep the results of the consumers that did not throw.

Each consumer declares the `capabilities` it needs (e.g. `baselineStyles`, `unfocusedPair`) and can disconnect independently once it has what it needs (say, after hitting its own element limit). The orchestrator keeps driving the remaining consumers. Per-stop work like unfocused-pair screenshots is only captured if a still-attached consumer actually asks for it that stop.

### How a session starts and ends

The session always begins at the first tab stop of the page, as a fresh page load would, whatever was focused beforehand: an `autofocus` field is blurred before the baseline is measured, and the point the browser tabs on from is put back at the top. The same is done when the session ends, so whatever runs next on the page starts from the top too. On a page that uses positive `tabindex`, putting that point back needs a hidden, unfocusable `<span data-a11y-pulse-focus-start>` in front of the first tab stop until focus next moves; pages without positive `tabindex` are left with nothing.

A Tab press that leaves nothing focused normally means the tab order has run out. The session carries on instead when the press reached an element that gave focus up again (`onfocus="this.blur()"`, or an element removed as it was focused), since the tab order continues past it. A focusable or editable `<body>` is reported as a tab stop of its own.

| `endReason` | Meaning |
| --- | --- |
| `completed` | The tab order ran out, or came back round to an element already visited (`SessionEndDetail.revisitedIndex` is then set). An element re-rendered as a new node in the same place, with the same id, href, name, label and text, counts as the one it replaced, so a focus trap that re-creates its controls is still recognised as a cycle. Different content in the same place (a list swapping in its next page) is a new stop. |
| `lostFocus` | The page stopped reporting focus, so nothing measured afterwards could be trusted. |
| `navigation` | Focus sent the page to another document. Detected with or without a `contextSignals` consumer. The rest of the original page was not visited. |
| `stuck` | Focus never came back out of an iframe (256 Tab presses in a row inside it; `detail.stuckIn` names the iframe), or never settled on an element. |
| `limit` | `maxTabPresses` or `maxDuration` ran out first, so the page was only partly covered. |
| `failed` | The session threw; or, for one consumer alone, that consumer did. |

Everything the session installs in the page is taken out again when it ends. In particular the `contextSignals` observer, which stubs `window.open` and `form.submit()`, cancels form submissions and, where the browser has the Navigation API, cancels navigations the page starts by script while the session runs, restores all of them.

A `contextSignals` consumer gets more than flags. `snapshot.contextSignals.details` carries what is known about each signal: the URL passed to `window.open`, the submitted form (selector, markup, action), the URLs either side of a soft URL change, where a cancelled navigation was headed (`signals.navigationPrevented`), and `attributed`, the element that received focus and then dropped it or passed it on, which is not `snapshot.activeElement` when focus was redirected. `session.screenshotClip("attributed")` captures that element rather than the focused one. A focus guard handing focus on sets `signals.focusGuard` instead of a redirect: an element a dialog library marks as its guard (or hides with `aria-hidden="true"`), or an empty, unnamed, role-less element that sends focus into a dialog it sits in or beside. An empty element that sends focus anywhere else is a redirect like any other, and is reported even when it sends focus back to an element already visited, which otherwise ends the session without a stop.

A signal is the current stop's only when the observer has evidence that the element caused it: the change happened while the element's focus event was being dispatched, or inside a `setTimeout` of up to a second set then (or set from such a timer). The rest is kept apart:

- `snapshot.contextSignals.late` lists changes such a timer made on behalf of an element focus has already left, each with that element's marker index and markup.
- `snapshot.contextSignals.unattributed` lists changes nothing ties to any element: what a timer or poll loop the page started for reasons of its own did, a navigation from a session-expiry countdown, a dialog raised on a schedule. They are blocked like the rest (a script-initiated navigation is cancelled whoever asked for it, and does not happen later), and reported so that a consumer can say so without blaming whichever element was focused.

When the session ends it waits, for up to a second, for owned timers that are still pending, then reads the observer one last time. Whatever that turns up, and anything read at a point where no stop was delivered, arrives as `detail.contextSignals` (`late` and `unattributed`) on `onSessionEnd`. Consumers are told the session has ended after that read and before the page is restored.

When a navigation could not be cancelled and no consumer was shown the stop that caused it, `onSessionEnd("navigation", detail)` gets `detail.navigation`: the last stop delivered (`after`) and where the page went (`url`).

Native dialogs (`alert`, `confirm`, `prompt`) raised as focus arrives are dismissed by the bundled adaptors rather than hanging the session. The session asks the adaptor to dismiss dialogs when it starts (`startDismissingDialogs`) and to stop when it ends, so a `dialog` handler of your own is left alone outside the session. With a `contextSignals` consumer attached the observer watches the three functions, so `signals.openedDialog` is set on the stop whose element raised one, or on a `late` or `unattributed` entry, by the same rule as any other change; a dialog the adaptor dismissed that the observer never saw raised (one from a frame) is `unattributed`. Dialogs dismissed before the first Tab press are not reported at all.

### What a tab stop costs

A stop that nobody captures takes two `adaptor.evaluate()` calls: one to check the page still has focus before the press, and one that reads everything about the newly focused element afterwards (what it is, its selector, the context signals, how much of it is covered). That counts calls on the adaptor, not round trips in the driver beneath it: the Tab press is a call of its own, and the Playwright adaptor spends three round trips on each `evaluate()` where a page's Content-Security-Policy forbids `eval`.

The page scripts for each step travel as one composed function. The session falls back to one call per script, with the same results, in three cases; `composeScripts: false` asks for that outright.

- The adaptor's `evaluate()` does not run a composed function. This is detected when the session starts.
- The host forbids building code from strings (`node --disallow-code-generation-from-strings`, some worker runtimes). The composed function is only built when a session first sends one, so importing the package never needs it.
- A composed stop script does not come back. Its waits happen inside the page, on the page's own `setTimeout` and animation frames, and a page can have stopped both (fake timers plus paused virtual time). Either one firing is enough; when neither does, the host gives up on the script after the longest its waits could take plus three seconds, and runs that stop and the rest of the session one script at a time, where every wait is the host's own.

`screenshotSettleDelay` (33 ms by default) is the longest the session waits after a Tab press before measuring, not a fixed pause. The wait happens inside the page and ends after one animation frame unless something is still pending:

- a timer the page set since the press that comes due within the delay (a focus handler deferring its work with `setTimeout`), which is waited for;
- a CSS transition or animation running on the focused element, its ancestors or its descendants, or `scroll-behavior: smooth` on a scroller around it, either of which spends the whole delay.

To tell which timers a focus handler set, the session wraps `window.setTimeout` while it runs and puts the page's own back when it ends. If the page wrapped `setTimeout` again in the meantime, its wrapper is left in place and the session's, which cannot then be taken out of the chain, does nothing from then on but call through. A capture (`ensureUnfocusedPair()`, `screenshotClip()`, `screenshotContext()`) is never taken sooner than the full delay after the press. A delay of 0 skips the wait altogether.

An unfocused pair (`ensureUnfocusedPair()`) is two screenshots of the same thing, with and without focus on the element. That thing is the element itself unless it draws nothing (fully transparent, clipped to a pixel, or off the page, as the real input of a custom checkbox usually is), in which case it is the element's visible `<label>` or else its nearest visible ancestor; `clipTarget` and `unpainted` say so. With a label, the screenshots also take in the element's nearest visible ancestor unless that is a whole page region, since the indicator of a hidden input is often on a sibling of the input and not on its label. CSS transitions on the element and around it are given up to half a second to finish before each screenshot. The text caret is hidden in both screenshots (`caretHidden`), `obstructed` says whether something else still covered the target after it was centred, `context` holds the focus-relevant styles of the element's three nearest ancestors and its labels with and without focus, and `background` is the first opaque background colour behind the element. Each `context` entry is marked `shared` when it holds another tab stop besides the element (so a change to it does not say which of them has focus) and `animating` when a CSS animation, as opposed to a transition, is running on it (so it differs from one read to the next regardless of focus). If a screenshot fails part-way, the caret is un-hidden and focus is given back before the error is passed on.

`ActiveElementInfo.styles` and the baseline styles are only read when an attached consumer declares `baselineStyles` or `unfocusedPair`; for other consumers `styles` holds empty records. The element handle a capture needs is only fetched on a stop where a consumer asks for one. It is always the element the stop was measured on, even if the page has moved focus elsewhere by the time the consumer captures.

Most callers won't build a `TabConsumer` by hand. Audit packages export a `createXAudit(options)` helper that returns one, plus a `runXAudit(adaptor, options)` convenience wrapper that builds a private single-consumer orchestrator for you. See [`@a11y-pulse/focus-appearance-audit`'s "Shared tab session"](../focus-appearance-audit#shared-tab-session) section for a worked example.

## `BrowserAdaptor`

The orchestrator drives a page through an **adaptor**: a small interface of primitives (evaluate JS in the page, press Tab, take a clipped screenshot, etc.) so it never needs to know which browser automation library is behind it. The `BrowserAdaptor` interface and its method-by-method reference live in [`@a11y-pulse/browser-adaptor`](../browser-adaptor#browseradaptor); this package does not re-export them.

The orchestrator is the only thing that mutates the page through this adaptor during a session; consumers score snapshots, they don't call `pressTab`, take screenshots, or install observers themselves.

### Supplying an adaptor

```js
import { createTabOrchestrator } from "@a11y-pulse/tab-orchestrator";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";

const orchestrator = createTabOrchestrator(new PuppeteerAdaptor(page));
```

This package ships no adaptor of its own. [`@a11y-pulse/browser-adaptor`](../browser-adaptor) provides `BrowserAdaptor` along with two implementations, `PuppeteerAdaptor` and `PlaywrightAdaptor`, so consumers that only need the type-level interface aren't forced to install either automation library. Other environments (Selenium, WebDriver) can be supported by implementing `BrowserAdaptor` against your automation library's page/session object; use [`@a11y-pulse/browser-adaptor`'s `src/adaptors/puppeteer.ts`](../browser-adaptor/src/adaptors/puppeteer.ts) as a reference implementation.

## Releasing

Releases are managed in the [A11y-Pulse/audits](https://github.com/A11y-Pulse/audits) monorepo with [Changesets](https://github.com/changesets/changesets). Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC). There is no long-lived `NPM_TOKEN`.

### Ship a change

1. Open a PR against `main` that includes a changeset (`npx changeset`) naming `@a11y-pulse/tab-orchestrator`.
2. After merge, the Release workflow opens a Version PR. Merging that PR publishes this package to npm and tags `@a11y-pulse/tab-orchestrator@<version>`.

Trusted Publisher on npm must stay configured for:

| Field | Value |
| --- | --- |
| Organization or user | `A11y-Pulse` |
| Repository | `audits` |
| Workflow filename | `release.yml` |

## License

[MIT](./LICENSE.md). Use it however you like, including in commercial and competing products.

The audit packages in this repository are licensed separately, under the
[PolyForm Shield License 1.0.0](../../LICENSE.md).
