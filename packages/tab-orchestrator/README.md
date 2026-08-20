# @a11y-pulse/tab-orchestrator

[![npm version](https://img.shields.io/npm/v/@a11y-pulse/tab-orchestrator)](https://www.npmjs.com/package/@a11y-pulse/tab-orchestrator)
[![CI](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml/badge.svg)](https://github.com/A11y-Pulse/audits/actions/workflows/ci.yml)
[![License: PolyForm Shield 1.0.0](https://img.shields.io/badge/license-PolyForm%20Shield%201.0.0-blue)](./LICENSE.md)

A shared Tab-session runner for A11y Pulse's keyboard-driven accessibility audits. It drives a page through its focusable elements once — pressing Tab, tracking visited elements, capturing screenshots and styles on demand — while one or more **consumers** each score the tab stops for their own WCAG success criterion. This lets audits like [`@a11y-pulse/focus-appearance-audit`](../focus-appearance-audit) (WCAG 2.4.7) share a single tab loop with sibling audits instead of each re-tabbing the page from scratch.

It is not an audit itself: it has no opinion on what "passing" means. It only owns the mechanics of moving focus, tracking cycle completion, and capturing the primitives (computed styles, clipped screenshots, unfocused/focused pairs) that consumers need.

This package was developed by [A11y Pulse](https://www.a11ypulse.com/) for its accessibility monitoring service. It is released as source-available under the [PolyForm Shield License 1.0.0](#license).

## Install

```bash
npm install @a11y-pulse/tab-orchestrator
```

Puppeteer is an optional peer dependency, needed only if you use the bundled [`PuppeteerAdaptor`](#puppeteeradaptor).

## `createTabOrchestrator`

```ts
import { createTabOrchestrator } from "@a11y-pulse/tab-orchestrator";

const orchestrator = createTabOrchestrator(adaptor, sessionOptions);

orchestrator.attach(consumerA);
orchestrator.attach(consumerB);

await orchestrator.run();
```

- `createTabOrchestrator(adaptor: BrowserAdaptor, options?: TabSessionOptions)` builds a session against a single page, driven through the given [`BrowserAdaptor`](#browseradaptor). `TabSessionOptions` covers shared cost controls (`screenshotSettleDelay`, `screenshotClipBuffer`, `markerLimit`, `baselineElementLimit`), not any particular audit's policy.
- `.attach(consumer)` registers a `TabConsumer`. Attaching after `run()` has started throws.
- `.run()` presses Tab repeatedly, dispatching each `TabStopSnapshot` to every still-attached consumer, until either a full tab cycle completes, focus is lost, navigation happens, or every consumer has disconnected. Calling it twice throws; calling it with zero attached consumers returns immediately without tabbing.

Each consumer declares the `capabilities` it needs (e.g. `baselineStyles`, `unfocusedPair`) and can disconnect independently once it has what it needs (say, after hitting its own element limit) — the orchestrator keeps driving the remaining consumers. Per-stop work like unfocused-pair screenshots is only captured if a still-attached consumer actually asks for it that stop.

Most callers won't build a `TabConsumer` by hand — audit packages export a `createXAudit(options)` helper that returns one, plus a `runXAudit(adaptor, options)` convenience wrapper that builds a private single-consumer orchestrator for you. See [`@a11y-pulse/focus-appearance-audit`'s "Shared tab session"](../focus-appearance-audit#shared-tab-session) section for a worked example.

## `BrowserAdaptor`

The orchestrator drives a page through an **adaptor**: a small interface of primitives (evaluate JS in the page, press Tab, take a clipped screenshot, etc.) so it never needs to know which browser automation library is behind it.

| Method                   | Description                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `evaluate(fn, ...args)`  | Runs `fn` in the page context, passing in any serialisable `args`, and returns its result.                                                          |
| `evaluateHandle(fn)`     | Runs `fn` in the page context and returns an opaque `ElementRef` handle to the `Element` it returns, without serialising it.                        |
| `disposeRef(ref)`        | Releases a handle previously returned by `evaluateHandle`.                                                                                           |
| `pressTab()`             | Presses the Tab key, advancing focus to the next focusable element.                                                                                  |
| `screenshotClip(clip)`   | Screenshots a clipped region of the page (`{ x, y, width, height }`) and returns PNG bytes.                                                          |
| `ensureFocusReporting()` | Ensures the page reports focus for its lifetime — in particular that `document.hasFocus()` works and `:focus` styles apply, even when the page is not the foreground tab/window. Must not throw. |

The orchestrator is the only thing that mutates the page through this adaptor during a session; consumers score snapshots, they don't call `pressTab`, take screenshots, or install observers themselves.

### `PuppeteerAdaptor`

```js
import { createTabOrchestrator } from "@a11y-pulse/tab-orchestrator";
import { PuppeteerAdaptor } from "@a11y-pulse/tab-orchestrator/puppeteer";

const orchestrator = createTabOrchestrator(new PuppeteerAdaptor(page));
```

The package ships one implementation, `PuppeteerAdaptor`, backed by a Puppeteer `Page`, exported from the `./puppeteer` subpath so consumers that only need the type-level `BrowserAdaptor` interface aren't forced to import Puppeteer. Other environments (Playwright, Selenium, WebDriver) can be supported by implementing `BrowserAdaptor` against your automation library's page/session object; use [`src/adaptors/puppeteer.ts`](./src/adaptors/puppeteer.ts) as a reference implementation.

## Releasing

Releases are managed in the [A11y-Pulse/audits](https://github.com/A11y-Pulse/audits) monorepo with [Changesets](https://github.com/changesets/changesets). Publishing uses [npm trusted publishing](https://docs.npmjs.com/trusted-publishers/) (OIDC). There is no long-lived `NPM_TOKEN`.

### Ship a change

1. Open a PR against `main` that includes a changeset (`npx changeset`) naming `@a11y-pulse/tab-orchestrator`.
2. After merge, the Release workflow opens a Version PR. Merging that PR publishes this package to npm and tags `@a11y-pulse/tab-orchestrator@<version>`.

Trusted Publisher on npm must stay configured for:

| Field | Value |
| --- | --- |
| Organization or user | `A11y-Pulse` |
| Repository | `audits` |
| Workflow filename | `release.yml` |

## License

Released under the [PolyForm Shield License 1.0.0](./LICENSE.md), in plain language:

- **Source-available.** The source is public and you can read, fork, and modify it.
- **Permitted for non-competing use.** You can use this package freely in your own products and services, as long as they don't compete with A11y Pulse.
- **Competing products are forbidden.** You may not use this software (or a modified version of it) to build a product or service that competes with A11y Pulse's accessibility monitoring offering.

See [LICENSE.md](./LICENSE.md) for the full, binding terms.
