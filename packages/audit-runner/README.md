# @a11y-pulse/audit-runner

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/audit-runner)](https://www.npmjs.com/package/@a11y-pulse/audit-runner)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE.md)

A simple command line interface that runs axe-core and all A11y Pulse audits against a single page. Results are reported in the axe-core format.

This package also exists as a reference for your own audit pipeline. If you would like to explore the code, a good starting point is [`src/run-audits.ts`](./src/run-audits.ts).

## Install

```bash
npm install @a11y-pulse/audit-runner
```

By default this package runs audits using Puppeteer. If you would like to use Playwright, you will need to install it with `npm install playwright-core && npx playwright-core install`.

## CLI

```bash
npx @a11y-pulse/audit-runner https://who.likesdogs.nz/
```

Launches headless Chromium at a 1280x800 viewport, loads the URL, runs every audit, and writes the combined axe-core report to stdout as JSON. Pipe it wherever you like:

```bash
npx @a11y-pulse/audit-runner https://who.likesdogs.nz/ | jq '.violations[].id'
```

For a readable summary of the failed audits and the ones that need review, use `--format simple`:

```bash
npx @a11y-pulse/audit-runner https://who.likesdogs.nz/ --format simple
```

Each failed audit is listed with its impact, a description, a link to more help, and up to five failing elements: selector, HTML, and the first line of why it failed. Below them, under "needs review", come the `incomplete` results, with up to three elements each. These are findings a person has to judge (a keyboard trap and an unusual focus order are only ever reported this way), audits that could not reach a conclusion, and audits that could not run, so a page that was not fully checked never reads as a clean one. Colours are used when stdout is a terminal.

Write either format to a file with `--output`. Missing parent directories are created:

```bash
npx @a11y-pulse/audit-runner https://who.likesdogs.nz/ --output reports/likesdogs.json
```

While it runs, a spinner on stderr shows the current step (loading the page, waiting for network idle, running axe-core, and so on). The spinner only appears when stderr is a terminal, so CI logs and redirected output stay clean.

`--engine playwright` drives the page with Playwright rather than Puppeteer, and `--browser` then picks the engine to launch:

```bash
npx @a11y-pulse/audit-runner https://who.likesdogs.nz/ --engine playwright --browser webkit
```

| Option | Values | Default |
| --- | --- | --- |
| `-o`, `--output` | A file path | stdout |
| `--format` | `json`, `simple` | `json` |
| `--engine` | `puppeteer`, `playwright` | `puppeteer` |
| `--browser` | `chromium`, `firefox`, `webkit` | `chromium` |
| `--timeout` | Milliseconds to wait for the page to load | `30000` |
| `--max-duration` | Milliseconds the audits may take in total, `0` for no limit | `600000` |
| `--ignore-http-errors` | Audit the page even when it responds with an HTTP error or is not HTML | off |
| `--skip` | Comma-separated ids of audits to leave out. May be given more than once | none |
| `--list-audits` | Print the id of every audit and exit | |

`--browser` requires `--engine playwright`. Firefox and WebKit tab in their own order and apply their own `:focus-visible` heuristics, so results will not match Chromium's element for element.

### Skipping audits

Every audit runs by default. `--skip` leaves out the ones you name, by the ids in the [results table](#results) (`--list-audits` prints them, and `axe-core` stands for all of axe-core's rules). A skipped audit does no work and is absent from the report. An id that is not an audit is an error, so a typo never silently runs everything.

```bash
npx @a11y-pulse/audit-runner https://who.likesdogs.nz/ --skip moving-content,disclosure-operability
```

Two audits are the usual candidates. `moving-content` watches the page for five seconds, which is most of the run on a small page (see [Order and run time](#order-and-run-time)). `disclosure-operability` presses Enter and Space on the page's own menu buttons and accordions, and closes what it opened. It leaves alone links, submit buttons, checkboxes and controls named for an action such as "Delete" or "Sign out", and stops form submissions and page loads while it runs, but it cannot know what else a handler does; skip it for a page where activating a control with `aria-expanded` has an effect you do not want.

### Pages that do not load cleanly

- **HTTP errors and non-HTML responses.** A URL that answers with a 4xx or 5xx status, or with something other than HTML (JSON, plain text, a PDF), is not audited: an error page or the browser's own JSON viewer would pass most audits and say nothing about the site. The run exits `1` with the status or content type on stderr. Pass `--ignore-http-errors` to audit it anyway, for example to check a custom 404 page.
- **Slow pages.** The page has `--timeout` milliseconds to fire its `load` event, after which the run exits `1`.
- **Pages that never go idle.** After `load` the runner waits for the network to go quiet, for up to `--timeout` or 10 seconds, whichever is shorter. A page that polls or holds a connection open is then audited as it stands, with a warning on stderr.
- **Dialogs.** `alert`, `confirm`, `prompt` and `beforeunload` dialogs are dismissed as they appear, while loading and while auditing.
- **Navigation on focus.** If tabbing through the page navigates it somewhere else, the original URL is loaded again before the audits that follow, with a warning on stderr. If it cannot be reloaded, those audits are reported as [not completed](#audits-that-could-not-run).

Warnings are written to stderr as `Warning: …` lines once the run has finished.

### Exit codes

The exit code reports whether the run itself succeeded, not whether the page passed: a page with violations still exits `0`.

| Code | Meaning |
| --- | --- |
| `0` | The audits ran and the report was written. Individual audits may still be reported as [not completed](#audits-that-could-not-run). |
| `1` | The run failed: bad arguments, the page did not load or loaded as an error page, or the browser or the page closed or crashed part of the way through. The message is on stderr and no report is written. |
| `130` | Interrupted with Ctrl+C (`SIGINT`). The browser is closed first, and no report is written to stdout or to `--output`. |
| `143` | Terminated (`SIGTERM`). The browser is closed first, and no report is written to stdout or to `--output`. |

`--max-duration` holds even on a page that has stopped responding, such as one whose script is stuck in a loop: the audits that did not finish are reported as not completed, and a browser that will not close cleanly is killed after five seconds.

## Browser support

| Adaptor | Browser | Supported |
| --- | --- | --- |
| Puppeteer | Chrome | Yes |
| Playwright | Chromium | Yes |
| Playwright | WebKit | **No.** The keyboard-driven audits it runs are unsupported on WebKit, which does not move focus to links when Tab is pressed. |
| Playwright | Firefox | **Partial.** Reflow, text spacing, skip link and context change match Chromium; focus appearance and focus not obscured differ in the cases noted in their own READMEs. |

## `runAllAudits`

```js
import { runAllAudits } from "@a11y-pulse/audit-runner";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import { PuppeteerAdaptor as ReflowAdaptor } from "@a11y-pulse/reflow-audit/puppeteer";
import { PuppeteerAdaptor as TextSpacingAdaptor } from "@a11y-pulse/text-spacing-audit/puppeteer";
import { PuppeteerAdaptor as UnreachableControlsAdaptor } from "@a11y-pulse/unreachable-controls-audit/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

// One adaptor serves as both: it is the browser adaptor with one more method.
const browserAdaptor = new UnreachableControlsAdaptor(page);

const results = await runAllAudits({
	browser: browserAdaptor,
	unreachableControls: browserAdaptor,
	reflow: new ReflowAdaptor(page),
	textSpacing: new TextSpacingAdaptor(page),
});

console.log(results.violations.map((audit) => audit.id));
// ['color-contrast', 'focus-appearance', 'reflow']

await browser.close();
```

`runAllAudits(adaptors, options?)` takes one adaptor per audit interface, all wrapping the same already-loaded page. Swap in the `PlaywrightAdaptor` from each of those subpaths to run the same audits under Playwright; nothing else changes.

`browser`, `reflow` and `textSpacing` are required. Two more are optional. `unreachableControls` lets the unreachable controls audit ask the browser which elements have listeners added with `addEventListener` (Chromium only); without it the audit uses `browser` and sees only `onclick` handlers, widget roles and the pointer cursor. `resizeText` drives the resize text audit; without it the `reflow` adaptor is used, which has everything that audit needs. If you build the `browser` adaptor yourself, pass `dismissDialogs: "always"` (as `puppeteerAdaptors` and `playwrightAdaptors` do): by default an adaptor only dismisses dialogs while a tab session runs, and a dialog raised during one of the other audits would block the page.

The adaptors may also carry `navigate(url)`, which loads a URL in the page and resolves once it has loaded. The runner uses it to return to the original page if tabbing navigated away; without it, it navigates from inside the page.

They may carry `isClosed()` too, which says whether the page or its browser has closed or lost its connection. When the page goes away mid-run, `runAllAudits` rejects with the exported `BrowserClosedError` instead of reporting every remaining audit as not completed, since nothing it could return would describe the page. Without `isClosed` it goes by the wording of the errors the adaptors throw. The adaptors built by this package's `puppeteerAdaptors(page)` and `playwrightAdaptors(page)` carry both.

`options` takes each audit's own options object under its key, all optional. `axe` is passed straight to `axe.run()`, and `onProgress` is called with a short description of each step as it starts:

```js
const results = await runAllAudits(adaptors, {
	axe: { runOnly: ["wcag2a", "wcag2aa"] },
	focusAppearance: { elementLimit: 50, skipStyleCheck: true },
	reflow: { screenshotLimit: 3 },
});
```

| Option | Description | Default |
| --- | --- | --- |
| `skip` | Ids of audits to leave out, from the exported `AUDIT_IDS`. A skipped audit does no work and is not reported. An unknown id throws. | none |
| `maxDuration` | Milliseconds the whole run may take. The audit running when it expires, and every audit after it, are reported as not completed, and nothing more is asked of the page. When it would expire during the shared tab pass, the pass is ended early enough (a quarter of the time left, between 2 and 20 seconds) for the keyboard-driven audits to report on the stops it reached. | `0` (no limit) |
| `tabSession.maxDuration` | Milliseconds the shared tab pass may take before it ends with the stops it has seen. `onWarning` is told when the pass ends at a limit. | `180000` |
| `url` | The URL being audited, reported as the result's `url` when the page is too busy to say where it is. | the page's `location.href` |
| `tabSession.maxTabPresses` | Tab presses the shared tab pass may make. | `4096` |
| `onWarning` | Called with a message when something qualifies the results without stopping the run, such as the page navigating away mid-run. | none |

## Results

The return value is in the shape of [axe-core's results object](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md#results-object). The A11y Pulse audit results included with the following audit IDs:

| Audit | `id` |
| --- | --- |
| Filename or placeholder alt text (WCAG 1.1.1) | `filename-alt-text` |
| Orphaned tab roles (WCAG 1.3.1 and 4.1.2) | `orphaned-tab-roles` |
| Code or placeholder accessible names (WCAG 1.1.1, 2.4.4 and 2.4.6) | `suspicious-accessible-name` |
| Focus appearance (WCAG 2.4.7) | `focus-appearance` |
| Focus shown by colour alone (WCAG 1.4.1) | `focus-color-only` |
| Focus indicator contrast (WCAG 1.4.11) | `focus-indicator-contrast` |
| Focus not obscured (WCAG 2.4.11) | `focus-not-obscured` |
| Context change on focus (WCAG 3.2.1) | `context-change-on-focus` |
| Keyboard trap (WCAG 2.1.2) | `keyboard-trap` |
| Focus order (WCAG 2.4.3) | `focus-order` |
| Controls Tab never reaches (WCAG 2.1.1) | `keyboard-reachability` |
| Focusable controls with no role (WCAG 4.1.2) | `control-without-role` |
| Skip link activation (WCAG 2.4.1) | `skip-link-activation` |
| Reflow (WCAG 1.4.10) | `reflow` |
| Text spacing (WCAG 1.4.12) | `text-spacing` |
| Resize text (WCAG 1.4.4) | `resize-text` |
| Moving content (WCAG 2.2.2) | `moving-content` |
| Paste blocked on sign-in fields (WCAG 3.3.8) | `accessible-authentication` |
| Disclosure operability (WCAG 2.1.1 and 4.1.2) | `disclosure-operability` |

axe-core is injected into the page and every same-origin iframe inside it, so its rules cover framed content. A cross-origin iframe cannot be reached and is reported by axe-core's own `frame-tested` rule as needing review. The A11y Pulse audits examine the top document only.

### Order and run time

The audits run one after another on the one page, in an order chosen so that none of them sees what a later one does to it:

1. **axe-core, then the audits that only read the page**: image alt text, tab roles and accessible names.
2. **Moving content.** It watches the page for five seconds, and has to do so before anything presses a key or moves focus: a carousel that pauses on focus, or content another audit has scrolled or resized, no longer moves the way a visitor finds it. Nothing else can use the page while it watches, so the wait cannot be shared with another audit.
3. **Accessible authentication.** It dispatches paste events at sign-in fields and puts their values back.
4. **The shared tab pass.** One trip through the page with Tab serves focus appearance, focus shown by colour alone, focus indicator contrast, focus not obscured, context change on focus, focus order, keyboard trap detection and the unreachable controls audit. Focus indicator contrast is read from the measurements focus appearance already took, and the scan for controls Tab never reached runs straight after the pass, before anything else touches the page.
5. **Skip link activation**, which presses Enter on the page's skip links.
6. **Text spacing, resize text, reflow.** Each changes the page's styles or viewport and puts them back before the next starts. Resize text is not run from a viewport narrower than 640 CSS px, where it is reported as `inapplicable`: it halves the viewport, and half of a phone-sized one is narrower than any zoom level produces.
7. **Keyboard trap exits.** When the tab pass found a focus cycle, the standard exit keys are tried. They can dismiss an overlay, which is why everything that measures the page as loaded has already run.
8. **Disclosure operability**, last, because it operates the page's own controls.

Before each step from 5 onwards the runner checks that the page is still the document it started on, and reloads it if not.

The moving content audit sets the floor on a run: five seconds, however small the page. Measured on three of this package's end-to-end pages with Puppeteer, browser launch included:

| Page | The six newest checks skipped | All audits | All but `moving-content` |
| --- | --- | --- | --- |
| A storefront listing, 40 tab stops | 4.6s | 10.4s | 5.4s |
| A sign-in form | 1.7s | 7.6s | 2.5s |
| A page of dialogs | 1.9s | 7.7s | 2.7s |

### Audits that found nothing

Every audit that ran is accounted for. One with nothing to check on the page is in `inapplicable`; one that checked and found nothing is in `passes`, with a node for each element it checked where it checks elements one by one. Three results are the exception and are simply absent when there is nothing to say: `focus-order`, which never reports a pass because geometry cannot show that an order preserves meaning; `focus-color-only`, which only applies to elements whose focus indicator is a change of one colour; and `focus-indicator-contrast`, which only applies to indicators whose colours it could attempt to measure. Because audits that could not finish are always reported (below), an absent `focus-order` means it ran and saw nothing unusual in the part of the page the keyboard pass reached. That is the whole page unless the pass ended at a limit, which the runner warns about.

### Audits that could not reach a conclusion

An audit that ran but cannot say anything about the page is reported in `incomplete` under its own id, with no nodes, the tag `a11y-pulse.audit-inconclusive` beside its usual tags, and the reason at the end of `description`. This happens when the keyboard pass ended before the whole page had been tabbed through (`keyboard-trap`, `keyboard-reachability`, `control-without-role`), when the page navigated away or the pass failed part of the way through (`focus-order` as well), or when a focus cycle changed or could not be found again while it was being tested (`keyboard-trap`). A pass that only stopped at its time or tab-press limit does not make `focus-order` inconclusive: it judges the stops that were reached.

```js
const inconclusive = results.incomplete.filter((audit) =>
	audit.tags.includes("a11y-pulse.audit-inconclusive"),
);
```

### Audits that could not run

One audit failing does not lose the others. An audit that throws, runs out of time, or is skipped because the page could not be restored is reported in `incomplete` under its own id, with no nodes, the tag `a11y-pulse.audit-failed`, and the reason in `description`. It is never reported as a pass. If axe-core itself fails, it is reported the same way under the id `axe-core`.

```js
const notCompleted = results.incomplete.filter((audit) =>
	audit.tags.includes("a11y-pulse.audit-failed"),
);
```

## Known false positives

Each audit documents the cases where it reports a problem that is not one, and which bucket they land in:

- [Filename or placeholder alt text](../filename-alt-text-audit#known-false-positives)
- [Orphaned tab roles](../orphaned-tab-roles-audit#known-false-positives)
- [Code or placeholder accessible names](../suspicious-accessible-name-audit#known-false-positives)
- [Focus appearance](../focus-appearance-audit#known-false-positives)
- [Focus not obscured](../focus-not-obscured-audit#known-false-positives)
- [Context change on focus](../context-change-on-focus-audit#known-false-positives)
- [Keyboard trap](../keyboard-trap-audit#known-false-positives)
- [Focus order](../focus-order-audit#known-false-positives)
- [Skip link activation](../skip-link-audit#known-false-positives)
- [Reflow](../reflow-audit#known-false-positives)
- [Text spacing](../text-spacing-audit#known-false-positives)
- [Focus indicator contrast](../focus-appearance-audit#focus-indicator-contrast)
- [Unreachable controls](../unreachable-controls-audit#known-false-positives)
- [Resize text](../resize-text-audit#known-false-positives)
- [Moving content](../moving-content-audit#known-false-positives)
- [Paste blocking](../paste-blocking-audit#known-false-positives)
- [Disclosure operability](../disclosure-operability-audit#known-false-positives)

## JSON output

Audit evidence is attached to the node it belongs to, as a single axe-core check under `any`. Its `data` carries what the audit measured, under the field names the audit's own result uses, so a report can be acted on without re-running the audit. Screenshots are optional fields of `data` (they are capped per audit), carried as raw `Uint8Array`s. `toJson` is a thin `JSON.stringify` wrapper that encodes those as base64:

```json
{
  "url": "https://who.likesdogs.nz/",
  "violations": [
    {
      "id": "reflow",
      "help": "Content must reflow without two-dimensional scrolling",
      "impact": "serious",
      "tags": ["wcag21aa", "wcag1410", "cat.structure"],
      "nodes": [
        {
          "target": ["#wide"],
          "html": "<div id=\"wide\">",
          "failureSummary": "Element is overflowing the viewport by 580px…",
          "any": [
            {
              "id": "reflow-evidence",
              "impact": "serious",
              "message": "Element overflows the 320px reflow viewport",
              "data": {
                "reason": "element-overflow",
                "overflowPx": 580,
                "rect": { "x": 0, "y": 412, "width": 900, "height": 40 },
                "viewport": { "width": 320, "height": 800 },
                "documentOverflowPx": 580,
                "screenshot": "iVBORw0KGgoAAAANSUhEUg…"
              }
            }
          ],
          "all": [],
          "none": []
        }
      ]
    }
  ]
}
```

### Evidence `data` by audit

Fields an audit did not record are left out. Three names mean the same thing wherever they appear: `reason` is the audit's own code for why the element was flagged, `rect` is a box in CSS pixels relative to the document, and `tabIndex` is the element's position in the tab sequence, counting from 1. Each audit's README documents the rest.

| Check `id` | `data` |
| --- | --- |
| `reflow-evidence` | `reason`, `overflowPx`, `rect`, `overflowing` (what is too wide inside a `scrolling-container`), `viewport`, `documentOverflowPx`, `screenshot` |
| `text-spacing-evidence` | `kind`, `axis`, `metrics` (overflow and overlap before and after), `rect`, `clippedBy`, `clippedByHtml`, `affectedCount`, `overlapsWith`, `overlapsWithHtml`, `overlapRect`, `screenshot` |
| `focus-appearance-evidence` | `tabIndex`, `detectionMethod`, `needsReview`, `changedProperties`, `indicatorOn`, `measuredOn`; on a failure also `focusedScreenshot`, `unfocusedScreenshot`, `focusedStyles`, `unfocusedStyles` |
| `focus-color-only-evidence` | `tabIndex`, `property`, `unfocusedColor`, `focusedColor`, `contrastRatio`, `backgroundColor`, `focusedScreenshot`, `unfocusedScreenshot` |
| `focus-not-obscured-evidence` | `tabIndex`, `foundBy`, `coveredFraction`, `fullyObscured`, `offscreen`, `opacity`, `obscuredBy` (`selector`, `html`, `rect`, `position`), `rect`, `measured`, `notPainted`, `screenshot` |
| `context-change-on-focus-evidence` | `tabIndex`, `findings` (every change focusing the element set off: `kind`, `bucket`, and `url`, `from`, `to`, `form`, `redirectedTo`, `delayed` where they apply), `screenshot`. A change the page made during the pass that no focused element could be shown to have caused (a timed redirect, a background script) is one `incomplete` node on `html`, with `findings` and `unattributed: true` |
| `keyboard-trap-evidence` | `outcome`, `inconclusiveReason`, `ring`, `ringSize`, `sampledRing`, `excludedCount`, `escapedVia`, `roundsAttempted`, `keysTried`, `attempts` (each key pressed, from where, and where focus landed), `dialog` |
| `focus-order-evidence` | `kind`, `direction`, `distance`, `steps`, `from` and `to` (`selector`, `tabIndex`, `rect`, `positiveTabindex`), `totalTransitions` |
| `skip-link-activation-evidence` | `fragment`, `linkText`, `tabIndex`, `reason`, `target`, `focusAfterEnter`, `focusAfterTab`, `screenshot` |
| `orphaned-tab-roles-evidence` | `role`, `reason`, `tablist`, `controls` (each `aria-controls` id and what it names), `href` |
| `filename-alt-text-evidence` | `altText`, `altTextSource`, `reason`, `matchedSource`, `screenshot` |
| `suspicious-accessible-name-evidence` | `name`, `nameSource`, `role`, `reason`, `matched`, `labelSelector`, `criterion` |
| `focus-indicator-contrast-evidence` | `tabIndex`, `ratio` (against the color next to the indicator), `stateChangeRatio` (against the unfocused state, for information), `method`, `property`, `indicatorColor`, `adjacentColor`, `comparedAgainst`, `reason` (why the ratio is null), `focusedScreenshot`, `unfocusedScreenshot` |
| `unreachable-controls-evidence` | `reason`, `verdict`, `text`, `listeners`, and the audit's other signals for why the element was taken to be a control; for `control-without-role` also the role the browser exposes |
| `resize-text-evidence` | `kind`, `axis`, `metrics`, `rect`, `clippedBy`, `clippedByHtml`, `clippedByRect`, `affectedCount`, `noBaseline`, `overlapsWith`, `overlapsWithHtml`, `overlapRect`, `viewportMeta`, `screenshot` |
| `moving-content-evidence` | `motion`, `detectedBy`, `reason`, `observedMs`, `rect`, `animations`, `pauseControl`, `pausesOn`, `reducedMotion`, `screenshot`, `laterScreenshot` |
| `paste-blocking-evidence` | `kind`, `signals`, `blocked`, `detectedBy`, `autocomplete`, `boxes`, `partialProbe`, `suppressed` |
| `disclosure-operability-evidence` | `signals`, `expanded`, `controls`, `keysTried`, `attempts` (what each key press changed), `pointer`, `openedOnFocus`, `restored` |

## Releasing

Releases are managed in the [A11y-Pulse/audits](https://github.com/A11y-Pulse/audits) monorepo with [Changesets](https://github.com/changesets/changesets). Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC). There is no long-lived `NPM_TOKEN`.

### Ship a change

1. Open a PR against `main` that includes a changeset (`npx changeset`) naming `@a11y-pulse/audit-runner`.
2. After merge, the Release workflow opens a Version PR. Merging that PR publishes this package to npm and tags `@a11y-pulse/audit-runner@<version>`.

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
