# Shared tab orchestrator

## Problem

WCAG 2.4.7 (focus visible), 2.4.11 (focus not obscured), and 3.2.1 (on focus) all need a real Tab traversal of the same page. PR [#22](https://github.com/A11y-Pulse/audits/pull/22) implements the last two by piggybacking measurements into `@a11y-pulse/focus-appearance-audit`: one loop, one result type, two extra criteria folded into a 2.4.7 package.

That makes a shared traversal an implementation accident of one audit. New criteria cannot join the pass without growing `focus-appearance-audit`, and a host cannot run 2.4.11 without pulling screenshot and pixel-diff machinery.

## Goals

- Extract a tab session that multiple publishable audits can share.
- Keep each criterion as its own npm package with its own result type.
- Let each package run a tab loop alone (private orchestrator).
- Let a host (the A11y Pulse runner) construct one orchestrator, attach several audits, and `run()` once.
- Let audits disconnect independently when they hit their own limits; remaining audits keep receiving stops.
- Compute expensive per-stop work (screenshots, blur/refocus) only when a remaining consumer needs it this stop.
- Never uninstall session-lifetime setup; only stop executing per-stop capabilities.

## Non-goals

- Merging PR #22 as written. Scoring and browser scripts from that PR move into the packages that own those criteria.
- A plugin registry for arbitrary capabilities. The capability set is closed and owned by the orchestrator.
- Uninstalling observers, markers, or other session setup when the last consumer of that capability disconnects.
- Per-stop vetoes (“don’t scroll, I’m measuring obscuring”). Order is fixed instead.
- Extracting `@a11y-pulse/browser-adaptor` as its own package. The adaptor lives in `tab-orchestrator` until a non-tab audit needs it.
- Skip-link, reflow, keyboard-trap, or other non-tab audits.
- Changing 2.4.7 detection heuristics.
- A session-level timeout. Timeouts are per consumer.
- Updating the A11y Pulse runner beyond noting the import change. Shared-session wiring in `a11y-pulse` is a follow-up.

## Packages

```
packages/
  tab-orchestrator/                 @a11y-pulse/tab-orchestrator
  focus-appearance-audit/           @a11y-pulse/focus-appearance-audit   (WCAG 2.4.7)
  focus-not-obscured-audit/         @a11y-pulse/focus-not-obscured-audit (WCAG 2.4.11)
  context-change-on-focus-audit/    @a11y-pulse/context-change-on-focus-audit (WCAG 3.2.1)
```

Audit packages depend on `tab-orchestrator`. They do not depend on each other.

`@a11y-pulse/tab-orchestrator` is published. It is not an audit.

## Public API

### Solo (unchanged call shape)

```ts
import { runFocusAppearanceAudit } from "@a11y-pulse/focus-appearance-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/tab-orchestrator/puppeteer";

const result = await runFocusAppearanceAudit(new PuppeteerAdaptor(page), {
  elementLimit: 50,
});
```

`runFocusNotObscuredAudit` and `runContextChangeOnFocusAudit` follow the same pattern.

Each `runXAudit(adaptor, options)` constructs a private orchestrator, attaches one consumer, calls `run()`, and returns that consumer’s `result`.

### Shared session

```ts
import { createTabOrchestrator } from "@a11y-pulse/tab-orchestrator";
import { createFocusAppearanceAudit } from "@a11y-pulse/focus-appearance-audit";
import { createFocusNotObscuredAudit } from "@a11y-pulse/focus-not-obscured-audit";
import { createContextChangeOnFocusAudit } from "@a11y-pulse/context-change-on-focus-audit";

const orchestrator = createTabOrchestrator(adaptor, sessionOptions);

const focus = createFocusAppearanceAudit({ elementLimit: 50 });
const obscured = createFocusNotObscuredAudit();
const context = createContextChangeOnFocusAudit();

orchestrator.attach(focus);
orchestrator.attach(obscured);
orchestrator.attach(context);

await orchestrator.run();

focus.result;
obscured.result;
context.result;
```

`createXAudit(options)` returns a `TabConsumer` with a typed `result` that is complete once that consumer has disconnected or the session has ended. Reading `result` before then is undefined.

### Breaking change

`@a11y-pulse/focus-appearance-audit/puppeteer` is removed. The Puppeteer adaptor is exported only from `@a11y-pulse/tab-orchestrator/puppeteer`. The A11y Pulse runner currently imports the old path and must switch when it takes this version. Focus-appearance still re-exports the `BrowserAdaptor` type so `runFocusAppearanceAudit`’s argument type does not force a new import for type-only consumers.

## Components

### Browser adaptor

Today’s `FocusAppearanceAuditAdaptor` moves to `@a11y-pulse/tab-orchestrator` and is named `BrowserAdaptor`:

- `evaluate`, `evaluateHandle`, `disposeRef`
- `pressTab`
- `screenshotClip` / `screenshotClipScale`
- `ensureFocusReporting`

The orchestrator is the only thing that mutates the page through this adaptor during a session. Consumers score snapshots; they do not call `pressTab`, `blur`, `screenshotClip`, or install observers themselves.

### Orchestrator

```ts
createTabOrchestrator(adaptor: BrowserAdaptor, options?: TabSessionOptions)
  .attach(consumer: TabConsumer): void
  .run(): Promise<void>
```

Session options (shared cost controls, not WCAG policy):

- `screenshotSettleDelay` (default 33)
- `screenshotClipBuffer` (default 10)

`attach` after `run()` has started throws. `run()` twice throws. `run()` with zero consumers returns without tabbing.

The orchestrator owns cycle detection (marker visited-set), iframe skipping, `document.hasFocus()` checks, and teardown (`clearMarkers`, dispose outstanding handles). It does not know WCAG success criteria.

### Capabilities (closed set)

Session-lifetime **install** (once at start if anyone attached asked; never uninstalled):

| Capability | Installed when | What it does |
| --- | --- | --- |
| `contextObservers` | any consumer declared `contextSignals` | open/submit/focus-in observers used to drain 3.2.1 signals |

Markers are not a consumer capability. The orchestrator always installs them; the loop needs them to detect a completed tab cycle.

Session-lifetime **capture** (once at start if requested; retained for the session):

| Capability | Requested as | What it does |
| --- | --- | --- |
| `baselineStyles` | `baselineStyles` | interned unfocused style snapshots keyed by marker index, used for the cheap 2.4.7 style check |

Per-stop **execute** (union of still-attached consumers, recomputed before every stop):

| Capability | What it does |
| --- | --- |
| `activeElement` | always on while anyone is attached: marker index, selector, html, rect, focused styles, iframe/body flags |
| `contextSignals` | drain observers after settle, before any blur or scroll |
| `obscuring` | covered fraction / opacity / obscurer at the natural tab position (no scroll) |
| `unfocusedPair` | consumer *may* need focused + unfocused screenshots and unfocused styles this stop. Declaring it does not capture anything. Capture happens only if a remaining declarer calls `session.ensureUnfocusedPair()` (memoized once per stop). That call may scroll-to-center **after** obscuring has already been measured, then blur/refocus and clear context-observer noise |

When the last consumer of a per-stop capability disconnects, the orchestrator simply does not execute it on later stops. Observers and markers stay in the page until teardown.

### Tab consumer

```ts
type Capability =
  | "baselineStyles"
  | "contextSignals"
  | "obscuring"
  | "unfocusedPair";

type TabSessionHandle = {
  disconnect(): void;
  /**
   * Capture (or return already-captured) focused/unfocused screenshots and
   * unfocused styles for this stop. Only consumers that declared
   * `unfocusedPair` may call it. Throws if this consumer did not declare it.
   */
  ensureUnfocusedPair(): Promise<{
    focusedScreenshot: Uint8Array;
    unfocusedScreenshot: Uint8Array;
    unfocusedStyles: StyleSnapshot;
  }>;
};

type TabConsumer = {
  readonly capabilities: ReadonlySet<Capability>;
  onTabStop(
    snapshot: TabStopSnapshot,
    session: TabSessionHandle,
  ): void | Promise<void>;
};
```

`createFocusAppearanceAudit` returns `TabConsumer & { result: FocusAppearanceResult }` (and likewise for the other audits).

Capabilities are fixed at attach time. Cheap per-stop capabilities (`contextSignals`, `obscuring`) are executed whenever any remaining consumer declared them. `unfocusedPair` is different because 2.4.7 only needs screenshots when the style check misses: declaring it opts the consumer into calling `ensureUnfocusedPair()`. If no remaining consumer declared it, or none call `ensureUnfocusedPair()` this stop, the orchestrator does not screenshot, blur, or scroll. Solo `runFocusAppearanceAudit` therefore keeps today’s behaviour: pixel-diff only on style miss.

`disconnect()` means “no further stops for this consumer.” The current snapshot still counts. Calling it after the session has aborted is a no-op. A per-audit `timeout` or `failedElementLimit` is implemented by the consumer calling `disconnect()`, not by the orchestrator.

## Data flow

1. Host attaches every consumer that should join this pass.
2. `run()` calls `ensureFocusReporting()`, installs markers, captures `baselineStyles` if requested, installs `contextObservers` if requested.
3. Loop, while at least one consumer is attached:
   1. If `document.hasFocus()` is false → session abort (`lostFocus`).
   2. `pressTab`, then settle.
   3. Union capabilities of remaining consumers.
   4. Probe `activeElement`. Body or null → session abort (`completed`). Iframe → skip the rest of this iteration (do not notify consumers).
   5. If marker index was seen before → session abort (`cycle`).
   6. Drain `contextSignals` if demanded (before blur/scroll).
   7. Measure `obscuring` if demanded (natural tab position).
   8. Build a `TabStopSnapshot` containing only the cheap computed fields. `tabIndex` is 1-based and counts notified stops, not skipped iframes.
   9. `await onTabStop(snapshot, handle)` for each consumer that is still attached at the start of this notify phase. A consumer may `disconnect()` during its callback; later consumers in this phase still receive this snapshot. During a callback, a declarer may `await session.ensureUnfocusedPair()`; the first call captures, later calls return the same pair. Capture order is still drain → obscuring → (optional) scroll/blur/screenshot, because steps 6–7 already finished.
4. Teardown: `clearMarkers`, dispose handles. Context observers are not uninstalled; they die with the page.

After focus-appearance disconnects, nothing calls `ensureUnfocusedPair()`, so later stops take no screenshots even if obscuring and context consumers remain.

### Snapshot

```ts
type TabStopSnapshot = {
  tabIndex: number;
  activeElement: ActiveElementInfo;
  baselineStyles?: StyleSnapshot;
  contextSignals?: ContextChangeDrain;
  obscuring?: ObscuredMeasurement;
};
```

`baselineStyles` is the interned baseline for this element’s marker index, or omitted when the element was unmarked. `contextSignals` and `obscuring` shapes match the measurements already designed in PR #22 (`ContextChangeDrain` / `ObscuredMeasurement`), moved into `tab-orchestrator` so both the orchestrator and the scoring packages share one type.

## Error handling

Two kinds of stop:

**Consumer disconnect** — that audit is done; the loop continues. Reasons live on that audit’s `result.summary`:

- `reachedLimit` — consumer’s `elementLimit`
- `reachedFailedElementLimit` — consumer’s `failedElementLimit`
- `timedOut` — consumer’s `timeout`

**Session abort** — the loop ends for everyone. Every still-attached consumer is disconnected. Each keeps findings already recorded and sets a session-end flag on its summary:

- `completed` — body/null active element, or marker cycle
- `lostFocus` — `document.hasFocus()` became false
- `navigation` — draining context signals (or a subsequent `evaluate`) shows the document was destroyed or replaced
- `failed` — a capability threw (`screenshotClip`, `evaluate`, handle dispose)

Capability failures throw out of `run()` after teardown. Solo `runXAudit()` uses the same rule: summary flags for abort/disconnect, throw only for unexpected adaptor/capability failures.

`onTabStop` still running when the session aborts is not awaited beyond the current notify phase. `disconnect()` after abort is a no-op.

Iframe tab stops are skipped, not errors. Focus theft, F55, and similar 3.2.1 findings are consumer scoring on `contextSignals`, not orchestrator exceptions.

## Per-audit policy (not orchestrator policy)

Each audit package owns:

- Scoring (indicator present, covered fraction vs WCAG 2.4.11, context-change vs 3.2.1)
- `elementLimit`, `timeout`, `failedElementLimit`
- Result type and summary counts
- Package-specific options (`skipStyleCheck`, `screenshotDiffThreshold`)

Focus-appearance keeps `pixelmatch` / `pngjs`. The orchestrator captures PNG bytes; it does not decide whether an indicator exists.

The orchestrator’s `obscuring` capability includes the 250ms re-check on full cover, so scoring packages see the settled measurement and do not poke the page.

Context-change scoring, including abort-on-navigation, reads `contextSignals`. If signals include `navigation`, the orchestrator aborts the session after notifying consumers of that stop so 3.2.1 can record the finding.

## Testing

- **Orchestrator unit tests** (fake adaptor): capability union shrinks after `disconnect()`; `ensureUnfocusedPair()` is a no-capture if nobody declared it or nobody calls it; style-check-only stops take no screenshots; a second `ensureUnfocusedPair()` on the same stop does not recapture; order is drain → obscuring → optional blur/screenshot; iframes skipped; abort vs disconnect; attach-after-run throws; teardown runs on failure; zero consumers no-ops; blur noise is cleared before the next drain.
- **Audit unit tests**: canned snapshots into `onTabStop`. No browser. Appearance keeps style vs pixel-diff tests. Obscuring and context-change port PR #22’s pure scoring tests.
- **Per-package integration tests**: solo `runXAudit()` against that package’s fixtures (sticky footer, overlay, new-window, auto-submit, theft, navigation, existing 2.4.7 fixtures).
- **One shared-session integration test** in `tab-orchestrator`: attach all three, assert a single `pressTab` sequence, then disconnect the appearance consumer and assert later stops take no screenshots while the others still receive `onTabStop`.

Each package’s summary is independent. Shared-session tests never assert a mixed appearance/context row list.

## Implementation order

1. Extract `@a11y-pulse/tab-orchestrator` with adaptor, loop, `activeElement`, markers, `unfocusedPair`, consumer attach/disconnect. Port 2.4.7 onto it so `runFocusAppearanceAudit` behaviour matches today’s package.
2. Add `obscuring` (including the full-cover re-check) and publish `@a11y-pulse/focus-not-obscured-audit`.
3. Add `contextObservers` / `contextSignals` and publish `@a11y-pulse/context-change-on-focus-audit`.
4. Shared-session integration test.
5. Follow-up in `a11y-pulse`: switch Puppeteer import; optionally attach all three to one orchestrator per page.

Do not ship 2.4.11 or 3.2.1 inside `focus-appearance-audit` as an intermediate state.
