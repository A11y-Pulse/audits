# @a11y-pulse/filename-alt-text-audit

## 0.3.0

### Minor Changes

- [#112](https://github.com/A11y-Pulse/audits/pull/112) [`7cce2b9`](https://github.com/A11y-Pulse/audits/commit/7cce2b9d752fc7fb122555016b05f75fff250402) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Refine the alt text and accessible name heuristics.
  
  `filename-alt-text-audit`:
  
  - Reads lazy-loading sources (`data-src`, `data-lazy-src`, `data-original`, `data-srcset`, `data-lazy-srcset`) and the CSS background of `role="img"` elements.
  - Matches the filename as it was uploaded, before a CMS or bundler added `-300x200`, `-scaled`, `@2x` or a content hash.
  - Checks `role="img"` elements with an `aria-label`, inline `<svg role="img">` titles and linked `<area>` elements, and skips images made presentational.
  - Adds the `artefact` signal, a failure, for alt text that is `undefined`, `null` or `NaN` in exactly that spelling, `[object Object]`, or an unrendered template token, including one written across several lines.
  - Stops reporting a single plain word that is also the filename ("GitHub" on `github.svg`), short numbers ("1", "2024") and "Pano 360".
  - Reports where the text came from as `altTextSource`.
  - Waits once, for up to 2 seconds in total, for the images it screenshots, instead of up to 2 seconds for each.
  
  `suspicious-accessible-name-audit`:
  
  - A name that matches the element's `id`, `class` or `name` is only reviewed when it comes from a visible `<label>`, `aria-labelledby` target or button value, and passes unless the value has a separator. A plain word that is also the `id`, `class` or `name` ("Title" on `id="title"`) no longer matches from any source. Only test-id attributes are compared among `data-*`.
  - "True", "False", "Test", "Label", "Banner", "Element" and "Module" are reviewed rather than failed, and can be changed with the new `reviewWords` vocabulary list.
  - A name that is nothing but a template token or `[object Object]` fails from any source, visible text included. A token among other words is reviewed rather than failed.
  - Translation keys with a namespace or a camelCase or snake_case part, such as `nav.homeTitle` and `common:buttons.submit`, are reviewed as an `identifier-pattern`. Hosts, packages and file names pass.
  - "undefined", "null" and "NaN" only fail in exactly that spelling.
  - Template tokens are matched in time linear in the length of the name.
  - "Please select" is no longer a role word.
  - An inline SVG's `<title>` now counts towards the name of the control around it.
  - `evidence` holds the matched template token, and the new `labelSelector` points at the labelling element of a flagged name. `classifyName` returns a `verdict`.
  - Elements past `elementLimit` are counted without computing their names.
  
  `audit-runner`: describes the new `artefact` alt text signal.

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

## 0.1.0

### Minor Changes

- [#92](https://github.com/A11y-Pulse/audits/pull/92) [`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/filename-alt-text-audit`, which flags image alt text that is not a text alternative (WCAG 1.1.1 Non-text Content, failure F30). Alt text that is the full filename of one of the image's own sources is a failure; alt text that only resembles a filename, a camera file name or placeholder text in the page's language or English is reported for review. The audit runner reports it as `filename-alt-text`: own filenames in `violations`, everything else in `incomplete`.

### Patch Changes

- Updated dependencies [[`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319)]:
  - @a11y-pulse/browser-adaptor@0.8.0
