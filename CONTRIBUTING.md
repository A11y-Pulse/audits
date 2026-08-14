# Contributing

Thanks for your interest in contributing to the A11y Pulse audits.

## License note

Packages in this repo are released under the [PolyForm Shield License 1.0.0](./packages/focus-appearance-audit/LICENSE.md), a source-available (not open-source/OSI-approved) license: it permits non-competing use but forbids using the software (including modified versions) to build a competing product or service. By submitting a contribution, you agree that it will be licensed under the same terms, and that A11y Pulse Limited may use, modify, and relicense your contribution as part of the project.

If you're not comfortable with that, please open an issue to discuss your change before submitting a pull request.

## Getting set up

```bash
git clone https://github.com/A11y-Pulse/audits.git
cd audits
npm install
```

Requires Node.js `>=22`.

## Running tests

From the repo root:

```bash
# Type checking + unit tests (what `npm test` runs)
npm test

# Unit tests only
npm run test:unit

# Integration tests (launches a real headless Chromium via Puppeteer)
npm run test:integration
```

Unit tests live alongside source files as `*.test.ts` inside each package. Integration tests live in `packages/<package>/tests/integration/` and exercise real browser behaviour against HTML fixtures.

## Linting and formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting.

```bash
npm run lint       # check
npm run lint:fix   # auto-fix what's safe to fix
```

## Versioning

Published packages version independently with [Changesets](https://github.com/changesets/changesets).

- If your PR should bump a published package, run `npx changeset` and commit the file it creates.
- Tooling-only changes (root TypeScript, Biome, GitHub Actions) do **not** need a changeset and must not publish.
- Dependabot PRs that bump a package's production dependencies (`pixelmatch`, `pngjs`, …) need a `patch` changeset on that package.

After merge to `main`, the Release workflow opens a Version PR when changesets exist. Merging that PR publishes to npm via trusted publishing (`release.yml`).

## Opening a pull request

1. Fork the repo and create a branch for your change.
2. Add or update tests for any behaviour change.
3. Make sure `npm test`, `npm run test:integration` (if your change touches browser behaviour), and `npm run lint` all pass.
4. Add a changeset if a published package should bump.
5. Open a pull request describing what changed and why, using the PR template.

For anything beyond a small fix, please open an issue first to discuss the approach.
