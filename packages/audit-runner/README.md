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

`--engine playwright` drives the page with Playwright rather than Puppeteer, and `--browser` then picks the engine to launch:

```bash
npx @a11y-pulse/audit-runner https://who.likesdogs.nz/ --engine playwright --browser webkit
```

| Option | Values | Default |
| --- | --- | --- |
| `--engine` | `puppeteer`, `playwright` | `puppeteer` |
| `--browser` | `chromium`, `firefox`, `webkit` | `chromium` |

`--browser` requires `--engine playwright`. Firefox and WebKit tab in their own order and apply their own `:focus-visible` heuristics, so results will not match Chromium's element for element.

The exit code reports whether the run itself succeeded, not whether the page passed: a page with violations still exits `0`. A bad URL or a crashed browser exits `1`, with the message on stderr.

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
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const results = await runAllAudits({
	browser: new PuppeteerAdaptor(page),
	reflow: new ReflowAdaptor(page),
	textSpacing: new TextSpacingAdaptor(page),
});

console.log(results.violations.map((audit) => audit.id));
// ['color-contrast', 'focus-appearance', 'reflow']

await browser.close();
```

`runAllAudits(adaptors, options?)` takes one adaptor per audit interface, all three wrapping the same already-loaded page. Swap in the `PlaywrightAdaptor` from each of those subpaths to run the same audits under Playwright; nothing else changes.

`options` takes each audit's own options object under its key, all optional. `axe` is passed straight to `axe.run()`:

```js
const results = await runAllAudits(adaptors, {
	axe: { runOnly: ["wcag2a", "wcag2aa"] },
	focusAppearance: { elementLimit: 50, skipStyleCheck: true },
	reflow: { screenshotLimit: 3 },
});
```

## Results

The return value is in the shape of [axe-core's results object](https://github.com/dequelabs/axe-core/blob/develop/doc/API.md#results-object). The A11y Pulse audit results included with the following audit IDs:

| Audit | `id` |
| --- | --- |
| Focus appearance (WCAG 2.4.7) | `focus-appearance` |
| Focus not obscured (WCAG 2.4.11) | `focus-not-obscured` |
| Context change on focus (WCAG 3.2.1) | `context-change-on-focus` |
| Skip link activation (WCAG 2.4.1) | `skip-link-activation` |
| Reflow (WCAG 1.4.10) | `reflow` |
| Text spacing (WCAG 1.4.12) | `text-spacing` |

## JSON output

Audit evidence is attached to the node it belongs to, as a single axe-core check under `any`, carrying PNG bytes as raw `Uint8Array`s. `toJson` is a thin `JSON.stringify` wrapper that encodes those as base64:

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
              "data": { "screenshot": "iVBORw0KGgoAAAANSUhEUg…" }
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
