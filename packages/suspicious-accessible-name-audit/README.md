# @a11y-pulse/suspicious-accessible-name-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/suspicious-accessible-name-audit)](https://www.npmjs.com/package/@a11y-pulse/suspicious-accessible-name-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit that flags buttons, links, form fields, labelled landmarks, dialogs and iframes whose accessible name is code rather than a name. Every presence check, axe-core's `button-name`, `label` and `frame-title` included, passes `<input aria-label="quantity-selector">`, `<button aria-label="undefined">` and `<iframe title="{{title}}">`, while a screen reader user hears a class name, a JavaScript value or an unrendered template.

The success criterion depends on the element:

- [**WCAG 2.2: 1.1.1 Non-text Content**](https://www.w3.org/WAI/WCAG22/Understanding/non-text-content) for icon-only buttons and links, and for iframes, whose name stands in for what they show (failure [F30](https://www.w3.org/WAI/WCAG22/Techniques/failures/F30)).
- [**2.4.4 Link Purpose (In Context)**](https://www.w3.org/WAI/WCAG22/Understanding/link-purpose-in-context) for links with no surrounding text that could give their purpose.
- [**2.4.6 Headings and Labels**](https://www.w3.org/WAI/WCAG22/Understanding/headings-and-labels) for everything else. A control can have a name, and so pass 4.1.2 Name, Role, Value, while its label still fails to describe its purpose.

A name that is the element's own `id`, `class`, `name` or `data-*` value, or a leftover script value, template token or placeholder, is a failure. A name that only looks like an identifier or a numbered placeholder is reported for a human to check, as is a name that repeats the element's role ("Disclaimer button"), which is best practice rather than a WCAG failure. Whether a fluent name describes the element's purpose is out of scope.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/suspicious-accessible-name-audit @a11y-pulse/browser-adaptor puppeteer
```

## Quickstart

```js
import { runSuspiciousNameAudit } from "@a11y-pulse/suspicious-accessible-name-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const result = await runSuspiciousNameAudit(new PuppeteerAdaptor(page));

console.log(result.summary);
// { checked: 48, failed: 1, needsReview: 1, passed: 46, unchecked: 0 }

console.log(result.failed);
// [
//   {
//     selector: "#quantity",
//     html: '<input id="quantity" class="quantity-selector" type="number" aria-label="quantity-selector">',
//     name: "quantity-selector",
//     nameSource: "aria-label",
//     role: "spinbutton",
//     signal: "attribute-match",
//     evidence: "class",
//     criterion: "2.4.6"
//   }
// ]

await browser.close();
```

## How it decides

The audit reads every rendered element with one of these roles, including those in open shadow roots, in one call into the page: `button`, `link`, `textbox`, `searchbox`, `combobox`, `listbox`, `checkbox`, `radio`, `switch`, `slider`, `spinbutton`, `tab` and the `menuitem` roles, `dialog` and `alertdialog`, a landmark labelled with `aria-label` or `aria-labelledby`, and `<iframe>`. Images, `role="img"` and `<input type="image">` are left to [`@a11y-pulse/filename-alt-text-audit`](../filename-alt-text-audit). Elements with no name are left to axe-core, and elements hidden with `aria-hidden` are skipped.

The name is computed in this order, and the step that supplied it is reported as `nameSource`: `aria-labelledby`, `aria-label`, `<label>`, the `value` of a button input, the element's own text for roles named by their content, `title`, then `placeholder`. Text inside `aria-hidden` or unrendered descendants is left out, except in an element referenced by `aria-labelledby` that is hidden itself.

| Signal | Bucket | When |
| --- | --- | --- |
| `artefact` | `failed` | A name from `aria-label`, `title` or `placeholder` is a leftover script value (`undefined`, `null`, `NaN`, `[object Object]`, `true`, `false`), a stock placeholder (`TODO`, `test`, `placeholder`, `banner`, `button`, `link`, …), starts with "lorem ipsum", or contains a template token (`{{…}}`, `{%…%}`, `${…}`, `<%…%>`, `#{…}`, `[[…]]`, `__…__`, `%s`, `%d`) |
| `attribute-match` | `failed` | A name from anywhere but the element's own text is, ignoring case, one of its `id`, `class` tokens, `name` or `data-*` values, and that value contains `-`, `_`, a digit or an internal capital, or is a placeholder stem |
| `identifier-pattern` | `needsReview` | The whole name is kebab-case with three or more words (`add-to-cart-button`), snake_case (`product_card_cta`), or camelCase or PascalCase with three or more words (`addToCartButton`), optionally ending in digits |
| `placeholder-suffix` | `needsReview` | The whole name is a placeholder stem (banner, image, icon, btn, item, slide, card, tile, …) followed by one to three digits: `banner1`, `btn-3`, `item 4` |
| `role-word` | `needsReview` | A name from `aria-label`, `title` or `placeholder` ends with the word for the element's role ("Disclaimer button", "custom checkbox"), or a link's name ends with the word for a button |

The first signal that applies wins, in the order above. `artefact` and `role-word` only look at names an author typed into an attribute that sighted users never see: a button whose visible text is "Test", or a link reading "Report a broken link", is a matter of content rather than naming.

The `criterion` of each element is `1.1.1`, `2.4.4`, `2.4.6`, or null for a role word, as described at the top. A link has surrounding text when it has an `aria-describedby`, or its paragraph, list item or table cell holds more text than the link.

### Role-word languages

Role words are matched in the language of the element's nearest `lang` attribute. Lists ship for English, Swedish and Norwegian, and are exported as `ROLE_WORDS`. Elements in other languages, or with no `lang`, use the English list.

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
| `elementLimit` | `number` | `2000` | Max named elements to check. Elements past the limit are counted in `summary.unchecked`. |
| `reportLimit` | `number` | `10` | Max elements to list in each of `failed`, `needsReview` and `passed`. The summary still counts every element. |
| `vocabulary` | `VocabularyOverride` | built-in English words | Words for names in another language, extending or replacing the built-in lists. See [Vocabulary](#vocabulary). |

### Vocabulary

Pages in other languages can be checked with their own words. `vocabulary` takes three optional lists, and `mode` decides how they combine with the built-in English ones:

- `artefacts`: whole names that are leftover values, such as `"ungültig"`.
- `placeholderStems`: stems matched with a number after them, such as `"bild"` for `"bild3"`.
- `roleWords`: words by computed role, such as `{ button: ["knapp"] }`, applied to every page language.

`mode: "extend"` (the default) adds the words to the built-in ones. `mode: "replace"` uses only the words given, and a list left out keeps its built-in words.

```ts
await runSuspiciousNameAudit(adaptor, {
	vocabulary: {
		mode: "extend",
		artefacts: ["ungültig"],
		placeholderStems: ["bild"],
		roleWords: { button: ["knapp"], link: ["länk"] },
	},
});
```

`resolveVocabulary(override)` builds the same lookup for `classifyName`.

## Result shape

```ts
type SuspiciousNameElement = {
  selector: string;
  html: string;
  /** The accessible name, whitespace-collapsed. */
  name: string;
  nameSource:
    | "aria-labelledby"
    | "aria-label"
    | "label"
    | "value"
    | "content"
    | "title"
    | "placeholder";
  /** The computed role, or `iframe` for an `<iframe>`. */
  role: string;
  signal:
    | "artefact"
    | "attribute-match"
    | "identifier-pattern"
    | "placeholder-suffix"
    | "role-word"
    | null;
  /** The matched attribute for `attribute-match`, the matched word for `role-word`. */
  evidence: string | null;
  /** Null for best practice. */
  criterion: "1.1.1" | "2.4.4" | "2.4.6" | null;
};

type SuspiciousNameResult = {
  failed: SuspiciousNameElement[];
  needsReview: SuspiciousNameElement[];
  passed: SuspiciousNameElement[];
  summary: {
    checked: number;
    failed: number;
    needsReview: number;
    passed: number;
    unchecked: number;
  };
};
```

`classifyName(element, roleWords, vocabulary?)`, the pure classifier behind the audit, is exported with `roleWordsFor(lang)`, `resolveVocabulary(override)` and `wcagCriterion(element, signal)`, for checking names recorded elsewhere.

## Limitations

- **A minimal name computation.** The audit computes names itself rather than through the browser's accessibility tree. `aria-labelledby` chains, `<fieldset>` legends, `aria-roledescription`, CSS generated content and `aria-owns` are not followed, so a name can differ from the one a screen reader announces.
- **Code and placeholders only.** Fluent names that do not describe the element ("Disclaimer button" on a button that opens price details), names in the wrong language, and hashed identifiers that read as words (`abc123`) pass.
- **Built-in words are English.** Artefacts, placeholder stems and role words in other languages pass unless given in `vocabulary`.
- **Main document only.** Elements inside iframes and closed shadow roots are not reached.
- **Names over 300 characters** pass without being classified.

## Known false positives

Cases where the audit reports a problem that is not one. Each says which bucket it lands in: `incomplete` asks for a human to check, `violations` claims a failure.

In the A11y Pulse audit runner, `failed` is reported in `violations` and `needsReview` in `incomplete`.

- **Brand and product names shaped like identifiers** (`incomplete`). One-hump brands (`iPhone`, `PlayStation`), two-part words (`e-mail`, `T-shirt`) and product codes (`NX-500`) pass, but a lower-case three-part name such as `state-of-the-art` is an `identifier-pattern`.
- **Numbered names that are accurate** (`incomplete`). A carousel's "Slide 1" or a table toggle's "Column 2" is a `placeholder-suffix`.
- **Role words that are part of the purpose** (`incomplete`). An `aria-label` of "Toggle" on a switch, or "Search field" on a field described as such in a form's instructions, ends with the role word.
- **A code-shaped name that is also the real label** (`violations`). An `aria-label="e-mail"` on a field with `name="e-mail"` is an `attribute-match`, since the value contains a separator.

## License

Released under the [PolyForm Shield License 1.0.0](./LICENSE.md), in plain language:

- **Source-available.** The source is public and you can read, fork, and modify it.
- **Permitted for non-competing use.** You can use this package freely in your own products and services, as long as they don't compete with A11y Pulse.
- **Competing products are forbidden.** You may not use this software (or a modified version of it) to build a product or service that competes with A11y Pulse's accessibility monitoring offering.

See [LICENSE.md](./LICENSE.md) for the full, binding terms.
