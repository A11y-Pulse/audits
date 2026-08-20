# A11y Pulse accessibility audits

These accessibility audits have been developed by [A11y Pulse](https://www.a11ypulse.com/) to compliment and extend other accessibility testing frameworks like [axe-core](https://github.com/dequelabs/axe-core). The audits come with Puppeteer adaptors, but are written to be framework-agnostic.

Source-available accessibility audits used by [A11y Pulse](https://www.a11ypulse.com/), published as separate npm packages from this repo.

These audits are released under the [PolyForm Shield License 1.0.0](./packages/focus-appearance-audit/LICENSE.md). This means they are source-available and free to use in non-competing products. In other words, you are free to use these audits in your own internal monitoring but cannot use them as part of any monitoring service that competes with A11y Pulse.

## Packages

| Package | npm | What it checks |
| --- | --- | --- |
| [`@a11y-pulse/browser-adaptor`](./packages/browser-adaptor) | [@a11y-pulse/browser-adaptor](https://www.npmjs.com/package/@a11y-pulse/browser-adaptor) | Shared browser adaptor primitives (`BrowserAdaptor`, `PuppeteerAdaptor`) and DOM helpers (`getSelector`, `truncateHtml`) used by audit packages |
| [`@a11y-pulse/focus-appearance-audit`](./packages/focus-appearance-audit) | [@a11y-pulse/focus-appearance-audit](https://www.npmjs.com/package/@a11y-pulse/focus-appearance-audit) | [WCAG 2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible): tabs through a page and detects a visible focus indicator |
| [`@a11y-pulse/focus-not-obscured-audit`](./packages/focus-not-obscured-audit) | [@a11y-pulse/focus-not-obscured-audit](https://www.npmjs.com/package/@a11y-pulse/focus-not-obscured-audit) | [WCAG 2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum): tabs through a page and detects focused elements entirely hidden behind other content |
| [`@a11y-pulse/context-change-on-focus-audit`](./packages/context-change-on-focus-audit) | [@a11y-pulse/context-change-on-focus-audit](https://www.npmjs.com/package/@a11y-pulse/context-change-on-focus-audit) | [WCAG 3.2.1 On Focus](https://www.w3.org/WAI/WCAG22/Understanding/on-focus): tabs through a page and detects focus-triggered context changes (new windows, auto-submits, navigation, focus theft/removal) |
| [`@a11y-pulse/text-spacing-audit`](./packages/text-spacing-audit) | [@a11y-pulse/text-spacing-audit](https://www.npmjs.com/package/@a11y-pulse/text-spacing-audit) | [WCAG 1.4.12 Text Spacing](https://www.w3.org/WAI/WCAG22/Understanding/text-spacing): injects the SC spacing overrides and detects clipped or overlapping text |
| [`@a11y-pulse/tab-orchestrator`](./packages/tab-orchestrator) | [@a11y-pulse/tab-orchestrator](https://www.npmjs.com/package/@a11y-pulse/tab-orchestrator) | Orchestrator that drives a page once so multiple tab-driven audits can share a single tab loop |

## Development

Requires Node.js `>=22`.

```bash
git clone https://github.com/A11y-Pulse/audits.git
cd audits
npm install
npm test                 # typecheck + unit tests
npm run test:integration # real Chromium via Puppeteer
npm run lint
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for Changesets and pull-request expectations.
