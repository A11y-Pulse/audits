# Changelog

## 0.3.0

### Minor Changes

- [#112](https://github.com/A11y-Pulse/audits/pull/112) [`7cce2b9`](https://github.com/A11y-Pulse/audits/commit/7cce2b9d752fc7fb122555016b05f75fff250402) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Reduce false results from the skip link audit.
  
  - Skip links whose target has nothing focusable inside (`<h1 id>`, an empty `<a id>`) now pass when the next Tab lands after the target.
  - Menu toggles and other in-page links are no longer treated as skip links: a link without skip wording counts only when its target is the page's main content (a heading, the `main` landmark or around it, or a conventional id such as `content`), is rendered and is not a navigation block. Links with `aria-expanded`, `role="tab"` or `role="button"` are never activated.
  - Skip wording is matched on whole words in the link's text and `aria-label`, and "go to" verbs need a content or navigation noun, so "Popular posts" or "Aller au panier" no longer count. `class` and `id` only count when they are a skip token such as `skip-link`.
  - Script-driven skip links whose fragment matches nothing are activated and pass when focus moves to later content.
  - Same-document links written as `/page#main` or an absolute URL are recognised.
  - A target that is not rendered is reported as `target-hidden`, and fragments no longer resolve to form controls or meta tags that share the name.
  - Skip links that can never receive focus are reported under the new `unreachable` field.
  - Results now carry the link text, the target, and where focus went after Enter and after the follow-up Tab.
  - The URL, `:target` and scroll position are restored after each activation, and when the audit ends focus is dropped and the next Tab press starts from the first tab stop again, whether or not a skip link was found. The history entry added by following a fragment link remains as a forward entry.

### Patch Changes

- Updated dependencies [[`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb)]:
  - @a11y-pulse/browser-adaptor@0.10.0

## 0.2.0

### Minor Changes

- [#97](https://github.com/A11y-Pulse/audits/pull/97) [`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Screenshot failed skip links and flagged image alt text.
  
  - `@a11y-pulse/skip-link-audit`: a failed skip link gets a `screenshot` of the link while focused. `SkipLinkAuditAdaptor` now requires `screenshotClip`; the bundled Puppeteer and Playwright adaptors already provide it.
  - `@a11y-pulse/filename-alt-text-audit`: listed `failed` and `needsReview` images get a `screenshot`, up to the new `screenshotLimit` option (default 10, `failed` first). Each image is scrolled into view, and a lazy image is loaded before capture. The page's scroll position is restored afterwards.
  - `@a11y-pulse/browser-adaptor`: add `captureElementScreenshot` and `stashedElementHandle`. The page scripts behind them (`pageDimensionsScript`, `elementRectScript`, `needsCentringScript`, `scrollToCenterScript`) move here from `@a11y-pulse/tab-orchestrator`, which still re-exports them.
  - `@a11y-pulse/tab-orchestrator`: centring an element before a capture now measures the viewport correctly on quirks-mode pages, where it previously measured the whole document and could capture a blank region.
  - `@a11y-pulse/audit-runner`: attach the screenshots as `skip-link-activation-evidence` and `filename-alt-text-evidence`.

### Patch Changes

- Updated dependencies [[`dc533e7`](https://github.com/A11y-Pulse/audits/commit/dc533e7e3914534a080a7420dd04d4bbfd1de9e5)]:
  - @a11y-pulse/browser-adaptor@0.9.0

## 0.1.2

### Patch Changes

- [#52](https://github.com/A11y-Pulse/audits/pull/52) [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Document which browser engines each audit is verified against, and point the adaptor docs at `@a11y-pulse/browser-adaptor`, which now owns both the `BrowserAdaptor` interface and the bundled Puppeteer and Playwright implementations.
- Updated dependencies [[`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04), [`3797dfc`](https://github.com/A11y-Pulse/audits/commit/3797dfc4e2d68942fff8019683db80c6a660bd04)]:
  - @a11y-pulse/browser-adaptor@0.4.0

## 0.1.1

### Patch Changes

- [#44](https://github.com/A11y-Pulse/audits/pull/44) [`94c45ef`](https://github.com/A11y-Pulse/audits/commit/94c45ef081b9dde56a0b0d11eff4a6e303c93d2b) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/audit-runner`, a worked example that runs every audit against a page and ships an `npx @a11y-pulse/audit-runner [url]` CLI that outputs JSON results.
  
  Each audit package now also declares a `source` export condition, matching `@a11y-pulse/tab-orchestrator`, so cross-package typechecking resolves to source and no longer depends on workspace build order.
- Updated dependencies [[`94c45ef`](https://github.com/A11y-Pulse/audits/commit/94c45ef081b9dde56a0b0d11eff4a6e303c93d2b)]:
  - @a11y-pulse/browser-adaptor@0.2.2

## 0.1.0

### Minor Changes

- [#18](https://github.com/A11y-Pulse/audits/pull/18) [`42f3326`](https://github.com/A11y-Pulse/audits/commit/42f332636b5d0603bdb5451d77c2d085d0f39023) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/skip-link-audit`: behavioural WCAG 2.4.1 skip-link activation check.

### Patch Changes

- Updated dependencies [[`dd1fa04`](https://github.com/A11y-Pulse/audits/commit/dd1fa043ce9ae83a20d292c0336e4036d71ae0cc)]:
  - @a11y-pulse/browser-adaptor@0.1.0
