# @a11y-pulse/unreachable-controls-audit

## 0.1.0

### Minor Changes

- [#113](https://github.com/A11y-Pulse/audits/pull/113) [`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/unreachable-controls-audit` for WCAG 2.1.1 Keyboard and 4.1.2 Name, Role, Value. It records which elements take focus during a tab pass, then scans the page for elements that act as controls (a click handler, a widget role, a label whose control is not rendered) with no tab stop in or around them, and for focused elements that handle clicks or key presses but expose no role. In Chromium it asks the browser which listeners each element has, so controls wired up with `addEventListener` are found; elsewhere it relies on handler attributes, roles and the pointer cursor. Cards around a link, framework roots and portal containers carrying a delegated event set, labels of controls that are focusable or have a focusable stand-in, roving tab stops, composite widgets that manage focus and hidden or disabled content are left alone. Weak evidence is reported for review, including a click listener that most elements on the page carry and a focusable container whose listeners serve the controls inside it, and a tab pass that stops early makes the result inconclusive.

### Patch Changes

- Updated dependencies [[`5cf6dbf`](https://github.com/A11y-Pulse/audits/commit/5cf6dbf56202ec788db07adc21b9b674d6eb8ae3), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb), [`49fc92c`](https://github.com/A11y-Pulse/audits/commit/49fc92c7b8541247facf8cccfefb25af760f16bb)]:
  - @a11y-pulse/browser-adaptor@0.10.0
  - @a11y-pulse/tab-orchestrator@0.10.0
