# Contributing

Thanks for your interest in contributing to `@a11y-pulse/focus-appearance-audit`!

## License note

This project is released under the [PolyForm Shield License 1.0.0](./LICENSE.md), a source-available (not open-source/OSI-approved) license: it permits non-competing use but forbids using the software (including modified versions) to build a competing product or service. By submitting a contribution, you agree that it will be licensed under the same terms, and that A11y Pulse Limited may use, modify, and relicense your contribution as part of the project.

If you're not comfortable with that, please open an issue to discuss your change before submitting a pull request.

## Getting set up

```bash
git clone https://github.com/A11y-Pulse/focus-appearance-audit.git
cd focus-appearance-audit
npm install
```

Requires Node.js `>=22`.

## Running tests

```bash
# Unit tests
npm run test:unit

# Type checking + unit tests (what CI runs)
npm test

# Integration tests (launches a real headless Chromium via Puppeteer)
npm run test:integration
```

Unit tests live alongside source files as `*.test.ts`. Integration tests live in `tests/integration/` and exercise real browser behaviour against HTML fixtures in `tests/integration/fixtures/`.

## Linting and formatting

This project uses [Biome](https://biomejs.dev/) for linting and formatting.

```bash
npm run lint       # check
npm run lint:fix   # auto-fix what's safe to fix
```

## Opening a pull request

1. Fork the repo and create a branch for your change.
2. Add or update tests for any behaviour change.
3. Make sure `npm test`, `npm run test:integration` (if your change touches browser behaviour), and `npm run lint` all pass.
4. Open a pull request describing what changed and why, using the PR template.

For anything beyond a small fix, please open an issue first to discuss the approach.
