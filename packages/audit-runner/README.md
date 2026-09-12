# @a11y-pulse/audit-runner

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/audit-runner)](https://www.npmjs.com/package/@a11y-pulse/audit-runner)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](./LICENSE.md)

A worked example of using every [A11y Pulse](https://www.a11ypulse.com/) accessibility audit together. It runs all audits against a single page and hands back their results unchanged, and ships a CLI that prints those results as JSON.

This package exists to be read as much as run. If you are wiring the audits into your own pipeline, [`src/run-audits.ts`](./src/run-audits.ts) is the file to copy from: it shows how to share one tab session between the keyboard-driven audits and what order to run the rest in.

It is released under the [MIT License](#license).

## Install

```bash
npm install @a11y-pulse/audit-runner
```

Unlike the individual audit packages, `puppeteer` is a regular dependency here rather than an optional peer, so the CLI works without any further setup. To drive the page with Playwright instead, install it yourself: `npm install playwright-core && npx playwright-core install`.

## CLI

```bash
npx @a11y-pulse/audit-runner https://who.likesdogs.nz/
```

Launches headless Chromium at a 1280x800 viewport, loads the URL, runs every audit, and writes the combined results to stdout as JSON. Pipe it wherever you like:

```bash
npx @a11y-pulse/audit-runner https://who.likesdogs.nz/ | jq '.audits.reflow.bucket'
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

Verified by this repo's integration suites, which run every audit against each of these engines. Unsupported and partial cases are skipped there with the reason printed alongside them.

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

const { url, audits } = await runAllAudits({
	browser: new PuppeteerAdaptor(page),
	reflow: new ReflowAdaptor(page),
	textSpacing: new TextSpacingAdaptor(page),
});

console.log(audits.reflow.bucket);
// 'violation'

console.log(audits.focusAppearance.summary);
// { checked: 12, passed: 11, failed: 1, ... }

await browser.close();
```

`runAllAudits(adaptors, options?)` takes one adaptor per audit interface, all three wrapping the same already-loaded page. Swap in the `PlaywrightAdaptor` from each of those subpaths to run the same audits under Playwright; nothing else changes.

`options` takes each audit's own options object under its key, all optional:

```js
const { audits } = await runAllAudits(adaptors, {
	focusAppearance: { elementLimit: 50, skipStyleCheck: true },
	reflow: { screenshotLimit: 3 },
});
```

## JSON output

Audit results carry PNG evidence as raw bytes (`FocusFailureEvidence.focusedScreenshot`, `ReflowOffender.screenshot`, and so on). `toJson` is a thin `JSON.stringify` wrapper that encodes those as base64 strings:

```json
{
  "url": "https://who.likesdogs.nz/",
  "audits": {
    "reflow": {
      "bucket": "violation",
      "offenders": [
        {
          "selector": "#wide",
          "overflowPx": 580,
          "reason": "element-overflow",
          "screenshot": "iVBORw0KGgoAAAANSUhEUg…"
        }
      ]
    }
  }
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
