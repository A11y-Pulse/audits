# @a11y-pulse/suspicious-accessible-name-audit

## 0.1.0

### Minor Changes

- [#103](https://github.com/A11y-Pulse/audits/pull/103) [`310963f`](https://github.com/A11y-Pulse/audits/commit/310963faf4c293c320800233d10656b3615e31ee) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/suspicious-accessible-name-audit`, which flags controls, links, labelled landmarks, dialogs and iframes whose accessible name is code rather than a name. A name that is the element's own `id`, `class`, `name` or `data-*` value, a leftover script value such as "undefined", an unrendered template token or a stock placeholder is a failure; a name shaped like an identifier, a numbered placeholder such as "banner1", or one that repeats the element's role is reported for review. Each element is mapped to WCAG 1.1.1 (icon-only controls and iframes), 2.4.4 (links with no surrounding text) or 2.4.6 (everything else), with role words as best practice. The audit runner reports it as `suspicious-accessible-name`, tagging each bucket with the criteria of the elements in it.
