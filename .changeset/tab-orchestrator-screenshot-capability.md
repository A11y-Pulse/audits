---
"@a11y-pulse/tab-orchestrator": minor
---

Add a `screenshot` capability and `session.screenshotClip()` to `TabSessionHandle`, for a consumer to capture a clipped, padded screenshot of the currently focused element on demand (mirrors the existing `ensureUnfocusedPair()` lazy-capture pattern: only computed when a declaring consumer calls it, cached per stop).
