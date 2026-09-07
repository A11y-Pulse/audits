---
"@a11y-pulse/browser-adaptor": patch
---

Allow `PuppeteerAdaptor.ensureFocusReporting()` to re-assert focus emulation.

Every call after the first was a permanent no-op for a given page, so emulation that had been cleared (Chrome clears it when another target takes the foreground, or when the CDP client disconnects) could never be restored. The adaptor now retains the CDP session per page and toggles the emulation off and back on, since Chromium ignores a redundant enable.
