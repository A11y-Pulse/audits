# Changelog

## 0.2.1

### Patch Changes

- [#40](https://github.com/A11y-Pulse/audits/pull/40) [`6514f41`](https://github.com/A11y-Pulse/audits/commit/6514f416171cfc36dfad4eb15f6081e3b2971978) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Allow `PuppeteerAdaptor.ensureFocusReporting()` to re-assert focus emulation.
  
  Every call after the first was a permanent no-op for a given page, so emulation that had been cleared (Chrome clears it when another target takes the foreground, or when the CDP client disconnects) could never be restored. The adaptor now retains the CDP session per page and toggles the emulation off and back on, since Chromium ignores a redundant enable.

## 0.2.0

### Minor Changes

- [#29](https://github.com/A11y-Pulse/audits/pull/29) [`027a314`](https://github.com/A11y-Pulse/audits/commit/027a3149f74867f0390b63447cd29377dd099662) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - `ReflowOffender` now includes an optional `screenshot` (PNG bytes), a clipped shot of the offending element captured at the 320px measurement viewport before it's restored. `ReflowAuditAdaptor` gains a required `screenshotClip` method. `@a11y-pulse/browser-adaptor` gains a `bufferedClip` export (padded-clip geometry, ported from `@a11y-pulse/tab-orchestrator`'s implementation) that `reflow-audit` and `text-spacing-audit` both use for this.
  
  Capture is bounded: at most `screenshotLimit` (default 10) offenders are screenshotted per audit, since each is a real `page.screenshot()` call.

## 0.1.0

### Minor Changes

- [#20](https://github.com/A11y-Pulse/audits/pull/20) [`dd1fa04`](https://github.com/A11y-Pulse/audits/commit/dd1fa043ce9ae83a20d292c0336e4036d71ae0cc) Thanks [@wildlyinaccurate](https://github.com/wildlyinaccurate)! - Add `@a11y-pulse/browser-adaptor` with shared `BrowserAdaptor`, `PuppeteerAdaptor`, and DOM helpers. Point `@a11y-pulse/focus-appearance-audit` at the workspace package and re-export the public adaptor types for back-compat.
