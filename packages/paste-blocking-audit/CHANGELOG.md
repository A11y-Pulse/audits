# @a11y-pulse/paste-blocking-audit

## 0.1.0

### Minor Changes

- [#113](https://github.com/A11y-Pulse/audits/pull/113) [`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/paste-blocking-audit`, a WCAG 3.3.8 Accessible Authentication (Minimum) audit. It finds the page's password, username and one-time-code fields and pastes into each with synthetic events. A field whose `paste` event the page cancels, leaving it unchanged, is a failure; a cancelled paste key press or `beforeinput`, a cancelled paste on a one-time code (which is pasted a digit short), a split code entry that ignores a pasted code, a field kept `readonly` until focus, `autocomplete="off"`, `autocomplete="new-password"` on a sign-in password and a one-time-code field with no `autocomplete="one-time-code"` are reported for review. A one-time code is never pasted whole, and form submission and `fetch`, `XMLHttpRequest` and `sendBeacon` requests are held back while fields are pasted into, so the page cannot send the pasted text. The clipboard is not touched, and field values and focus are left as found.

### Patch Changes

- Updated dependencies [[`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb)]:
  - @a11y-pulse/browser-adaptor@0.10.0
