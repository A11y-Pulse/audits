# Changelog

## 0.3.0

### Minor Changes

- [`dbdabe9`](https://github.com/A11y-Pulse/audits/commit/dbdabe9ca3f435fe273568b4b786ad83b022083c) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Republish with the `tab-orchestrator`-based orchestration, `FocusElementResult.failureEvidence`, and `StyleSnapshot`/`FocusFailureEvidence` exports. The previous `0.2.0` published to npm predated the monorepo conversion and did not include these; this version corrects the drift between the registry and this repo's `main`.

## 0.2.0

### Minor Changes

- [#24](https://github.com/A11y-Pulse/audits/pull/24) [`6863b2e`](https://github.com/A11y-Pulse/audits/commit/6863b2eac852a2b54301d645c342f742b4edd6dc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Extract `@a11y-pulse/tab-orchestrator` and run focus-appearance as a consumer. Import `PuppeteerAdaptor` from `@a11y-pulse/tab-orchestrator/puppeteer`.

### Patch Changes

- [#20](https://github.com/A11y-Pulse/audits/pull/20) [`dd1fa04`](https://github.com/A11y-Pulse/audits/commit/dd1fa043ce9ae83a20d292c0336e4036d71ae0cc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/browser-adaptor` with shared `BrowserAdaptor`, `PuppeteerAdaptor`, and DOM helpers. Point `@a11y-pulse/focus-appearance-audit` at the workspace package and re-export the public adaptor types for back-compat.
- Updated dependencies [[`6863b2e`](https://github.com/A11y-Pulse/audits/commit/6863b2eac852a2b54301d645c342f742b4edd6dc)]:
  - @a11y-pulse/tab-orchestrator@0.2.0

## 0.1.0

### Minor Changes

- 59dc18d: Initial public release.

All notable changes to this project will be documented in this file.
