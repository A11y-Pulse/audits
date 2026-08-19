# A11y Pulse accessibility audits

These accessibility audits have been developed by [A11y Pulse](https://www.a11ypulse.com/) to compliment and extend other accessibility testing frameworks like [axe-core](https://github.com/dequelabs/axe-core). The audits come with Puppeteer adaptors, but are written to be framework-agnostic.

Source-available accessibility audits used by [A11y Pulse](https://www.a11ypulse.com/), published as separate npm packages from this repo.

These audits are released under the [PolyForm Shield License 1.0.0](./packages/focus-appearance-audit/LICENSE.md). This means they are source-available and free to use in non-competing products. In other words, you are free to use these audits in your own internal monitoring but cannot use them as part of any monitoring service that competes with A11y Pulse.

## Packages

| Package | npm | What it checks |
| --- | --- | --- |
| [`@a11y-pulse/focus-appearance-audit`](./packages/focus-appearance-audit) | [@a11y-pulse/focus-appearance-audit](https://www.npmjs.com/package/@a11y-pulse/focus-appearance-audit) | [WCAG 2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible): tabs through a page and detects a visible focus indicator |
| [`@a11y-pulse/focus-not-obscured-audit`](./packages/focus-not-obscured-audit) | [@a11y-pulse/focus-not-obscured-audit](https://www.npmjs.com/package/@a11y-pulse/focus-not-obscured-audit) | [WCAG 2.4.11 Focus Not Obscured (Minimum)](https://www.w3.org/WAI/WCAG22/Understanding/focus-not-obscured-minimum): tabs through a page and detects focused elements entirely hidden behind other content |
| [`@a11y-pulse/tab-orchestrator`](./packages/tab-orchestrator) | [@a11y-pulse/tab-orchestrator](https://www.npmjs.com/package/@a11y-pulse/tab-orchestrator) | Not an audit — shared Tab-session runner that drives a page once so multiple tab-driven audits can share a single tab loop |

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
