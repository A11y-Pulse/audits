# @a11y-pulse/text-spacing-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/text-spacing-audit)](https://www.npmjs.com/package/@a11y-pulse/text-spacing-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit for [**WCAG 1.4.12 Text Spacing**](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing.html). It injects the success criterion's spacing overrides (the same stylesheet used by Steve Faulkner's [text spacing bookmarklet](https://codepen.io/stevef/full/YLMqbo)), measures candidate text containers, and reports text that is newly clipped or newly overlapping. It is framework-agnostic and can run in any environment that can evaluate JavaScript in a page, such as Puppeteer, Playwright, or Selenium.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/text-spacing-audit puppeteer
```

`puppeteer` is an optional peer dependency. It is only required if you use the bundled [Puppeteer adaptor](#adaptors). Other frameworks can supply their own adaptor without installing Puppeteer at all.

## Quickstart

```js
import { runTextSpacingAudit } from "@a11y-pulse/text-spacing-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/text-spacing-audit/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const result = await runTextSpacingAudit(new PuppeteerAdaptor(page));

console.log(result.summary);
// { clipped: 0, truncationIncreased: 0, overlaps: 0 }

console.log(result.findings);
// []

await browser.close();
```

See [`examples/puppeteer`](./examples/puppeteer) for a complete, runnable example.

## What it checks

WCAG 1.4.12 requires that content and functionality survive when a user sets:

- line height to at least 1.5 times the font size
- spacing following paragraphs to at least 2 times the font size
- letter spacing to at least 0.12 times the font size
- word spacing to at least 0.16 times the font size

The audit does not require authors to *use* those values. It checks that the page still shows its text when they are applied.

Static tools such as axe-core's `avoid-inline-spacing` only flag inline `!important` spacing declarations that would *block* a user override. This audit applies the override and looks at the outcome. Leave axe's rule enabled: the two checks are complementary, and inline `!important` spacing is left to axe because a stylesheet `!important` cannot override it.

## Bookmarklet methodology

The procedure matches the bookmarklet used by the WCAG community:

1. Wait for `document.fonts.ready` and freeze CSS animations/transitions so motion does not look like clipping.
2. Collect visible text containers (elements with a non-whitespace direct text node), capped at `candidateLimit`.
3. Inject:

```css
* { line-height: 1.5 !important; letter-spacing: 0.12em !important; word-spacing: 0.16em !important; }
p { margin-bottom: 2em !important; }
```

4. Re-measure the same elements and classify:
   - **clipped** (the only violation class): overflow `hidden`/`clip`, content fitted at baseline, then exceeded the clip box by more than `clipTolerancePx`.
   - **truncation-increased** (incomplete): already truncated (ellipsis / line-clamp) and overflow grew.
   - **overlap** (incomplete): nearby text rects that did not intersect at baseline and now do. Sticky and fixed elements are skipped.
5. Remove the injected styles and verify a sample of rects match the baseline. A mismatch sets `restored: false` but never throws.

Growth and reflow without clipping are not findings. That is the correct response to a spacing override.

## Options

The following options can be passed to `runTextSpacingAudit` as `TextSpacingOptions`:

| Option             | Type     | Default | Description                                                                                          |
| ------------------ | -------- | ------- | ---------------------------------------------------------------------------------------------------- |
| `candidateLimit`   | `number` | `500`   | Max visible text containers to measure, in document order.                                           |
| `clipTolerancePx`  | `number` | `2`     | Overflow in px that must be exceeded before a clip or truncation increase counts.                    |
| `settleMs`         | `number` | `200`   | Extra wait after two animation frames for layout to settle after injecting or removing styles.       |

## Result shape

`runTextSpacingAudit` resolves to a `TextSpacingResult`:

```ts
type TextSpacingResult = {
  findings: Array<{
    selector: string;
    html: string;
    kind: "clipped" | "truncation-increased" | "overlap";
    metrics: { beforeOverflowPx: number; afterOverflowPx: number };
    overlapsWith?: string;
  }>;
  candidateCount: number;
  restored: boolean;
  summary: {
    clipped: number;
    truncationIncreased: number;
    overlaps: number;
  };
};
```

`candidateCount` is the number of stable (non-moving) text containers that were measured. `clipped` findings are the confident loss-of-content signal. `truncation-increased` and `overlap` are heuristic and should be treated as incomplete, not violations.

## Adaptors

The audit itself is framework-agnostic: it drives a page through an **adaptor**, a small interface of primitives that the audit calls without knowing which browser automation library is behind it.

The package ships one implementation, `PuppeteerAdaptor`, backed by a Puppeteer `Page`. Other environments (Playwright, Selenium, WebDriver) can be supported by implementing the same interface, exported as `TextSpacingAuditAdaptor` (aliased as `BrowserAdaptor` from the package root).

### `TextSpacingAuditAdaptor` / `BrowserAdaptor`

| Method                  | Description                                                                                               |
| ----------------------- | --------------------------------------------------------------------------------------------------------- |
| `evaluate(fn, ...args)` | Runs `fn` in the page context, passing in any serialisable `args`, and returns its result.               |

### Writing a new adaptor

Implement `TextSpacingAuditAdaptor` from `@a11y-pulse/text-spacing-audit` (or its `BrowserAdaptor` alias) against your automation library's page/session object, then pass an instance to `runTextSpacingAudit`:

```ts
import type { TextSpacingAuditAdaptor } from "@a11y-pulse/text-spacing-audit";

class MyFrameworkAdaptor implements TextSpacingAuditAdaptor {
  // ...implement evaluate for your framework
}
```

Use [`src/adaptors/puppeteer.ts`](./src/adaptors/puppeteer.ts) as a reference implementation. It is a thin `page.evaluate` wrapper.

## Limitations

- **Overlap is incomplete, never a violation.** Overlap detection is heuristic (nearby pairs only; sticky/fixed skipped). Decorative overlaps and stacking contexts can still produce noise.
- **Inline `!important` spacing is left to axe.** A user stylesheet cannot beat an inline `!important` declaration. axe-core `avoid-inline-spacing` covers that blocker; this audit cannot restyle those elements.
- **Already-clipped content is not attributed to the override.** Only new overflow inside a clipping box is reported as `clipped`.
- **Intentional truncation.** Single-line ellipsis and line-clamp that were already truncating route to `truncation-increased` (incomplete), not `clipped`.
- **Motion.** CSS animations are frozen before the baseline. Elements whose rects move between two samples (JS-driven motion) are excluded.
- **Main frame only.** Text in canvas, images, or cross-origin iframes is invisible to the audit. Closed shadow roots are opaque; open shadow roots are walked.
- **Paragraph spacing is `p` only.** That matches the bookmarklet. Pages that use `div`s as paragraphs are under-tested.
- **Loss of functionality** without a geometric symptom (for example a click target covered by a transparent sibling) is not detected.
- **Forcing `line-height: 1.5`** can reduce spacing on a page that already exceeds the minimum. That is faithful to the bookmarklet. Clipping under 1.5 still implies clipping under anything larger.

## Releasing

Releases are managed in the [A11y-Pulse/audits](https://github.com/A11y-Pulse/audits) monorepo with [Changesets](https://github.com/changesets/changesets). Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC). There is no long-lived `NPM_TOKEN`.

### Ship a change

1. Open a PR against `main` that includes a changeset (`npx changeset`) naming `@a11y-pulse/text-spacing-audit`.
2. After merge, the Release workflow opens a Version PR. Merging that PR publishes this package to npm and tags `@a11y-pulse/text-spacing-audit@<version>`.

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
