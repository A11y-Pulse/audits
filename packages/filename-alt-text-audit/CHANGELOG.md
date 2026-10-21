# @a11y-pulse/filename-alt-text-audit

## 0.1.0

### Minor Changes

- [#92](https://github.com/A11y-Pulse/audits/pull/92) [`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/filename-alt-text-audit`, which flags image alt text that is not a text alternative (WCAG 1.1.1 Non-text Content, failure F30). Alt text that is the full filename of one of the image's own sources is a failure; alt text that only resembles a filename, a camera file name or placeholder text in the page's language or English is reported for review. The audit runner reports it as `filename-alt-text`: own filenames in `violations`, everything else in `incomplete`.

### Patch Changes

- Updated dependencies [[`28daa31`](https://github.com/A11y-Pulse/audits/commit/28daa3169795e628f37ae9cdadd2cc5578edb319)]:
  - @a11y-pulse/browser-adaptor@0.8.0
