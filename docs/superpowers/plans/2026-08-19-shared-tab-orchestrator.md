# Shared Tab Orchestrator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract a publishable `@a11y-pulse/tab-orchestrator` that runs one Tab pass for multiple audits, then ship WCAG 2.4.7, 2.4.11, and 3.2.1 as separate packages that can run solo or attach to a shared session.

**Architecture:** The orchestrator owns the browser adaptor, markers, tab loop, and page mutations. Each audit is a `TabConsumer` that declares capabilities, scores `TabStopSnapshot`s, and calls `session.disconnect()` when it is done. `unfocusedPair` is declared at attach time but captured only when a remaining declarer calls `session.ensureUnfocusedPair()` (memoized per stop), so 2.4.7 still pixel-diffs only on a style miss.

**Tech Stack:** TypeScript (Node `>=22`), npm workspaces, Vitest, tsup, Biome, Puppeteer (optional peer of `tab-orchestrator` only), `pixelmatch`/`pngjs` (focus-appearance only).

## Global Constraints

- Node `>=22`.
- One published npm package per criterion; `@a11y-pulse/tab-orchestrator` is not an audit.
- Audit packages depend on `tab-orchestrator`; they must not depend on each other.
- Do not ship 2.4.11 or 3.2.1 inside `focus-appearance-audit` at any intermediate commit.
- `runFocusAppearanceAudit(adaptor, options)` remains the solo public API.
- `@a11y-pulse/focus-appearance-audit/puppeteer` is removed; Puppeteer adaptor lives at `@a11y-pulse/tab-orchestrator/puppeteer`.
- Focus-appearance still re-exports the `BrowserAdaptor` type.
- Never uninstall session-lifetime setup; only skip per-stop work.
- No session-level timeout option. Per-audit `timeout` is implemented by the consumer calling `disconnect()`. When the last remaining consumer disconnects, abort in-flight settle so solo timeout still returns.
- Do not change 2.4.7 detection heuristics (`stylesIndicateFocus`, `alignedRegionsDiffer`, clip buffer, diff threshold floor of 1).
- PolyForm Shield 1.0.0 on every new package (copy `packages/focus-appearance-audit/LICENSE.md`).
- A11y Pulse runner import change is a follow-up in the `a11y-pulse` repo, not this plan.

---

## File structure

```
packages/tab-orchestrator/
  package.json
  LICENSE.md
  README.md
  tsup.config.ts
  tsconfig.json
  tsconfig.build.json
  vitest.config.ts
  vitest.integration.config.ts
  src/
    index.ts
    adaptor.ts
    types.ts
    orchestrator.ts
    orchestrator.test.ts
    clip.ts                    // bufferedClip (moved from detection.ts)
    clip.test.ts
    focus-style.ts             // FOCUS_STYLE_PROPERTIES
    browser-scripts.ts
    browser-scripts.test.ts
    get-selector.ts
    get-selector.test.ts
    get-selector.dom.test.ts
    truncate-html.ts
    truncate-html.test.ts
    unfocused-pair.ts
    obscuring.ts               // measurement types + in-page result mapping (Task 8)
    context-signals.ts         // drain types (Task 10)
    adaptors/puppeteer.ts
    adaptors/puppeteer.test.ts
  tests/integration/
    helpers/serve-fixtures.ts
    shared-session.test.ts     // Task 12
    fixtures/...

packages/focus-appearance-audit/
  src/audit.ts                 // createFocusAppearanceAudit + runFocusAppearanceAudit
  src/detection.ts             // scoring only; import StyleSnapshot/Rect from tab-orchestrator
  src/index.ts                 // drop ./puppeteer; re-export BrowserAdaptor
  package.json                 // workspace dep; drop puppeteer export and peer

packages/focus-not-obscured-audit/          // Task 9
packages/context-change-on-focus-audit/     // Task 11
```

Move (do not copy-and-leave) from focus-appearance into tab-orchestrator: `adaptor.ts`, `adaptors/puppeteer.ts`, `adaptors/puppeteer.test.ts`, `browser-scripts.ts`, `browser-scripts.test.ts`, `get-selector.ts`, `get-selector.test.ts`, `get-selector.dom.test.ts`, `truncate-html.ts`, `truncate-html.test.ts`, `focus-style.ts`. After the move, focus-appearance must not contain those files.

---

### Task 1: Scaffold `@a11y-pulse/tab-orchestrator` and move the adaptor

**Files:**
- Create: `packages/tab-orchestrator/package.json`
- Create: `packages/tab-orchestrator/tsconfig.json`, `tsconfig.build.json`, `tsup.config.ts`, `vitest.config.ts`, `LICENSE.md`, `src/index.ts`
- Move: `packages/focus-appearance-audit/src/adaptor.ts` → `packages/tab-orchestrator/src/adaptor.ts`
- Move: `packages/focus-appearance-audit/src/adaptors/puppeteer.ts` → `packages/tab-orchestrator/src/adaptors/puppeteer.ts`
- Move: `packages/focus-appearance-audit/src/adaptors/puppeteer.test.ts` → `packages/tab-orchestrator/src/adaptors/puppeteer.test.ts`
- Modify: `packages/focus-appearance-audit/src/audit.ts` (temporary import path so the workspace still typechecks)
- Modify: `packages/focus-appearance-audit/package.json` (workspace dependency; keep `./puppeteer` until Task 7)
- Modify: `packages/focus-appearance-audit/src/index.ts` (re-export adaptor types from tab-orchestrator)
- Test: `packages/tab-orchestrator/src/adaptors/puppeteer.test.ts`

**Interfaces:**
- Consumes: nothing new
- Produces: `BrowserAdaptor`, `ElementRef`, `PuppeteerAdaptor`, package `@a11y-pulse/tab-orchestrator`

- [ ] **Step 1: Create the package manifest and TypeScript/tsup/vitest config**

`packages/tab-orchestrator/package.json`:

```json
{
	"name": "@a11y-pulse/tab-orchestrator",
	"version": "0.1.0",
	"description": "Shared Tab-session runner for A11y Pulse keyboard audits.",
	"type": "module",
	"license": "SEE LICENSE IN LICENSE.md",
	"author": "A11y Pulse Limited",
	"homepage": "https://github.com/A11y-Pulse/audits/tree/main/packages/tab-orchestrator#readme",
	"repository": {
		"type": "git",
		"url": "git+https://github.com/A11y-Pulse/audits.git",
		"directory": "packages/tab-orchestrator"
	},
	"bugs": {
		"url": "https://github.com/A11y-Pulse/audits/issues"
	},
	"engines": {
		"node": ">=22"
	},
	"exports": {
		".": {
			"types": "./dist/index.d.ts",
			"import": "./dist/index.js"
		},
		"./puppeteer": {
			"types": "./dist/adaptors/puppeteer.d.ts",
			"import": "./dist/adaptors/puppeteer.js"
		}
	},
	"files": ["dist", "README.md", "LICENSE.md"],
	"scripts": {
		"build": "tsup && tsc -p tsconfig.build.json",
		"typecheck": "tsc --noEmit",
		"test:unit": "vitest run",
		"test:integration": "vitest run --config vitest.integration.config.ts",
		"test": "npm run typecheck && npm run test:unit",
		"prepublishOnly": "npm run build"
	},
	"publishConfig": {
		"access": "public"
	},
	"peerDependencies": {
		"puppeteer": "^25.5.0"
	},
	"peerDependenciesMeta": {
		"puppeteer": {
			"optional": true
		}
	},
	"devDependencies": {
		"happy-dom": "^20.11.2",
		"puppeteer": "^25.5.0"
	}
}
```

Copy `packages/focus-appearance-audit/tsconfig.json`, `tsconfig.build.json`, `tsup.config.ts`, `vitest.config.ts` into `packages/tab-orchestrator/` with no logic changes. `tsup.config.ts` entry stays `["src/index.ts", "src/adaptors/puppeteer.ts"]`. Copy `LICENSE.md` from focus-appearance.

`packages/tab-orchestrator/src/index.ts`:

```ts
export type { BrowserAdaptor, ElementRef, Rect } from "./adaptor";
```

- [ ] **Step 2: Move the adaptor and rename the interface**

`git mv` the three adaptor files. In `adaptor.ts`, rename `FocusAppearanceAuditAdaptor` to `BrowserAdaptor` and keep `Rect` / `ElementRef` as they are today. In `puppeteer.ts`, implement `BrowserAdaptor` and keep the WeakSet focus-emulation cache, but change the warning string to `"Could not enable focus emulation for the tab orchestrator"`.

- [ ] **Step 3: Point focus-appearance at the new package so the workspace still builds**

Add to `packages/focus-appearance-audit/package.json` dependencies:

```json
"@a11y-pulse/tab-orchestrator": "*"
```

Keep its `./puppeteer` export for this task only (removed in Task 7).

`packages/focus-appearance-audit/src/adaptor.ts` becomes a re-export shim:

```ts
export type {
	BrowserAdaptor,
	BrowserAdaptor as FocusAppearanceAuditAdaptor,
	ElementRef,
	Rect,
} from "@a11y-pulse/tab-orchestrator";
```

Update `packages/focus-appearance-audit/src/index.ts` to re-export `BrowserAdaptor` from `@a11y-pulse/tab-orchestrator` (keep the `FocusAppearanceAuditAdaptor as BrowserAdaptor` alias so existing type imports still work).

- [ ] **Step 4: Install workspace links and run the moved unit test**

Run:

```bash
cd /Users/joseph/dev/a11y-pulse/audits
npm install
npm run test:unit --workspace=@a11y-pulse/tab-orchestrator
npm run test:unit --workspace=@a11y-pulse/focus-appearance-audit
```

Expected: PASS. PuppeteerAdaptor tests run in the new package. Focus-appearance unit tests still pass via the shim.

- [ ] **Step 5: Commit**

```bash
git add packages/tab-orchestrator packages/focus-appearance-audit/package.json packages/focus-appearance-audit/src/adaptor.ts packages/focus-appearance-audit/src/index.ts packages/focus-appearance-audit/src/adaptors package-lock.json
git commit -m "Extract BrowserAdaptor into @a11y-pulse/tab-orchestrator."
```

---

### Task 2: Shared types and `bufferedClip`

**Files:**
- Create: `packages/tab-orchestrator/src/types.ts`
- Create: `packages/tab-orchestrator/src/clip.ts`
- Test: `packages/tab-orchestrator/src/clip.test.ts`
- Modify: `packages/tab-orchestrator/src/index.ts`
- Modify: `packages/focus-appearance-audit/src/detection.ts` to import `Rect` from tab-orchestrator and keep `bufferedClip` re-exported from clip.ts until Task 6 deletes the local copy

**Interfaces:**
- Consumes: `Rect` from `adaptor.ts`
- Produces: `Capability`, `TabConsumer`, `TabSessionHandle`, `TabStopSnapshot`, `SessionEndReason`, `StyleSnapshot`, `ActiveElementInfo`, `UnfocusedPair`, `bufferedClip`

- [ ] **Step 1: Write the failing clip test**

Move the `describe("bufferedClip")` block out of `packages/focus-appearance-audit/src/detection.test.ts` into `packages/tab-orchestrator/src/clip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { bufferedClip } from "./clip";

describe("bufferedClip", () => {
	it("pads the rect by the buffer on every side", () => {
		const rect = { x: 100, y: 100, width: 40, height: 20 };
		const clip = bufferedClip(rect, 800, 600, 10);
		expect(clip).toEqual({ x: 90, y: 90, width: 60, height: 40 });
	});

	it("shrinks the padding at the page edges", () => {
		const rect = { x: 4, y: 100, width: 40, height: 495 };
		const clip = bufferedClip(rect, 800, 600, 10);
		expect(clip.x).toBe(0);
		expect(clip.width).toBe(40 + 4 + 10);
		expect(clip.y).toBe(90);
		expect(clip.height).toBe(495 + 10 + 5);
	});

	it("clamps to zero when the element is off the top-left of the document", () => {
		const rect = { x: -30, y: -12, width: 40, height: 20 };
		const clip = bufferedClip(rect, 800, 600, 10);
		expect(clip.x).toBe(0);
		expect(clip.y).toBe(0);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/clip.test.ts --config packages/tab-orchestrator/vitest.config.ts` from `packages/tab-orchestrator`.

Expected: FAIL with `Cannot find module './clip'`.

- [ ] **Step 3: Add `types.ts` and `clip.ts`**

`packages/tab-orchestrator/src/types.ts`:

```ts
import type { Rect } from "./adaptor";

export type StyleSnapshot = {
	element: Record<string, string>;
	before: Record<string, string>;
	after: Record<string, string>;
};

export type ActiveElementInfo = {
	index: number | null;
	isBody: boolean;
	isIframe: boolean;
	selector: string;
	html: string;
	styles: StyleSnapshot;
	rect: Rect;
};

export type Capability =
	| "baselineStyles"
	| "contextSignals"
	| "obscuring"
	| "unfocusedPair";

export type SessionEndReason =
	| "completed"
	| "lostFocus"
	| "navigation"
	| "failed";

export type UnfocusedPair = {
	focusedScreenshot: Uint8Array;
	unfocusedScreenshot: Uint8Array;
	unfocusedStyles: StyleSnapshot;
	focusedRect: Rect;
	unfocusedRect: Rect;
	focusedClip: Rect;
	unfocusedClip: Rect;
	scale: number;
};

export type TabStopSnapshot = {
	tabIndex: number;
	activeElement: ActiveElementInfo;
	baselineStyles?: StyleSnapshot;
	contextSignals?: ContextChangeDrain;
	obscuring?: ObscuredMeasurement;
};

/** Filled in Task 10. Optional on the snapshot until then. */
export type ContextChangeDrain = {
	signals: ContextChangeSignals;
};

export type ContextChangeSignals = {
	openedWindow: boolean;
	submittedForm: boolean;
	focusRemoved: boolean;
	redirect: "outside" | "same-subtree" | null;
	softUrlChange: boolean;
	navigation: boolean;
};

/** Filled in Task 8. Optional on the snapshot until then. */
export type ObscuredMeasurement = {
	coveredFraction: number;
	fullyObscured: boolean;
	offscreen: boolean;
	opacity: "opaque" | "semi-transparent" | "unknown";
	obscuredBy: { selector: string; html: string } | null;
};

export type TabSessionHandle = {
	disconnect(): void;
	ensureUnfocusedPair(): Promise<UnfocusedPair>;
};

export type TabConsumer = {
	readonly capabilities: ReadonlySet<Capability>;
	onSessionStart?(session: TabSessionHandle): void | Promise<void>;
	onTabStop(
		snapshot: TabStopSnapshot,
		session: TabSessionHandle,
	): void | Promise<void>;
	onSessionEnd?(reason: SessionEndReason): void;
};
```

`onSessionStart` is required so a per-audit `timeout` can start when `run()` starts, not when `createXAudit()` is called. `onSessionEnd` is how still-attached consumers learn a session abort reason.

Copy `bufferedClip` verbatim from `packages/focus-appearance-audit/src/detection.ts` into `packages/tab-orchestrator/src/clip.ts`. Change `detection.ts` to `export { bufferedClip } from "@a11y-pulse/tab-orchestrator"` after exporting it from the orchestrator index, **or** keep a local re-export:

```ts
export { bufferedClip } from "@a11y-pulse/tab-orchestrator";
```

and delete the function body from `detection.ts`. Leave `alignedRegionsDiffer` / `stylesIndicateFocus` in `detection.ts`. Move `StyleSnapshot` and `Rect` types: `Rect` already lives on the adaptor; `detection.ts` should `import type { StyleSnapshot } from "@a11y-pulse/tab-orchestrator"` and `export type { StyleSnapshot }` so appearance public types do not break.

Export the new types from `packages/tab-orchestrator/src/index.ts`.

- [ ] **Step 4: Run clip tests and appearance unit tests**

```bash
npm run test:unit --workspace=@a11y-pulse/tab-orchestrator
npm run test:unit --workspace=@a11y-pulse/focus-appearance-audit
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tab-orchestrator/src packages/focus-appearance-audit/src/detection.ts packages/focus-appearance-audit/src/detection.test.ts
git commit -m "Add tab-orchestrator consumer types and move bufferedClip."
```

---

### Task 3: Orchestrator lifecycle (no tabbing yet)

**Files:**
- Create: `packages/tab-orchestrator/src/orchestrator.ts`
- Test: `packages/tab-orchestrator/src/orchestrator.test.ts`
- Modify: `packages/tab-orchestrator/src/index.ts`

**Interfaces:**
- Consumes: `BrowserAdaptor`, `TabConsumer`, `TabSessionOptions`
- Produces: `createTabOrchestrator(adaptor, options) => { attach, run }`

- [ ] **Step 1: Write the failing lifecycle tests**

`packages/tab-orchestrator/src/orchestrator.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import type { BrowserAdaptor } from "./adaptor";
import { createTabOrchestrator } from "./orchestrator";
import type { TabConsumer } from "./types";

function dummyAdaptor(): BrowserAdaptor {
	return {
		evaluate: vi.fn(async () => undefined),
		evaluateHandle: vi.fn(async () => ({})),
		disposeRef: vi.fn(async () => undefined),
		pressTab: vi.fn(async () => undefined),
		screenshotClip: vi.fn(async () => new Uint8Array()),
		ensureFocusReporting: vi.fn(async () => undefined),
	};
}

function consumer(): TabConsumer {
	return {
		capabilities: new Set(),
		onTabStop: async () => {},
	};
}

describe("createTabOrchestrator lifecycle", () => {
	it("returns without tabbing when no consumers are attached", async () => {
		const adaptor = dummyAdaptor();
		const orchestrator = createTabOrchestrator(adaptor);
		await orchestrator.run();
		expect(adaptor.pressTab).not.toHaveBeenCalled();
		expect(adaptor.ensureFocusReporting).not.toHaveBeenCalled();
	});

	it("throws when attach is called after run() has started", async () => {
		const orchestrator = createTabOrchestrator(dummyAdaptor());
		orchestrator.attach(consumer());
		const running = orchestrator.run();
		expect(() => orchestrator.attach(consumer())).toThrow(
			/attach after run\(\) has started/i,
		);
		await running.catch(() => {});
	});

	it("throws when run() is called twice", async () => {
		const orchestrator = createTabOrchestrator(dummyAdaptor());
		await orchestrator.run();
		await expect(orchestrator.run()).rejects.toThrow(/already been called/i);
	});
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/orchestrator.test.ts` from `packages/tab-orchestrator`.

Expected: FAIL with `Cannot find module './orchestrator'`.

- [ ] **Step 3: Write the minimal orchestrator**

`packages/tab-orchestrator/src/orchestrator.ts`:

```ts
import type { BrowserAdaptor } from "./adaptor";
import type { TabConsumer } from "./types";

export const DEFAULT_SCREENSHOT_SETTLE_DELAY = 33;
export const DEFAULT_SCREENSHOT_CLIP_BUFFER = 10;
export const DEFAULT_MARKER_LIMIT = 1024;
export const MARKER_ATTR = "data-a11y-focus-idx";

export type TabSessionOptions = {
	screenshotSettleDelay?: number;
	screenshotClipBuffer?: number;
	markerLimit?: number;
	baselineElementLimit?: number;
};

export type TabOrchestrator = {
	attach(consumer: TabConsumer): void;
	run(): Promise<void>;
};

export function createTabOrchestrator(
	adaptor: BrowserAdaptor,
	options: TabSessionOptions = {},
): TabOrchestrator {
	const consumers: TabConsumer[] = [];
	let started = false;
	let ran = false;

	return {
		attach(consumer) {
			if (started) {
				throw new Error("Cannot attach after run() has started");
			}
			consumers.push(consumer);
		},
		async run() {
			if (ran) {
				throw new Error("run() has already been called");
			}
			ran = true;
			started = true;

			if (consumers.length === 0) {
				return;
			}

			void adaptor;
			void options;
			throw new Error("tab loop not implemented");
		},
	};
}
```

The “attach after run started” test calls `attach` on the same tick as `run()`. Set `started = true` synchronously at the top of `run()` before the first `await` so that test passes. Zero-consumer `run()` must return before throwing `tab loop not implemented`.

Export `createTabOrchestrator` and `TabSessionOptions` from `index.ts`.

- [ ] **Step 4: Run the lifecycle tests**

Run: `npx vitest run src/orchestrator.test.ts` from `packages/tab-orchestrator`.

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tab-orchestrator/src/orchestrator.ts packages/tab-orchestrator/src/orchestrator.test.ts packages/tab-orchestrator/src/index.ts
git commit -m "Add tab orchestrator attach/run lifecycle."
```

---

### Task 4: Tab loop with `activeElement`, markers, disconnect, and session abort

**Files:**
- Modify: `packages/tab-orchestrator/src/orchestrator.ts`
- Modify: `packages/tab-orchestrator/src/orchestrator.test.ts`
- Move: `browser-scripts.ts`, `browser-scripts.test.ts`, `get-selector.ts`, `get-selector.test.ts`, `get-selector.dom.test.ts`, `truncate-html.ts`, `truncate-html.test.ts`, `focus-style.ts` into `packages/tab-orchestrator/src/`
- Modify: `packages/focus-appearance-audit/src/audit.ts` imports of those modules to `@a11y-pulse/tab-orchestrator` (or relative shim files that re-export) so appearance still compiles until Task 7

**Interfaces:**
- Consumes: `baselineScript`, `probeActiveElementScript`, `activeElementHandleScript`, `clearMarkersScript`, `getSelector`, `truncateHtml`, `FOCUS_STYLE_PROPERTIES`, `MARKER_ATTR`
- Produces: a working loop that notifies consumers, skips iframes, ends on body/null/cycle/`lostFocus`, and honors `disconnect()`

- [ ] **Step 1: Move page scripts and helper modules**

`git mv` the files listed above. Fix internal imports (`StyleSnapshot` / `Rect` now come from `./adaptor` or `./types`). Export the scripts, `getSelector`, `truncateHtml`, and `FOCUS_STYLE_PROPERTIES` from `packages/tab-orchestrator/src/index.ts`. Add `happy-dom` is already a devDependency from Task 1.

In focus-appearance, replace local imports with `@a11y-pulse/tab-orchestrator` for those symbols. Delete the old files (git mv already did). `audit.ts` may still import `baselineScript` etc. from the orchestrator package for `createAdaptorProbe` until Task 7 deletes that probe.

- [ ] **Step 2: Write failing loop tests**

Append to `orchestrator.test.ts`. Use a fake adaptor that dispatches on function identity, same pattern as `fakeAdaptor` in `packages/focus-appearance-audit/src/audit.test.ts`.

```ts
import {
	activeElementHandleScript,
	baselineScript,
	clearMarkersScript,
	probeActiveElementScript,
} from "./browser-scripts";
import { getSelector } from "./get-selector";
import type { ActiveElementInfo, TabConsumer, TabStopSnapshot } from "./types";

const EMPTY_STYLES = { element: {}, before: {}, after: {} };

function info(index: number, extra: Partial<ActiveElementInfo> = {}): ActiveElementInfo {
	return {
		index,
		isBody: false,
		isIframe: false,
		selector: `#e${index}`,
		html: `<button>${index}</button>`,
		styles: EMPTY_STYLES,
		rect: { x: 0, y: 0, width: 10, height: 10 },
		...extra,
	};
}

function recordingConsumer(
	capabilities: Array<TabConsumer["capabilities"] extends ReadonlySet<infer C> ? C : never> = [],
	onStop?: (snapshot: TabStopSnapshot, disconnect: () => void) => void | Promise<void>,
): TabConsumer & { stops: TabStopSnapshot[]; sessionEnds: string[] } {
	const record = {
		stops: [] as TabStopSnapshot[],
		sessionEnds: [] as string[],
		capabilities: new Set(capabilities),
		async onTabStop(snapshot, session) {
			record.stops.push(snapshot);
			await onStop?.(snapshot, () => session.disconnect());
		},
		onSessionEnd(reason) {
			record.sessionEnds.push(reason);
		},
	};
	return record;
}

function loopAdaptor(script: {
	hasFocus?: boolean[];
	active?: Array<Omit<ActiveElementInfo, "selector"> | null>;
}): BrowserAdaptor {
	let focusCall = 0;
	let activeCall = 0;
	return {
		async evaluate(fn, ..._args) {
			if (fn === baselineScript) {
				return { styles: [EMPTY_STYLES], entries: [] };
			}
			if (fn === probeActiveElementScript) {
				return script.active?.[activeCall++] ?? { index: null, isBody: true, isIframe: false, html: "", styles: EMPTY_STYLES, rect: { x: 0, y: 0, width: 0, height: 0 } };
			}
			if (fn === getSelector) {
				return "#fake";
			}
			if (fn === clearMarkersScript) {
				return undefined;
			}
			return script.hasFocus?.[focusCall++] ?? false;
		},
		async evaluateHandle(fn) {
			if (fn === activeElementHandleScript) {
				return { kind: "active" };
			}
			return {};
		},
		async disposeRef() {},
		async pressTab() {},
		async screenshotClip() {
			return new Uint8Array([1]);
		},
		async ensureFocusReporting() {},
	};
}
```

Tests to add:

```ts
describe("tab loop", () => {
	it("notifies consumers for each non-iframe tab stop", async () => {
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: [true, true, true],
				active: [info(0), info(1)],
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(a);
		await orchestrator.run();
		expect(a.stops.map((s) => s.activeElement.index)).toEqual([0, 1]);
		expect(a.stops.map((s) => s.tabIndex)).toEqual([1, 2]);
		expect(a.sessionEnds).toEqual(["completed"]);
	});

	it("skips iframe tab stops", async () => {
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: [true, true, true],
				active: [info(0, { isIframe: true }), info(1)],
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(a);
		await orchestrator.run();
		expect(a.stops.map((s) => s.activeElement.index)).toEqual([1]);
		expect(a.stops[0]?.tabIndex).toBe(1);
	});

	it("aborts on marker cycle", async () => {
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: [true, true, true],
				active: [info(0), info(0)],
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(a);
		await orchestrator.run();
		expect(a.stops).toHaveLength(1);
		expect(a.sessionEnds).toEqual(["completed"]);
	});

	it("aborts when the document loses focus", async () => {
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: [false],
				active: [info(0)],
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(a);
		await orchestrator.run();
		expect(a.stops).toHaveLength(0);
		expect(a.sessionEnds).toEqual(["lostFocus"]);
	});

	it("stops notifying a consumer after disconnect() and continues for others", async () => {
		const a = recordingConsumer([], async (_s, disconnect) => {
			disconnect();
		});
		const b = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: [true, true, true],
				active: [info(0), info(1)],
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(a);
		orchestrator.attach(b);
		await orchestrator.run();
		expect(a.stops).toHaveLength(1);
		expect(b.stops).toHaveLength(2);
		expect(a.sessionEnds).toEqual([]);
		expect(b.sessionEnds).toEqual(["completed"]);
	});

	it("does not execute unfocusedPair when nobody calls ensureUnfocusedPair", async () => {
		const screenshots: number[] = [];
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [info(0)],
		});
		adaptor.screenshotClip = async () => {
			screenshots.push(1);
			return new Uint8Array([1]);
		};
		const a = recordingConsumer(["unfocusedPair"]);
		const orchestrator = createTabOrchestrator(adaptor, {
			screenshotSettleDelay: 0,
		});
		orchestrator.attach(a);
		await orchestrator.run();
		expect(screenshots).toEqual([]);
	});

	it("throws from ensureUnfocusedPair when the consumer did not declare it", async () => {
		const a = recordingConsumer([], async (_s, _d) => {
			// session is captured below via a wrapper
		});
		let thrown: Error | undefined;
		const wrapped: TabConsumer = {
			capabilities: new Set(),
			async onTabStop(snapshot, session) {
				try {
					await session.ensureUnfocusedPair();
				} catch (error) {
					thrown = error as Error;
				}
				await a.onTabStop(snapshot, session);
			},
		};
		const orchestrator = createTabOrchestrator(
			loopAdaptor({ hasFocus: [true, true], active: [info(0)] }),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(wrapped);
		await orchestrator.run();
		expect(thrown?.message).toMatch(/did not declare unfocusedPair/i);
	});
});
```

Fix `loopAdaptor` `info()` usage: `active` from `probeActiveElementScript` has no `selector`; the orchestrator adds it via `getSelector`. The fake can return the `info()` object without selector and ignore extra fields.

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/orchestrator.test.ts` from `packages/tab-orchestrator`.

Expected: FAIL with `tab loop not implemented`.

- [ ] **Step 4: Implement the loop**

Replace the `throw new Error("tab loop not implemented")` branch with:

1. `await adaptor.ensureFocusReporting()`.
2. Always `evaluate(baselineScript, FOCUS_STYLE_PROPERTIES, MARKER_ATTR, markerLimit)` where `markerLimit = max(options.markerLimit ?? DEFAULT_MARKER_LIMIT, options.baselineElementLimit ?? 0)`. If nobody declared `baselineStyles`, still run baselineScript for markers (today’s script marks and snapshots together; keep that — extra interned styles are unused).
3. `onSessionStart` for each consumer, passing a handle bound to that consumer.
4. Loop while `attached.size > 0`:
   - `hasFocus` via `adaptor.evaluate(() => document.hasFocus())`. False → `end("lostFocus")`.
   - `pressTab()`, then `setTimeout` for `screenshotSettleDelay`.
   - If `attached.size === 0` after settle (last consumer timed out), break without probing.
   - Probe `probeActiveElementScript`. Body/null → `end("completed")`.
   - Iframe → `continue` (do not notify, do not increment tabIndex).
   - If `index !== null` and `visited.has(index)` → `end("completed")`; else add to visited.
   - Resolve selector via `evaluateHandle(activeElementHandleScript)` + `getSelector` + `disposeRef`. Truncate html with `truncateHtml`.
   - Build snapshot `{ tabIndex: ++tabIndex, activeElement, baselineStyles? }`. Include `baselineStyles` only if some remaining consumer declared `baselineStyles` and the marker exists in the interned table.
   - Snapshot remaining consumers **before** notify. For each, `await onTabStop(snapshot, handle)`. A disconnect during this phase removes them from `attached` but does not skip later consumers in the snapshot.
   - Handle `ensureUnfocusedPair` in this task by throwing if the consumer’s capabilities lack `unfocusedPair`, and by throwing `"unfocusedPair capture not implemented"` if they declared it (implemented in Task 6). The “nobody calls it” test must pass.
5. `finally`: `evaluate(clearMarkersScript, MARKER_ATTR)`.
6. `end(reason)` calls `onSessionEnd(reason)` for every still-attached consumer, then clears `attached`.

If `evaluate` / `pressTab` throws: `finally` still clears markers, then `end("failed")` for remaining consumers, then rethrow.

Last-consumer `disconnect()` during `onTabStop` should not abort the current notify phase. After notify, the loop condition `attached.size > 0` stops further tabs.

Export `MARKER_ATTR` from the package if tests need it; they should not.

- [ ] **Step 5: Run orchestrator and appearance unit tests plus moved DOM tests**

```bash
npm run test:unit --workspace=@a11y-pulse/tab-orchestrator
npm run test:unit --workspace=@a11y-pulse/focus-appearance-audit
```

Expected: PASS. Appearance still uses its old `runFocusLoop` against the re-exported scripts.

- [ ] **Step 6: Commit**

```bash
git add packages/tab-orchestrator packages/focus-appearance-audit
git commit -m "Run a shared tab loop with disconnect and session abort."
```

---

### Task 5: Lazy `ensureUnfocusedPair`

**Files:**
- Create: `packages/tab-orchestrator/src/unfocused-pair.ts`
- Modify: `packages/tab-orchestrator/src/orchestrator.ts`
- Modify: `packages/tab-orchestrator/src/orchestrator.test.ts`
- Modify: `packages/tab-orchestrator/src/browser-scripts.ts` (already has blur/focus/rect/scroll/isCenterObscured/pageDimensions)

**Interfaces:**
- Consumes: `bufferedClip`, `blurScript`, `focusScript`, `elementRectScript`, `isCenterObscuredScript`, `scrollToCenterScript`, `pageDimensionsScript`, `activeElementHandleScript`
- Produces: `captureUnfocusedPair(adaptor, options, handle) => UnfocusedPair`

- [ ] **Step 1: Write failing capture tests**

Add to `orchestrator.test.ts`:

```ts
it("captures unfocusedPair once per stop when a declarer calls ensureUnfocusedPair", async () => {
	const clips: unknown[] = [];
	const adaptor = loopAdaptor({
		hasFocus: [true, true],
		active: [info(0)],
	});
	const originalEvaluate = adaptor.evaluate.bind(adaptor);
	adaptor.evaluate = async (fn, ...args) => {
		if (fn === pageDimensionsScript) {
			return { width: 2000, height: 4000 };
		}
		if (fn === isCenterObscuredScript) {
			return false;
		}
		if (fn === elementRectScript) {
			return { x: 10, y: 20, width: 30, height: 40 };
		}
		if (fn === blurScript || fn === focusScript || fn === scrollToCenterScript) {
			return undefined;
		}
		return originalEvaluate(fn, ...args);
	};
	adaptor.screenshotClip = async (clip) => {
		clips.push(clip);
		return new Uint8Array([clips.length]);
	};

	const a: TabConsumer = {
		capabilities: new Set(["unfocusedPair"]),
		async onTabStop(_snapshot, session) {
			const first = await session.ensureUnfocusedPair();
			const second = await session.ensureUnfocusedPair();
			expect(first).toBe(second);
			expect(first.focusedScreenshot).toEqual(new Uint8Array([1]));
			expect(first.unfocusedScreenshot).toEqual(new Uint8Array([2]));
		},
	};

	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: 0,
		screenshotClipBuffer: 10,
	});
	orchestrator.attach(a);
	await orchestrator.run();
	expect(clips).toHaveLength(2);
});

it("scrolls to center before capture when the element centre is covered", async () => {
	let scrolls = 0;
	const adaptor = loopAdaptor({
		hasFocus: [true, true],
		active: [info(0)],
	});
	const originalEvaluate = adaptor.evaluate.bind(adaptor);
	adaptor.evaluate = async (fn, ...args) => {
		if (fn === isCenterObscuredScript) {
			return true;
		}
		if (fn === scrollToCenterScript) {
			scrolls++;
			return undefined;
		}
		if (fn === pageDimensionsScript) {
			return { width: 2000, height: 4000 };
		}
		if (fn === elementRectScript) {
			return { x: 10, y: 20, width: 30, height: 40 };
		}
		if (fn === blurScript || fn === focusScript) {
			return undefined;
		}
		return originalEvaluate(fn, ...args);
	};
	adaptor.screenshotClip = async () => new Uint8Array([1]);

	const a: TabConsumer = {
		capabilities: new Set(["unfocusedPair"]),
		async onTabStop(_snapshot, session) {
			await session.ensureUnfocusedPair();
		},
	};
	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: 0,
	});
	orchestrator.attach(a);
	await orchestrator.run();
	expect(scrolls).toBe(1);
});
```

Import `blurScript`, `focusScript`, `elementRectScript`, `isCenterObscuredScript`, `scrollToCenterScript`, `pageDimensionsScript` from `./browser-scripts`.

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL with `unfocusedPair capture not implemented`.

- [ ] **Step 3: Implement capture**

Port `fallbackPixelDiff` from `packages/focus-appearance-audit/src/audit.ts` into `packages/tab-orchestrator/src/unfocused-pair.ts` as `captureUnfocusedPair`. Differences:

- Return `{ focusedScreenshot, unfocusedScreenshot, unfocusedStyles }` plus the clip anchors needed by appearance? Appearance currently computes anchors itself from rects. Return the screenshots and `unfocusedStyles` only, as specified. Focused styles are already on `snapshot.activeElement.styles`.
- Read unfocused styles after blur with a small in-file evaluate: reuse `probeActiveElementScript` is wrong (activeElement may already be body). Instead evaluate a `elementStylesScript(el, props)` — add this function to `browser-scripts.ts` as a clone of the style-reading portion of `probeActiveElementScript` that takes an element argument. Unit-test it in `browser-scripts.test.ts` with happy-dom: blur a button, pass the handle-equivalent element, expect computed styles back.
- Do **not** call `alignedRegionsDiffer`. Do **not** import pixelmatch.
- Dispose the element handle in `finally`.

Wire `ensureUnfocusedPair` on the per-consumer handle:

```ts
const pairByStop = { current: null as Promise<UnfocusedPair> | null };

// reset pairByStop.current = null at the start of each iteration

ensureUnfocusedPair: () => {
  if (!consumer.capabilities.has("unfocusedPair")) {
    throw new Error("Consumer did not declare unfocusedPair");
  }
  if (!remainingDeclarers()) {
    throw new Error("Consumer did not declare unfocusedPair");
  }
  pairByStop.current ??= captureUnfocusedPair(adaptor, resolved, activeHandle);
  return pairByStop.current;
}
```

Hold the active element handle across the notify phase so capture can blur the same node. Dispose it after notify (after all `ensureUnfocusedPair` promises settle).

- [ ] **Step 4: Run unit tests**

```bash
npm run test:unit --workspace=@a11y-pulse/tab-orchestrator
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tab-orchestrator
git commit -m "Capture unfocused screenshots lazily when a consumer asks."
```

---

### Task 6: Port 2.4.7 onto the orchestrator

**Files:**
- Modify: `packages/focus-appearance-audit/src/audit.ts`
- Modify: `packages/focus-appearance-audit/src/audit.test.ts`
- Modify: `packages/focus-appearance-audit/src/result.ts`
- Modify: `packages/focus-appearance-audit/src/index.ts`
- Delete: `runFocusLoop` / `FocusProbe` / `createAdaptorProbe` / `fallbackPixelDiff` from `audit.ts`

**Interfaces:**
- Consumes: `createTabOrchestrator`, `TabConsumer`, `ensureUnfocusedPair`, `stylesIndicateFocus`, `alignedRegionsDiffer`, `omitIdleStyleSnapshot`
- Produces: `createFocusAppearanceAudit(options) => TabConsumer & { result: FocusAppearanceResult }`, `runFocusAppearanceAudit(adaptor, options)`

- [ ] **Step 1: Rewrite appearance unit tests to drive the consumer**

Replace `runFocusLoop` / `scriptedProbe` tests in `audit.test.ts` with tests that attach `createFocusAppearanceAudit` to `createTabOrchestrator(loopAdaptor(...))`.

Required cases (mirror today’s `runFocusLoop` describes):

- Style pass does not call `screenshotClip`.
- Style miss calls `ensureUnfocusedPair` and passes via pixel-diff when `alignedRegionsDiffer` would be true. For unit tests, feed two different PNG bytes and spy `alignedRegionsDiffer` **or** use real tiny PNGs like the existing adaptor tests.
- `failedElementLimit: 1` disconnects after the first failure; a second consumer still receives later stops (attach a recording consumer alongside).
- `elementLimit: 1` disconnects after one stop.
- `timeout` with `screenshotSettleDelay` hung: last remaining consumer disconnects; `run()` resolves with `summary.timedOut === true` and whatever elements were already recorded.
- Iframe skips still yield no appearance row (orchestrator already skips; assert `result.elements` empty for iframe-only then body).

Keep the existing `runFocusAppearanceAudit` fake-adaptor screenshot/scroll tests, but point them at the orchestrator’s scripts (imports from `@a11y-pulse/tab-orchestrator`). They currently dispatch on `blurScript` identity — those identities now live in the orchestrator package.

Add `sessionEnd` to expected summaries as `null` when the consumer disconnected itself, and `"completed"` / `"lostFocus"` when the session ended while attached.

- [ ] **Step 2: Run tests to verify they fail**

```bash
npm run test:unit --workspace=@a11y-pulse/focus-appearance-audit
```

Expected: FAIL with `createFocusAppearanceAudit is not a function`.

- [ ] **Step 3: Implement the consumer and solo runner**

`result.ts` summary becomes:

```ts
summary: {
	checked: number;
	passed: number;
	failed: number;
	reachedLimit: boolean;
	reachedFailedElementLimit: boolean;
	timedOut: boolean;
	sessionEnd: SessionEndReason | null;
};
```

Import `SessionEndReason` from `@a11y-pulse/tab-orchestrator`.

`createFocusAppearanceAudit(options)`:

- `capabilities = skipStyleCheck ? { unfocusedPair } : { baselineStyles, unfocusedPair }`
- `onSessionStart`: if `timeout > 0`, `setTimeout(() => { timedOut = true; session.disconnect(); }, timeout)`.
- `onTabStop`: increment local count. If `elementLimit` reached after this stop, `disconnect()` at the end. Score:
  1. If not `skipStyleCheck` and `snapshot.baselineStyles` and `stylesIndicateFocus(baseline, focused)` → pass `"style"`.
  2. Else `const pair = await session.ensureUnfocusedPair()`, then `alignedRegionsDiffer` using the same clip-anchor math as today’s `fallbackPixelDiff` (element rect from `snapshot.activeElement.rect` for the focused frame; the capture function must also return focused/unfocused rects **or** appearance must re-read them).

Capture-time rects live on `UnfocusedPair` (defined in Task 2) because they may differ from `snapshot.activeElement.rect` after scroll-to-center. Appearance then:

```ts
const differs = alignedRegionsDiffer(
	Buffer.from(pair.focusedScreenshot),
	{
		x: (pair.focusedRect.x - pair.focusedClip.x) * pair.scale,
		y: (pair.focusedRect.y - pair.focusedClip.y) * pair.scale,
	},
	Buffer.from(pair.unfocusedScreenshot),
	{
		x: (pair.unfocusedRect.x - pair.unfocusedClip.x) * pair.scale,
		y: (pair.unfocusedRect.y - pair.unfocusedClip.y) * pair.scale,
	},
	threshold * pair.scale * pair.scale,
);
```

Threshold floor remains `Math.max(1, options.screenshotDiffThreshold ?? 4)`.

On failure, `failureEvidence` uses `omitIdleStyleSnapshot` as today.

`failedElementLimit`: after recording a failure, if `failures >= limit && limit > 0`, `session.disconnect()`.

`onSessionEnd(reason)`: set `result.summary.sessionEnd = reason` unless the consumer already disconnected itself (`sessionEnd` stays `null`).

`runFocusAppearanceAudit`:

```ts
export async function runFocusAppearanceAudit(
	adaptor: BrowserAdaptor,
	options: FocusAppearanceOptions = {},
): Promise<FocusAppearanceResult> {
	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: options.screenshotSettleDelay,
		screenshotClipBuffer: options.screenshotClipBuffer,
		markerLimit: options.elementLimit,
		baselineElementLimit: options.baselineElementLimit,
	});
	const audit = createFocusAppearanceAudit(options);
	orchestrator.attach(audit);
	await orchestrator.run();
	return audit.result;
}
```

Default `elementLimit` remains 1024; `baselineElementLimit` remains `elementLimit * 2`. Pass both into session options so marker budget matches today.

Clear the timeout in `onSessionEnd` / `disconnect` so it cannot fire after `run()` returns.

Delete `FocusProbe`, `runFocusLoop`, `createAdaptorProbe`, `fallbackPixelDiff`.

- [ ] **Step 4: Run unit tests**

```bash
npm run test:unit --workspace=@a11y-pulse/focus-appearance-audit
npm run test:unit --workspace=@a11y-pulse/tab-orchestrator
```

Expected: PASS.

- [ ] **Step 5: Run focus-appearance integration tests**

```bash
npm run test:integration --workspace=@a11y-pulse/focus-appearance-audit
```

Expected: PASS. Integration tests import `PuppeteerAdaptor` from `../../src/adaptors/puppeteer` — update that import to `@a11y-pulse/tab-orchestrator/puppeteer` or `../../../tab-orchestrator/src/adaptors/puppeteer`. Prefer the package subpath; if Vitest cannot resolve `./puppeteer` until build, add to `packages/focus-appearance-audit/vitest.integration.config.ts`:

```ts
resolve: {
	tsconfigPaths: true,
	alias: {
		"@a11y-pulse/tab-orchestrator/puppeteer": new URL(
			"../tab-orchestrator/src/adaptors/puppeteer.ts",
			import.meta.url,
		).pathname,
		"@a11y-pulse/tab-orchestrator": new URL(
			"../tab-orchestrator/src/index.ts",
			import.meta.url,
		).pathname,
	},
},
```

Use `fileURLToPath` if `pathname` is messy on Windows; this repo’s integration tests already run on Ubuntu CI.

- [ ] **Step 6: Commit**

```bash
git add packages/focus-appearance-audit packages/tab-orchestrator
git commit -m "Run focus-appearance as a tab-orchestrator consumer."
```

---

### Task 7: Remove `./puppeteer` from focus-appearance and document the split

**Files:**
- Modify: `packages/focus-appearance-audit/package.json`
- Modify: `packages/focus-appearance-audit/tsup.config.ts` (entry `["src/index.ts"]` only)
- Modify: `packages/focus-appearance-audit/README.md`
- Modify: `packages/focus-appearance-audit/examples/puppeteer/index.mjs`
- Modify: `packages/focus-appearance-audit/examples/puppeteer/package.json` (add `@a11y-pulse/tab-orchestrator`: `file:../../../tab-orchestrator`)
- Create: `packages/tab-orchestrator/README.md`
- Modify: `audits/README.md` package table
- Create: `.changeset/tab-orchestrator-extract.md`

**Interfaces:**
- Consumes: Task 1 exports
- Produces: published export map without `focus-appearance-audit/puppeteer`

- [ ] **Step 1: Drop the export and update docs/example**

Remove `./puppeteer` from focus-appearance `package.json` `exports`. Remove `puppeteer` peerDependencies from focus-appearance (it no longer ships an adaptor). Keep puppeteer as a **devDependency** for integration tests.

README quickstart:

```js
import { runFocusAppearanceAudit } from "@a11y-pulse/focus-appearance-audit";
import { PuppeteerAdaptor } from "@a11y-pulse/tab-orchestrator/puppeteer";
```

Document `createFocusAppearanceAudit` under a “Shared tab session” heading with the spec’s attach/`run()` snippet (appearance-only is enough here).

Write a short `packages/tab-orchestrator/README.md`: what it is, `createTabOrchestrator`, `BrowserAdaptor`, `./puppeteer`, PolyForm Shield.

Add a row to the root `README.md` packages table for `@a11y-pulse/tab-orchestrator`.

`.changeset/tab-orchestrator-extract.md`:

```md
---
"@a11y-pulse/tab-orchestrator": minor
"@a11y-pulse/focus-appearance-audit": minor
---

Extract `@a11y-pulse/tab-orchestrator` and run focus-appearance as a consumer. Import `PuppeteerAdaptor` from `@a11y-pulse/tab-orchestrator/puppeteer`.
```

- [ ] **Step 2: Typecheck, unit tests, lint**

```bash
npm test
npm run lint
```

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add packages/focus-appearance-audit packages/tab-orchestrator README.md .changeset/tab-orchestrator-extract.md
git commit -m "Drop focus-appearance puppeteer export in favor of tab-orchestrator."
```

---

### Task 8: `obscuring` capability in the orchestrator

**Files:**
- Modify: `packages/tab-orchestrator/src/browser-scripts.ts` (add PR #22 measure scripts)
- Modify: `packages/tab-orchestrator/src/browser-scripts.test.ts` (add PR #22 happy-dom cases)
- Modify: `packages/tab-orchestrator/src/orchestrator.ts`
- Modify: `packages/tab-orchestrator/src/orchestrator.test.ts`
- Modify: `packages/tab-orchestrator/src/types.ts` (`ObscuredMeasurement` already declared)

**Interfaces:**
- Consumes: remaining consumers’ capability union
- Produces: `snapshot.obscuring` when any remaining consumer declared `obscuring`; includes the 250ms full-cover re-check

- [ ] **Step 1: Port in-page scripts from PR #22**

From GitHub PR `A11y-Pulse/audits#22` (commit `9dfa412c2d2ff1ddfb05386688055b391782a9c9`), copy these functions into `packages/tab-orchestrator/src/browser-scripts.ts` (do not add them to focus-appearance):

- `MeasureObscuringResult`
- `measureObscuringScript(el, obscurerAttr)`
- `obscurerHandleScript()`
- `clearObscurerScript(obscurerAttr)`

Copy the matching happy-dom tests from that commit’s `browser-scripts.test.ts` additions into `packages/tab-orchestrator/src/browser-scripts.test.ts`.

Constant: `export const OBSCURER_ATTR = "data-a11y-obscurer"` in `orchestrator.ts`.

- [ ] **Step 2: Write a failing orchestrator test for union + re-check**

```ts
it("measures obscuring only while a remaining consumer declared it", async () => {
	const measures: number[] = [];
	const adaptor = loopAdaptor({
		hasFocus: [true, true, true],
		active: [info(0), info(1)],
	});
	const original = adaptor.evaluate.bind(adaptor);
	adaptor.evaluate = async (fn, ...args) => {
		if (fn === measureObscuringScript) {
			measures.push(1);
			return {
				coveredFraction: 0,
				fullyObscured: false,
				offscreen: false,
				opacity: "opaque",
				obscuredByHtml: null,
				hasObscurer: false,
			};
		}
		if (fn === clearObscurerScript || fn === obscurerHandleScript) {
			return fn === obscurerHandleScript ? null : undefined;
		}
		return original(fn, ...args);
	};

	const obscuring = recordingConsumer(["obscuring"], async (_s, disconnect) => {
		disconnect();
	});
	const other = recordingConsumer();
	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: 0,
	});
	orchestrator.attach(obscuring);
	orchestrator.attach(other);
	await orchestrator.run();
	expect(measures).toHaveLength(1);
	expect(obscuring.stops[0]?.obscuring?.fullyObscured).toBe(false);
	expect(other.stops[1]?.obscuring).toBeUndefined();
});
```

- [ ] **Step 3: Run tests to verify they fail**

Expected: FAIL (`measureObscuringScript` not called / `snapshot.obscuring` undefined).

- [ ] **Step 4: Execute obscuring after drain (none yet) and before notify**

After probing `activeElement` and before `onTabStop`:

```ts
if (remainingHas("obscuring")) {
  const handle = /* same active handle */;
  let raw = await adaptor.evaluate(measureObscuringScript, handle, OBSCURER_ATTR);
  if (raw.fullyObscured) {
    await new Promise((r) => setTimeout(r, 250));
    raw = await adaptor.evaluate(measureObscuringScript, handle, OBSCURER_ATTR);
  }
  let obscuredBy = null;
  if (raw.hasObscurer) {
    const obscurer = await adaptor.evaluateHandle(obscurerHandleScript);
    try {
      const selector = await adaptor.evaluate(getSelector, obscurer);
      obscuredBy = { selector, html: truncateHtml(raw.obscuredByHtml ?? "") };
    } finally {
      await adaptor.disposeRef(obscurer);
    }
  }
  snapshot.obscuring = {
    coveredFraction: raw.coveredFraction,
    fullyObscured: raw.fullyObscured,
    offscreen: raw.offscreen,
    opacity: raw.opacity,
    obscuredBy,
  };
  await adaptor.evaluate(clearObscurerScript, OBSCURER_ATTR);
}
```

Do not scroll before this measurement. `ensureUnfocusedPair` may scroll afterwards.

- [ ] **Step 5: Run unit tests**

```bash
npm run test:unit --workspace=@a11y-pulse/tab-orchestrator
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/tab-orchestrator
git commit -m "Measure focus obscuring as an orchestrator capability."
```

---

### Task 9: `@a11y-pulse/focus-not-obscured-audit`

**Files:**
- Create: `packages/focus-not-obscured-audit/` (same scaffold as focus-appearance: package.json, tsconfigs, tsup, vitest, LICENSE, README)
- Create: `packages/focus-not-obscured-audit/src/classify.ts`
- Create: `packages/focus-not-obscured-audit/src/classify.test.ts`
- Create: `packages/focus-not-obscured-audit/src/audit.ts`
- Create: `packages/focus-not-obscured-audit/src/audit.test.ts`
- Create: `packages/focus-not-obscured-audit/src/result.ts`
- Create: `packages/focus-not-obscured-audit/src/index.ts`
- Create: `packages/focus-not-obscured-audit/tests/integration/focus-not-obscured.test.ts`
- Create: fixtures from PR #22: `sticky-footer-obscures.html`, `semi-transparent-overlay.html`, `obscuring-clean.html`
- Create: `.changeset/focus-not-obscured.md`

**Interfaces:**
- Consumes: `createTabOrchestrator`, capability `"obscuring"`, `ObscuredMeasurement`
- Produces: `createFocusNotObscuredAudit`, `runFocusNotObscuredAudit`, `FocusNotObscuredResult`

- [ ] **Step 1: Write failing classify tests**

Copy `classifyObscuring` tests from PR #22 (`obscuring.test.ts`) into `packages/focus-not-obscured-audit/src/classify.test.ts`, importing from `./classify`.

- [ ] **Step 2: Run to verify fail**

```bash
npx vitest run src/classify.test.ts
```

from that package. Expected: FAIL, module not found.

- [ ] **Step 3: Implement `classifyObscuring`**

Copy `classifyObscuring` and its types from PR #22 `obscuring.ts` into `classify.ts`. Re-export `ObscuredMeasurement` from `@a11y-pulse/tab-orchestrator` rather than duplicating the measurement type; keep `ObscuringBucket` and `classifyObscuring` in this package.

- [ ] **Step 4: Write failing consumer tests**

```ts
it("records a violation for opaque full cover and disconnects at elementLimit", async () => {
	const audit = createFocusNotObscuredAudit({ elementLimit: 1 });
	expect(audit.capabilities.has("obscuring")).toBe(true);
	const orchestrator = createTabOrchestrator(
		obscuringAdaptor([
			{
				coveredFraction: 1,
				fullyObscured: true,
				offscreen: false,
				opacity: "opaque",
				obscuredByHtml: "<footer>",
				hasObscurer: true,
			},
			{
				coveredFraction: 0,
				fullyObscured: false,
				offscreen: false,
				opacity: "opaque",
				obscuredByHtml: null,
				hasObscurer: false,
			},
		]),
		{ screenshotSettleDelay: 0 },
	);
	orchestrator.attach(audit);
	await orchestrator.run();
	expect(audit.result.elements).toHaveLength(1);
	expect(audit.result.elements[0]?.bucket).toBe("violation");
	expect(audit.result.summary.reachedLimit).toBe(true);
});
```

`obscuringAdaptor` is `loopAdaptor` plus `measureObscuringScript` dispatch. Put a shared `loopAdaptor` helper in `packages/tab-orchestrator/src/test/fake-adaptor.ts` if duplication with orchestrator tests is painful; otherwise duplicate the 40-line helper in this package’s test file.

- [ ] **Step 5: Implement `createFocusNotObscuredAudit` / `runFocusNotObscuredAudit`**

Capabilities: `new Set(["obscuring"])`.

`onTabStop`: if `snapshot.obscuring` is missing, skip (should not happen). Push `{ selector, html, tabIndex, measurement, bucket: classifyObscuring(measurement) }`. Apply `elementLimit` / `failedElementLimit` / `timeout` the same way as appearance (`failed` = bucket === `"violation"`).

`runFocusNotObscuredAudit` constructs a private orchestrator with `screenshotSettleDelay` from options (default 33) and attaches this consumer. It does not declare `unfocusedPair`.

Integration tests: copy `serve-fixtures.ts`, launch Puppeteer, `runFocusNotObscuredAudit(new PuppeteerAdaptor(page))` against the three fixtures. Sticky footer → at least one violation. Semi-transparent → no violations. Clean → no violations.

Changeset:

```md
---
"@a11y-pulse/focus-not-obscured-audit": minor
---

Add WCAG 2.4.11 Focus Not Obscured (Minimum) as a standalone audit.
```

Add the package to the root README table.

- [ ] **Step 6: Run unit + integration tests and commit**

```bash
npm install
npm run test:unit --workspace=@a11y-pulse/focus-not-obscured-audit
npm run test:integration --workspace=@a11y-pulse/focus-not-obscured-audit
npm run lint
```

Expected: PASS.

```bash
git add packages/focus-not-obscured-audit README.md .changeset/focus-not-obscured.md package-lock.json
git commit -m "Add @a11y-pulse/focus-not-obscured-audit on the shared tab loop."
```

---

### Task 10: `contextSignals` capability in the orchestrator

**Files:**
- Modify: `packages/tab-orchestrator/src/browser-scripts.ts` (install/drain/clear scripts from PR #22)
- Modify: `packages/tab-orchestrator/src/browser-scripts.test.ts`
- Modify: `packages/tab-orchestrator/src/orchestrator.ts`
- Modify: `packages/tab-orchestrator/src/orchestrator.test.ts`

**Interfaces:**
- Consumes: `contextSignals` declaration
- Produces: session install of observers if anyone declared `contextSignals`; per-stop drain **before** obscuring and before `ensureUnfocusedPair`; `snapshot.contextSignals`; session abort `navigation` after notifying that stop; blur noise cleared after `ensureUnfocusedPair`

- [ ] **Step 1: Port observer scripts from PR #22**

Copy from commit `9dfa412`:

- `installContextObserverScript`
- `drainContextObserverScript`
- `clearAttributedScript`
- `clearContextFocusInsScript`
- `locationHrefScript`

and the happy-dom tests under `describe("context observer scripts")`.

- [ ] **Step 2: Write failing orchestrator tests**

```ts
it("drains context signals before measuring obscuring", async () => {
	const order: string[] = [];
	const adaptor = loopAdaptor({
		hasFocus: [true, true],
		active: [info(0)],
	});
	const original = adaptor.evaluate.bind(adaptor);
	adaptor.evaluate = async (fn, ...args) => {
		if (fn === installContextObserverScript) {
			order.push("install");
			return undefined;
		}
		if (fn === drainContextObserverScript) {
			order.push("drain");
			return {
				openedWindow: false,
				submittedForm: false,
				focusRemoved: false,
				redirect: null,
				softUrlChange: false,
				navigation: false,
				attributedHtml: null,
				hasAttributed: false,
			};
		}
		if (fn === measureObscuringScript) {
			order.push("obscure");
			return {
				coveredFraction: 0,
				fullyObscured: false,
				offscreen: false,
				opacity: "opaque",
				obscuredByHtml: null,
				hasObscurer: false,
			};
		}
		return original(fn, ...args);
	};
	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: 0,
	});
	orchestrator.attach(recordingConsumer(["contextSignals", "obscuring"]));
	await orchestrator.run();
	expect(order.slice(0, 3)).toEqual(["install", "drain", "obscure"]);
});

it("does not drain after the last contextSignals consumer disconnects", async () => {
	let drains = 0;
	const adaptor = loopAdaptor({
		hasFocus: [true, true, true],
		active: [info(0), info(1)],
	});
	const original = adaptor.evaluate.bind(adaptor);
	adaptor.evaluate = async (fn, ...args) => {
		if (fn === drainContextObserverScript) {
			drains++;
			return {
				openedWindow: false,
				submittedForm: false,
				focusRemoved: false,
				redirect: null,
				softUrlChange: false,
				navigation: false,
				attributedHtml: null,
				hasAttributed: false,
			};
		}
		if (fn === installContextObserverScript) {
			return undefined;
		}
		return original(fn, ...args);
	};
	const ctx = recordingConsumer(["contextSignals"], async (_s, disconnect) => {
		disconnect();
	});
	const other = recordingConsumer();
	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: 0,
	});
	orchestrator.attach(ctx);
	orchestrator.attach(other);
	await orchestrator.run();
	expect(drains).toBe(1);
});

it("aborts the session after notifying a navigation drain", async () => {
	const adaptor = loopAdaptor({
		hasFocus: [true, true, true],
		active: [info(0), info(1)],
	});
	const original = adaptor.evaluate.bind(adaptor);
	adaptor.evaluate = async (fn, ...args) => {
		if (fn === drainContextObserverScript) {
			return {
				openedWindow: false,
				submittedForm: false,
				focusRemoved: false,
				redirect: null,
				softUrlChange: false,
				navigation: true,
				attributedHtml: null,
				hasAttributed: false,
			};
		}
		if (fn === installContextObserverScript) {
			return undefined;
		}
		return original(fn, ...args);
	};
	const ctx = recordingConsumer(["contextSignals"]);
	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: 0,
	});
	orchestrator.attach(ctx);
	await orchestrator.run();
	expect(ctx.stops).toHaveLength(1);
	expect(ctx.stops[0]?.contextSignals?.signals.navigation).toBe(true);
	expect(ctx.sessionEnds).toEqual(["navigation"]);
});

it("clears context observer noise after ensureUnfocusedPair blur", async () => {
	const order: string[] = [];
	const adaptor = loopAdaptor({
		hasFocus: [true, true],
		active: [info(0)],
	});
	const original = adaptor.evaluate.bind(adaptor);
	adaptor.evaluate = async (fn, ...args) => {
		if (fn === drainContextObserverScript) {
			order.push("drain");
			return {
				openedWindow: false,
				submittedForm: false,
				focusRemoved: false,
				redirect: null,
				softUrlChange: false,
				navigation: false,
				attributedHtml: null,
				hasAttributed: false,
			};
		}
		if (fn === clearContextFocusInsScript || fn === clearAttributedScript) {
			order.push("clear");
			return undefined;
		}
		if (fn === installContextObserverScript) {
			return undefined;
		}
		if (
			fn === pageDimensionsScript ||
			fn === isCenterObscuredScript ||
			fn === elementRectScript ||
			fn === blurScript ||
			fn === focusScript
		) {
			if (fn === pageDimensionsScript) {
				return { width: 100, height: 100 };
			}
			if (fn === isCenterObscuredScript) {
				return false;
			}
			if (fn === elementRectScript) {
				return { x: 0, y: 0, width: 10, height: 10 };
			}
			return undefined;
		}
		return original(fn, ...args);
	};
	adaptor.screenshotClip = async () => new Uint8Array([1]);
	const a: TabConsumer = {
		capabilities: new Set(["contextSignals", "unfocusedPair"]),
		async onTabStop(_s, session) {
			order.push("pair");
			await session.ensureUnfocusedPair();
		},
	};
	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: 0,
	});
	orchestrator.attach(a);
	await orchestrator.run();
	expect(order).toEqual(["drain", "pair", "clear"]);
});
```

- [ ] **Step 3: Run to verify fail**

Expected: FAIL (observers not installed / drain missing).

- [ ] **Step 4: Implement install / drain / abort / blur-noise clear**

At session start, if any attached consumer declared `contextSignals`, `evaluate(installContextObserverScript)` once. Never uninstall.

Each iteration, if remaining consumers declared `contextSignals`, drain after settle and after `activeElement` probe (need the intended vs settled element for redirect classification). Map drain payload → `snapshot.contextSignals = { signals }`. Port PR #22’s redirect classification (`isSameFocusSubtree`) **into the orchestrator drain mapping**, not the audit package: the snapshot’s `signals.redirect` must already be `"outside" | "same-subtree" | null`. Copy `isSameFocusSubtree` into `packages/tab-orchestrator/src/context-signals.ts` with its unit tests from PR #22.

After notify, if `snapshot.contextSignals?.signals.navigation`, `end("navigation")`.

After a successful `ensureUnfocusedPair`, `evaluate(clearContextFocusInsScript)` and `evaluate(clearAttributedScript)` so the next drain does not treat blur/refocus as F55.

Do not install observers when nobody declared `contextSignals`.

- [ ] **Step 5: Run unit tests and commit**

```bash
npm run test:unit --workspace=@a11y-pulse/tab-orchestrator
```

Expected: PASS.

```bash
git add packages/tab-orchestrator
git commit -m "Drain on-focus context signals as an orchestrator capability."
```

---

### Task 11: `@a11y-pulse/context-change-on-focus-audit`

**Files:**
- Create: `packages/context-change-on-focus-audit/` (same scaffold)
- Create: `src/classify.ts`, `src/classify.test.ts` (PR #22 `classifyContextSignals` tests)
- Create: `src/audit.ts`, `src/audit.test.ts`, `src/result.ts`, `src/index.ts`
- Create: integration fixtures from PR #22: `auto-submit-on-focus.html`, `new-window-on-focus.html`, `navigation-on-focus.html`, `focus-theft.html`, `focus-delegation.html`, `focus-removal.html`, `other-page.html`
- Create: `.changeset/context-change-on-focus.md`

**Interfaces:**
- Consumes: capability `"contextSignals"`
- Produces: `createContextChangeOnFocusAudit`, `runContextChangeOnFocusAudit`, `ContextChangeOnFocusResult`

- [ ] **Step 1: Write failing classify tests**

Copy PR #22 `context-change.test.ts` `classifyContextSignals` describe (not `isSameFocusSubtree` — that lives in the orchestrator) into this package.

- [ ] **Step 2: Implement classify + consumer**

Copy `classifyContextSignals` from PR #22 `context-change.ts`. Capabilities: `new Set(["contextSignals"])`.

`onTabStop`: `classifyContextSignals(snapshot.contextSignals.signals)` → element rows with `findings`. `failed` = any finding with `bucket === "violation"`. Same limit/timeout/fail-fast pattern as the other audits.

Integration: new-window and auto-submit → violation; navigation fixture → violation + `sessionEnd === "navigation"`; delegation fixture → no outside-redirect violation.

- [ ] **Step 3: Run tests, lint, commit**

```bash
npm install
npm run test:unit --workspace=@a11y-pulse/context-change-on-focus-audit
npm run test:integration --workspace=@a11y-pulse/context-change-on-focus-audit
npm run lint
```

Expected: PASS.

```bash
git add packages/context-change-on-focus-audit README.md .changeset/context-change-on-focus.md package-lock.json
git commit -m "Add @a11y-pulse/context-change-on-focus-audit on the shared tab loop."
```

---

### Task 12: Shared-session integration test

**Files:**
- Create: `packages/tab-orchestrator/vitest.integration.config.ts`
- Create: `packages/tab-orchestrator/tests/integration/helpers/serve-fixtures.ts` (copy)
- Create: `packages/tab-orchestrator/tests/integration/fixtures/mixed-focus.html` — three tabbable buttons, a sticky footer covering the last one, and a `window.open` on the first button’s focus
- Create: `packages/tab-orchestrator/tests/integration/shared-session.test.ts`
- Modify: `packages/tab-orchestrator/package.json` — add the three audit packages as `devDependencies` with `"*"` and add `test:integration` if not already present

**Interfaces:**
- Consumes: `createTabOrchestrator`, `createFocusAppearanceAudit`, `createFocusNotObscuredAudit`, `createContextChangeOnFocusAudit`, `PuppeteerAdaptor`
- Produces: proof of one `pressTab` sequence and screenshot stop after appearance disconnects

- [ ] **Step 1: Write the failing shared-session test**

Alias workspace packages to source in `vitest.integration.config.ts` (same alias trick as Task 6) so tests do not need `dist/`.

```ts
it("tabs once and stops screenshotting after appearance disconnects", async () => {
	const page = await browser.newPage();
	const press = page.keyboard.press.bind(page.keyboard);
	let tabs = 0;
	page.keyboard.press = async (key, opts) => {
		if (key === "Tab") {
			tabs++;
		}
		return press(key, opts);
	};
	let clips = 0;
	const inner = new PuppeteerAdaptor(page);
	const adaptor: BrowserAdaptor = {
		evaluate: inner.evaluate.bind(inner),
		evaluateHandle: inner.evaluateHandle.bind(inner),
		disposeRef: inner.disposeRef.bind(inner),
		pressTab: inner.pressTab.bind(inner),
		screenshotClip: async (clip, scale) => {
			clips++;
			return inner.screenshotClip(clip, scale);
		},
		get screenshotClipScale() {
			return inner.screenshotClipScale;
		},
		ensureFocusReporting: inner.ensureFocusReporting.bind(inner),
	};

	await page.goto(`${server.url}/mixed-focus.html`);

	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: 33,
	});
	const focus = createFocusAppearanceAudit({
		elementLimit: 1,
		skipStyleCheck: true,
	});
	const obscured = createFocusNotObscuredAudit();
	const context = createContextChangeOnFocusAudit();
	orchestrator.attach(focus);
	orchestrator.attach(obscured);
	orchestrator.attach(context);
	await orchestrator.run();

	expect(focus.result.elements).toHaveLength(1);
	expect(obscured.result.elements.length).toBeGreaterThan(1);
	expect(context.result.elements.length).toBeGreaterThan(1);
	expect(clips).toBe(2); // one unfocusedPair = focused + unfocused, only stop 1
	expect(tabs).toBe(obscured.result.elements.length);
	await page.close();
});
```

`mixed-focus.html`: first control opens a stub window on focus (context finding) but remains tabbable; remaining controls are normal; last control sits under a sticky footer.

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm run test:integration --workspace=@a11y-pulse/tab-orchestrator
```

Expected: FAIL until the fixture/wiring exists; after wiring, it must not take screenshots on later stops.

- [ ] **Step 3: Add the fixture and make the test pass**

If `clips` is not exactly 2 because `skipStyleCheck` still screenshots once per appearance stop, keep `elementLimit: 1` so appearance disconnects after stop 1. Obscuring/context continue without calling `ensureUnfocusedPair`.

- [ ] **Step 4: Full verification**

```bash
npm test
npm run test:integration
npm run lint
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/tab-orchestrator package-lock.json
git commit -m "Prove three audits share one tab pass without extra screenshots."
```

---

## Notes for implementers

- PR #22 in-page scripts are the source of truth for obscuring geometry and context observers. Copy them; do not re-invent hit-testing.
- `isSameFocusSubtree` belongs in `tab-orchestrator` because `signals.redirect` is computed before consumers score.
- First npm publish of the three new packages needs Trusted Publisher entries (`A11y-Pulse` / `audits` / `release.yml`). That is a release-admin step, not a code step.
- Do not update `a11y-pulse/apps/runner` in this repo. After publish, that app must import `PuppeteerAdaptor` from `@a11y-pulse/tab-orchestrator/puppeteer` and may later `attach` all three audits to one orchestrator.
