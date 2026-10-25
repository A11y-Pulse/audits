# @a11y-pulse/filename-alt-text-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/filename-alt-text-audit)](https://www.npmjs.com/package/@a11y-pulse/filename-alt-text-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit that flags image alt text that is not a text alternative at all, under [**WCAG 2.2: 1.1.1 Non-text Content**](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content). CMSes and upload widgets often default an image's `alt` to its filename, and authors type "image" to silence a required field. Both pass every presence check, axe-core's `image-alt` included, while a screen reader announces "IMG underscore 4032 dot jpg". WCAG documents this as failure [F30](https://www.w3.org/WAI/WCAG22/Techniques/failures/F30).

Alt text that is exactly the filename of one of the image's own sources is a failure. Alt text that only looks like a filename or placeholder is reported for a human to check, since a product code or a terse caption can look the same. Whether alt text that passes is accurate is out of scope.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/filename-alt-text-audit @a11y-pulse/browser-adaptor puppeteer
```

## Quickstart

```js
import { runFilenameAltTextAudit } from "@a11y-pulse/filename-alt-text-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const result = await runFilenameAltTextAudit(new PuppeteerAdaptor(page));

console.log(result.summary);
// { checked: 12, failed: 1, needsReview: 1, passed: 10, unchecked: 0 }

console.log(result.failed);
// [
//   {
//     selector: ".gallery > img:nth-of-type(3)",
//     html: '<img src="/uploads/IMG_4032.jpg" alt="IMG_4032.jpg">',
//     altText: "IMG_4032.jpg",
//     signal: "filename-match",
//     matchedSource: "https://who.likesdogs.nz/uploads/IMG_4032.jpg"
//   }
// ]

await browser.close();
```

## How it decides

The audit reads every rendered `<img>` and `<input type="image">` with alt text, including those in open shadow roots, in one call into the page. An `aria-label` takes the place of `alt`, as it does in the accessible name. Images with no alt text, `alt=""` or whitespace-only alt are left to axe-core's `image-alt`, and images named by `aria-labelledby` or hidden with `aria-hidden` are skipped.

Each image's own sources are its `src`, `currentSrc`, every `srcset` candidate and every `srcset` candidate of the `<source>` elements in its `<picture>`. A source's filename is the last segment of its path, percent-decoded. `data:` and `blob:` URLs, and segments with no extension such as an image resizer's `/_next/image`, have no filename.

| Signal | Bucket | When |
| --- | --- | --- |
| `filename-match` | `failed` | The alt text is the full filename of one of the image's own sources, ignoring case and surrounding whitespace |
| `filename-near-match` | `needsReview` | The alt text matches an own filename once the extension is dropped, or once `-`, `_` and `+` are read as spaces |
| `camera-name` | `needsReview` | The whole alt text is a camera, phone or screenshot file name: `DSC_1234`, `IMG_20240101_123456`, `PXL_…`, `GOPR…`, `Screenshot 2024-01-02 at 10.11.12` and the like |
| `filename-like` | `needsReview` | The alt text ends with an image file extension, such as a filename kept by the CMS after a CDN renamed the file |
| `placeholder` | `needsReview` | The whole alt text, ignoring trailing punctuation, is a placeholder word ("image", "photo", "logo", …) or one followed by a number ("picture 1"), a dimensions string ("300x200"), digits only, or symbols only |

The first signal that applies wins, in the order above. Placeholder words are matched against the whole alt text, never a word inside it, so "Photo of the packed tent" passes.

### Placeholder languages

The placeholder words applied are English plus the language in the page's `<html lang>`, since English CMS defaults turn up in every locale. Lists ship for English, Swedish, German, French, Spanish, Italian, Dutch, Norwegian, Danish and Finnish, and are exported as `PLACEHOLDER_WORDS`.

## Browser support

| Adaptor | Browser | Supported |
| --- | --- | --- |
| Puppeteer | Chrome | Yes |
| Playwright | Chromium | Yes |
| Playwright | WebKit | Yes |
| Playwright | Firefox | Yes |

## Options

| Option | Type | Default | Description |
| --- | --- | --- | --- |
| `imageLimit` | `number` | `2000` | Max images to check. Images past the limit are counted in `summary.unchecked`. |
| `reportLimit` | `number` | `10` | Max images to list in each of `failed`, `needsReview` and `passed`. The summary still counts every image. |
| `screenshotLimit` | `number` | `10` | Max listed `failed` and `needsReview` images to screenshot, `failed` first. |

## Result shape

```ts
type FilenameAltTextImage = {
  selector: string;
  html: string;
  /** The `aria-label`, or the `alt` when there is no `aria-label`, trimmed. */
  altText: string;
  signal:
    | "filename-match"
    | "filename-near-match"
    | "camera-name"
    | "filename-like"
    | "placeholder"
    | null;
  /** The source URL whose filename the alt text matches, for the filename signals. */
  matchedSource: string | null;
  /**
   * PNG bytes of the image, clipped and padded. Only captured for `failed` and
   * `needsReview` images, and omitted past `screenshotLimit`.
   */
  screenshot?: Uint8Array;
};

type FilenameAltTextResult = {
  failed: FilenameAltTextImage[];
  needsReview: FilenameAltTextImage[];
  passed: FilenameAltTextImage[];
  summary: {
    checked: number;
    failed: number;
    needsReview: number;
    passed: number;
    unchecked: number;
  };
};
```

To take a screenshot, the audit scrolls each image into view and waits up to 2 seconds for one that has not loaded, loading a lazy image straight away. The page is scrolled back to where it was afterwards. The audit does not wait for a script to swap in the image's real source when it comes into view.

`classifyAltText(alt, sources, placeholders)`, the pure classifier behind the audit, is exported with `placeholderWordsFor(lang)`, `parseSrcset` and `filenameOf`, for checking alt text recorded elsewhere.

## Limitations

- **Attributes, not the accessible name.** The audit reads `alt` and `aria-label`. Names from `aria-labelledby`, `title`, `role="img"` composites, inline `<svg>` and CSS background images are not checked.
- **Presence and quality are out of scope.** Missing alt text is axe-core's `image-alt`. Fluent but wrong alt text, keyword stuffing and filenames that read like descriptions ("banner-final-v2-approved") pass.
- **Listed languages only.** Placeholder words in other languages, misspellings and filler such as "image of an image" pass.
- **Main document only.** Images inside iframes and closed shadow roots are not reached.

## Known false positives

Cases where the audit reports a problem that is not one. Each says which bucket it lands in: `incomplete` asks for a human to check, `violations` claims a failure.

In the A11y Pulse audit runner, `failed` is reported in `violations` and `needsReview` in `incomplete`.

- **Descriptive filenames** (`incomplete`). A file named `sunset-over-stockholm.jpg` with the alt text "Sunset over Stockholm" may describe the image well. It is a `filename-near-match`, never a failure.
- **Product codes and model names** (`incomplete`). A product called "DSC 1000" matches the camera pattern. Names with anything after the number, such as "IMG-2000 Pro", do not.
- **Symbols that carry meaning** (`incomplete`). A star rating with the alt text "★★★★☆", or a lone emoji, is symbols only.
- **Short alt text that is accurate** (`incomplete`). "Logo" on a logo-design portfolio, or "Photo" crediting a photo column, are placeholder words.

## License

Released under the [PolyForm Shield License 1.0.0](./LICENSE.md), in plain language:

- **Source-available.** The source is public and you can read, fork, and modify it.
- **Permitted for non-competing use.** You can use this package freely in your own products and services, as long as they don't compete with A11y Pulse.
- **Competing products are forbidden.** You may not use this software (or a modified version of it) to build a product or service that competes with A11y Pulse's accessibility monitoring offering.

See [LICENSE.md](./LICENSE.md) for the full, binding terms.
