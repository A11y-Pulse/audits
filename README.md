# A11y Pulse audits

Source-available accessibility audits used by [A11y Pulse](https://www.a11ypulse.com/), published as separate npm packages from this repo.

Each package is framework-agnostic (drive it through an adaptor) and released under the [PolyForm Shield License 1.0.0](./packages/focus-appearance-audit/LICENSE.md) — read, fork, and use them in non-competing products; do not use them to build a competing accessibility monitoring service.

## Packages

| Package | npm | What it checks |
| --- | --- | --- |
| [`@a11y-pulse/focus-appearance-audit`](./packages/focus-appearance-audit) | [@a11y-pulse/focus-appearance-audit](https://www.npmjs.com/package/@a11y-pulse/focus-appearance-audit) | [WCAG 2.4.7 Focus Visible](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible): tabs through a page and detects a visible focus indicator |

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
