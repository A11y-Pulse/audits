# @a11y-pulse/orphaned-tab-roles-audit

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/orphaned-tab-roles-audit)](https://www.npmjs.com/package/@a11y-pulse/orphaned-tab-roles-audit)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

An accessibility audit that checks the ARIA tab contract that axe-core does not: that every `tab` has a `tabpanel` and every `tabpanel` has a `tab`. axe-core's `aria-required-parent` and `aria-required-children` check that tabs sit in a tablist, but a tab with no panel anywhere, or a tab panel nothing controls, passes every axe-core rule. A screen reader announces such a tab as "tab, 1 of 15", promising in-page panels that do not exist. The most common case is navigation links given `role="tab"` by a component library, which take the user to another page when activated.

WCAG names no failure technique for this. Following axe-core's convention for ARIA structure, results are mapped to [**WCAG 2.2: 1.3.1 Info and Relationships**](https://www.w3.org/WAI/WCAG22/Understanding/info-and-relationships) and [**4.1.2 Name, Role, Value**](https://www.w3.org/WAI/WCAG22/Understanding/name-role-value), on the reading that a role the element cannot live up to misinforms assistive technology.

This audit was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/orphaned-tab-roles-audit @a11y-pulse/browser-adaptor puppeteer
```

## Quickstart

```js
import { runOrphanedTabRolesAudit } from "@a11y-pulse/orphaned-tab-roles-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import puppeteer from "puppeteer";

const browser = await puppeteer.launch();
const page = await browser.newPage();
await page.goto("https://who.likesdogs.nz/");

const result = await runOrphanedTabRolesAudit(new PuppeteerAdaptor(page));

console.log(result.summary);
// { checked: 5, failed: 3, needsReview: 2, passed: 0 }

console.log(result.failed[0]);
// {
//   selector: "#nav-dogs",
//   html: '<a id="nav-dogs" role="tab" href="/dogs">',
//   role: "tab",
//   finding: "tab-used-as-link"
// }

await browser.close();
```

## How it decides

The audit reads every element whose role is `tab` or `tabpanel` in one call into the page, hidden ones included, since an inactive tab's hidden panel is the correct pattern. A tab and a panel are associated when the tab's `aria-controls` names the panel, or the panel's `aria-labelledby` names the tab.

For each tab, the first rule that applies:

| Finding | Bucket | When |
| --- | --- | --- |
| none | `passed` | The tab is associated with a tab panel |
| `tab-used-as-link` | `failed` | The tab is, or sits inside, a link to another document. Fragment links (`#panel`), same-page URLs and `javascript:` links do not count |
| `controls-not-a-tabpanel` | `needsReview` | `aria-controls` points at an element that is not a tab panel |
| `tab-without-panel` | `failed` | The page has no tab panels, or the tab has no `aria-controls` and every tab panel on the page is associated with another tab |
| `association-unverifiable` | `needsReview` | Anything else: tab panels without an association exist, or the tab's `aria-controls` names a panel that is not in the page |

For each tab panel:

| Finding | Bucket | When |
| --- | --- | --- |
| none | `passed` | The panel is associated with a tab |
| `tabpanel-without-tab` | `failed` | The page has no tabs, or every tab on the page is associated with another panel or has an `aria-controls` that points only at tab panels or at nothing mounted yet, so each already has a panel of its own |
| `association-unverifiable` | `needsReview` | Some tab declares no association, so it may be this panel's |

The failures never depend on guessing which panel belongs to which tab, only on there being none left over for it. That is also why the check is document-wide rather than per tablist: an unwired tab widget next to a wired one fails, because the wired widget's panels are all spoken for.

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
| `reportLimit` | `number` | `10` | Max elements to list in each of `failed`, `needsReview` and `passed`. The summary still counts every element. |

## Result shape

```ts
type OrphanedTabRolesElement = {
  selector: string;
  html: string;
  role: "tab" | "tabpanel";
  finding:
    | "tab-used-as-link"
    | "tab-without-panel"
    | "tabpanel-without-tab"
    | "controls-not-a-tabpanel"
    | "association-unverifiable"
    | null;
};

type OrphanedTabRolesResult = {
  failed: OrphanedTabRolesElement[];
  needsReview: OrphanedTabRolesElement[];
  passed: OrphanedTabRolesElement[];
  summary: {
    checked: number;
    failed: number;
    needsReview: number;
    passed: number;
  };
};
```

`classifyTabRoles(elements)`, the pure classifier behind the audit, is also exported.

## Limitations

- **Association, not pairing.** A tab whose `aria-controls` names another tab's panel passes: the audit checks that an association exists, not that it is the right one.
- **Markup, not behaviour.** Arrow-key navigation, `aria-selected` and whether activating a tab shows its panel are not tested.
- **Light DOM and attributes only.** Tabs inside shadow roots or iframes, and custom elements that take their role from `ElementInternals` rather than a `role` attribute, are not reached.
- **Tabs outside a tablist** are axe-core's `aria-required-parent`. Such a tab is still checked for a panel here, so a navigation link with `role="tab"` and no tablist can be reported by both.

## Known false positives

Cases where the audit reports a problem that is not one. Each says which bucket it lands in: `incomplete` asks for a human to check, `violations` claims a failure.

In the A11y Pulse audit runner, `failed` is reported in `violations` and `needsReview` in `incomplete`.

- **Widgets wired up after load** (`incomplete`). A script that adds `aria-controls` when a tab is first activated leaves its tabs and panels without an association when the audit runs.
- **Lazily mounted panels** (`incomplete`). A tab whose `aria-controls` names a panel the page has not rendered yet is reviewed rather than passed. Only a page with no tab panels at all fails it.
- **Tabs that control a region** (`incomplete`). A tab whose `aria-controls` names a wrapper without `role="tabpanel"` may still work. The tab panels beside it are reviewed too, since the wrapper may hold one of them.

## License

Released under the [PolyForm Shield License 1.0.0](./LICENSE.md), in plain language:

- **Source-available.** The source is public and you can read, fork, and modify it.
- **Permitted for non-competing use.** You can use this package freely in your own products and services, as long as they don't compete with A11y Pulse.
- **Competing products are forbidden.** You may not use this software (or a modified version of it) to build a product or service that competes with A11y Pulse's accessibility monitoring offering.

See [LICENSE.md](./LICENSE.md) for the full, binding terms.
