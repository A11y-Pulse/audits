---
"@a11y-pulse/tab-orchestrator": minor
---

Verify the page still reports focus at the point each tab stop is measured, not only before the tab press.

Chromium stops matching `:focus` and `:focus-visible` the moment a document loses focus, so an element measured in that state reads as having no indicator however correct its CSS is, and its focused and unfocused screenshots come out pixel-identical. The session previously checked `document.hasFocus()` once per stop, before `pressTab()`, which is the least informative moment: the tab press itself re-activates a backgrounded page. A page that lost focus after the press was measured anyway, and consumers reported the result as a genuine failure.

The loop now re-checks at the point of measurement and re-asserts focus reporting once before giving up, ending the session as `lostFocus` rather than recording a measurement taken without focus.

The check exempts a stop that probes as `<body>`. The tab press that leaves the last element takes focus out of the document with it, so the end of the tab order is indistinguishable from a stolen focus by `document.hasFocus()` alone, and focus emulation cannot restore it. Only a real element measured without focus ends the session; running out of elements to tab to still ends it as `completed`.

Adds a `hasFocusScript` export so adaptors and tests can address the check directly.
