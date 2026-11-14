---
"@a11y-pulse/disclosure-operability-audit": minor
"@a11y-pulse/browser-adaptor": minor
---

Add `@a11y-pulse/disclosure-operability-audit`, an audit for WCAG 2.1.1 Keyboard and 4.1.2 Name, Role, Value. It finds disclosure triggers (elements with `aria-expanded`), operates each with Enter and Space, and checks that it opens, updates `aria-expanded` and closes again. A trigger that a click or hover operates and the keyboard does not, or that shows content without updating its state, is a failure; unresponsive triggers, a state that changes with no content seen, popups only a click closes and triggers that open on focus are reported for review. Links that leave the page, submit buttons, text fields, checkboxes, radio buttons, composite-widget items and controls named for an action such as "Delete" or "Sign out" are never activated. A key is only pressed while the trigger holds keyboard focus, form submissions and navigations to another page are stopped while the audit runs, at most 20 triggers are operated, and each is put back as it was found along with focus and scrolling.

`@a11y-pulse/browser-adaptor`: `KeyName` now includes `"Space"`, which both built-in adaptors already press.
