import { getSelector } from "@a11y-pulse/browser-adaptor/dom";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { FocusAppearanceAuditAdaptor } from "./adaptor";
import {
	type ActiveElementInfo,
	type ContextChangeDrain,
	type FocusProbe,
	runFocusAppearanceAudit,
	runFocusLoop,
} from "./audit";
import {
	baselineScript,
	blurScript,
	clearAttributedScript,
	clearContextFocusInsScript,
	clearMarkersScript,
	clearObscurerScript,
	drainContextObserverScript,
	elementRectScript,
	focusScript,
	installContextObserverScript,
	isCenterObscuredScript,
	locationHrefScript,
	measureObscuringScript,
	obscurerHandleScript,
	pageDimensionsScript,
	probeActiveElementScript,
	scrollToCenterScript,
} from "./browser-scripts";
import type { ContextChangeSignals } from "./context-change";
import type { Rect, StyleSnapshot } from "./detection";
import type { ObscuredMeasurement } from "./obscuring";
import type { DetectionMethod } from "./result";

const EMPTY_STYLES: StyleSnapshot = { element: {}, before: {}, after: {} };
const OPTIONS = {
	elementLimit: 100,
	baselineElementLimit: 200,
	screenshotSettleDelay: 0,
	screenshotClipBuffer: 10,
	screenshotDiffThreshold: 0,
	skipStyleCheck: false,
	failedElementLimit: 0,
	timeout: 0,
	measureObscuring: true,
	measureContextChange: true,
	obscuringRecheckDelay: 0,
};

function emptySignals(): ContextChangeSignals {
	return {
		openedWindow: false,
		submittedForm: false,
		focusRemoved: false,
		redirect: null,
		softUrlChange: false,
		navigation: false,
	};
}

function info(index: number): ActiveElementInfo {
	return {
		index,
		isBody: false,
		isIframe: false,
		selector: `#e${index}`,
		html: `<button>${index}</button>`,
		styles: EMPTY_STYLES,
		rect: { x: 0, y: 0, width: 10, height: 10 },
	};
}

function scriptedProbe(script: {
	hasFocus: boolean[];
	active: (ActiveElementInfo | null)[];
	indicator: (DetectionMethod | null)[];
	obscured?: (ObscuredMeasurement | null)[];
	context?: ContextChangeDrain[];
}): FocusProbe {
	let focusCall = 0;
	let activeCall = 0;
	let indicatorCall = 0;
	let obscuredCall = 0;
	let contextCall = 0;

	return {
		captureBaseline: async () => new Map(),
		hasFocus: async () => script.hasFocus[focusCall++] ?? false,
		pressTab: async () => {},
		settle: async () => {},
		probeActiveElement: async () => script.active[activeCall++] ?? null,
		installContextObserver: async () => {},
		drainContextSignals: async () =>
			script.context?.[contextCall++] ?? {
				signals: emptySignals(),
			},
		clearContextNoise: async () => {},
		measureObscuring: async () => script.obscured?.[obscuredCall++] ?? null,
		detectIndicator: async () => script.indicator[indicatorCall++] ?? null,
		clearMarkers: async () => {},
	};
}

/**
 * A probe that processes `hangAfter` elements and then wedges forever on the
 * next settle, modelling a page interaction that never resolves. Only a timeout
 * can end an audit driven by this probe.
 */
function hangingProbe(script: {
	active: ActiveElementInfo[];
	indicator: (DetectionMethod | null)[];
	hangAfter: number;
}): FocusProbe {
	let settleCall = 0;
	let activeCall = 0;
	let indicatorCall = 0;

	return {
		captureBaseline: async () => new Map(),
		hasFocus: async () => true,
		pressTab: async () => {},
		settle: () =>
			settleCall++ < script.hangAfter
				? Promise.resolve()
				: new Promise<void>(() => {}),
		probeActiveElement: async () => script.active[activeCall++] ?? null,
		installContextObserver: async () => {},
		drainContextSignals: async () => ({ signals: emptySignals() }),
		clearContextNoise: async () => {},
		measureObscuring: async () => null,
		detectIndicator: async () => script.indicator[indicatorCall++] ?? null,
		clearMarkers: async () => {},
	};
}

describe("runFocusLoop", () => {
	it("bails out when the document loses focus", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, false],
				active: [info(0)],
				indicator: ["style"],
			}),
			OPTIONS,
		);

		expect(result.summary.passed).toBe(1);
		expect(result.summary.failed).toBe(0);
	});

	it("stops when focus cycles back to an already-seen element", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, true, true],
				active: [info(0), info(0)],
				indicator: ["style"],
			}),
			OPTIONS,
		);

		expect(result.summary.checked).toBe(1);
	});

	it("skips iframes without recording or detecting them", async () => {
		const iframe: ActiveElementInfo = {
			...info(0),
			index: null,
			isIframe: true,
			selector: "iframe",
		};
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, true, false],
				active: [iframe, info(1)],
				indicator: ["style"],
			}),
			OPTIONS,
		);

		// Only the real control is recorded; the frame is passed through.
		expect(result.summary.checked).toBe(1);
		expect(result.elements).toHaveLength(1);
		expect(result.elements[0]?.selector).toBe("#e1");
	});

	it("keeps tabbing through a frame that reports itself on every inner stop", async () => {
		// document.activeElement is the same <iframe> for each control inside it;
		// the loop must not record duplicates or wedge on the repeated element.
		const iframe: ActiveElementInfo = {
			...info(0),
			index: null,
			isIframe: true,
			selector: "iframe",
		};
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, true, true, false],
				active: [iframe, iframe, info(1)],
				indicator: ["style"],
			}),
			OPTIONS,
		);

		expect(result.summary.checked).toBe(1);
		expect(result.elements[0]?.selector).toBe("#e1");
	});

	it("stops when focus reaches the body", async () => {
		const body: ActiveElementInfo = { ...info(0), isBody: true };
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, true],
				active: [info(0), body],
				indicator: ["style"],
			}),
			OPTIONS,
		);

		expect(result.summary.checked).toBe(1);
	});

	it("records elements without an indicator as failed", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, true, false],
				active: [info(0), info(1)],
				indicator: ["style", null],
			}),
			OPTIONS,
		);

		const failed = result.elements.filter((e) => !e.passed);
		expect(failed).toHaveLength(1);
		expect(failed[0]?.selector).toBe("#e1");
		expect(result.summary.failed).toBe(1);
	});

	it("records the detection method for passing elements", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, false],
				active: [info(0)],
				indicator: ["pixel-diff"],
			}),
			OPTIONS,
		);

		expect(result.elements[0]?.detectionMethod).toBe("pixel-diff");
	});

	it("processes untracked elements and is still bounded by elementLimit", async () => {
		const untracked: ActiveElementInfo = { ...info(0), index: null };
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, true, true, true],
				active: [untracked, untracked, untracked, untracked],
				indicator: ["style", "style", "style", "style"],
			}),
			{ ...OPTIONS, elementLimit: 3 },
		);

		expect(result.summary.checked).toBe(3);
		expect(result.summary.reachedLimit).toBe(true);
	});

	it("respects elementLimit", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, true, true, true, true],
				active: [info(0), info(1), info(2), info(3), info(4)],
				indicator: ["style", "style", "style", "style", "style"],
			}),
			{ ...OPTIONS, elementLimit: 2 },
		);

		expect(result.summary.checked).toBe(2);
		expect(result.summary.reachedLimit).toBe(true);
	});
});

describe("runFocusLoop — failedElementLimit", () => {
	it("finishes early once the failed-element limit is reached", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, true, true, true, true],
				active: [info(0), info(1), info(2), info(3), info(4)],
				indicator: [null, null, null, null, null],
			}),
			{ ...OPTIONS, failedElementLimit: 2 },
		);

		expect(result.summary.checked).toBe(2);
		expect(result.summary.failed).toBe(2);
		expect(result.summary.reachedFailedElementLimit).toBe(true);
		// Stopping on failures is distinct from exhausting the element budget.
		expect(result.summary.reachedLimit).toBe(false);
	});

	it("counts only failures, not passes, toward the limit", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, true, true, true, true],
				active: [info(0), info(1), info(2), info(3), info(4)],
				indicator: ["style", null, "style", null, "style"],
			}),
			{ ...OPTIONS, failedElementLimit: 2 },
		);

		// pass, fail, pass, fail → the second failure lands on the fourth element.
		expect(result.summary.checked).toBe(4);
		expect(result.summary.passed).toBe(2);
		expect(result.summary.failed).toBe(2);
		expect(result.summary.reachedFailedElementLimit).toBe(true);
	});

	it("never finishes early when the limit is 0", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, true, true, false],
				active: [info(0), info(1), info(2)],
				indicator: [null, null, null],
			}),
			{ ...OPTIONS, failedElementLimit: 0 },
		);

		expect(result.summary.checked).toBe(3);
		expect(result.summary.failed).toBe(3);
		expect(result.summary.reachedFailedElementLimit).toBe(false);
	});
});

describe("runFocusLoop — timeout", () => {
	it("returns the results gathered so far when the timeout fires", async () => {
		const result = await runFocusLoop(
			hangingProbe({
				active: [info(0), info(1), info(2), info(3)],
				indicator: ["style", "style", "style", "style"],
				hangAfter: 2,
			}),
			{ ...OPTIONS, timeout: 50 },
		);

		expect(result.summary.timedOut).toBe(true);
		expect(result.summary.checked).toBe(2);
		expect(result.summary.passed).toBe(2);
		expect(result.elements).toHaveLength(2);
	}, 2000);

	it("times out with no results when the audit wedges immediately", async () => {
		const result = await runFocusLoop(
			hangingProbe({ active: [info(0)], indicator: ["style"], hangAfter: 0 }),
			{ ...OPTIONS, timeout: 50 },
		);

		expect(result.summary.timedOut).toBe(true);
		expect(result.summary.checked).toBe(0);
	}, 2000);

	it("does not time out when the timeout is 0", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, true, false],
				active: [info(0), info(1)],
				indicator: ["style", "style"],
			}),
			{ ...OPTIONS, timeout: 0 },
		);

		expect(result.summary.timedOut).toBe(false);
		expect(result.summary.checked).toBe(2);
	});

	it("completes normally when the audit finishes before the timeout", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, true, false],
				active: [info(0), info(1)],
				indicator: ["style", "style"],
			}),
			{ ...OPTIONS, timeout: 10_000 },
		);

		expect(result.summary.timedOut).toBe(false);
		expect(result.summary.checked).toBe(2);
	});
});

function solidPng(
	width: number,
	height: number,
	rgb: [number, number, number],
): Buffer {
	const png = new PNG({ width, height });

	for (let i = 0; i < png.data.length; i += 4) {
		png.data[i] = rgb[0];
		png.data[i + 1] = rgb[1];
		png.data[i + 2] = rgb[2];
		png.data[i + 3] = 255;
	}

	return PNG.sync.write(png);
}

type AdaptorScript = {
	/** Per-call results for isCenterObscuredScript. Defaults to false. */
	obscured?: boolean[];
	/** Per-call results for elementRectScript. */
	rects?: Rect[];
	/** How many tab stops have focus before the loop ends. */
	tabStops?: number;
	/** The interned payload returned by baselineScript. */
	baseline?: ReturnType<typeof baselineScript>;
	/** The active element returned by probeActiveElementScript. */
	active?: ReturnType<typeof probeActiveElementScript>;
};

type AdaptorRecord = {
	baselineLimit: number | undefined;
	scrolls: number;
	clips: Rect[];
};

/**
 * A scripted in-memory adaptor. Dispatches on the identity of the injected
 * browser-script functions; the inline `document.hasFocus()` arrow is the only
 * unknown function, so it lands in the fallthrough branch.
 */
function fakeAdaptor(script: AdaptorScript = {}): {
	adaptor: FocusAppearanceAuditAdaptor;
	record: AdaptorRecord;
} {
	const record: AdaptorRecord = {
		baselineLimit: undefined,
		scrolls: 0,
		clips: [],
	};

	const tabStops = script.tabStops ?? 1;
	let hasFocusCalls = 0;
	let obscuredCalls = 0;
	let rectCalls = 0;

	const active = script.active ?? {
		index: null,
		isBody: false,
		isIframe: false,
		html: "<button>x</button>",
		styles: { element: {}, before: {}, after: {} },
		rect: { x: 100, y: 100, width: 40, height: 20 },
	};

	const adaptor: FocusAppearanceAuditAdaptor = {
		// biome-ignore lint/suspicious/noExplicitAny: dispatching on script identity needs loose types
		async evaluate(fn: any, ...args: any[]): Promise<any> {
			if (fn === baselineScript) {
				record.baselineLimit = args[2];

				return script.baseline ?? { styles: [], entries: [] };
			}

			if (fn === probeActiveElementScript) {
				return active;
			}

			if (fn === getSelector) {
				return "#fake";
			}

			if (fn === pageDimensionsScript) {
				return { width: 2000, height: 4000 };
			}

			if (fn === isCenterObscuredScript) {
				return script.obscured?.[obscuredCalls++] ?? false;
			}

			if (fn === scrollToCenterScript) {
				record.scrolls++;

				return undefined;
			}

			if (fn === elementRectScript) {
				return (
					script.rects?.[rectCalls++] ?? {
						x: 100,
						y: 100,
						width: 40,
						height: 20,
					}
				);
			}

			if (
				fn === blurScript ||
				fn === focusScript ||
				fn === clearMarkersScript ||
				fn === installContextObserverScript ||
				fn === clearObscurerScript ||
				fn === clearAttributedScript ||
				fn === clearContextFocusInsScript
			) {
				return undefined;
			}

			if (fn === locationHrefScript) {
				return "http://fake/";
			}

			if (fn === drainContextObserverScript) {
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
				return {
					coveredFraction: 0,
					fullyObscured: false,
					offscreen: false,
					opacity: "opaque",
					obscuredByHtml: null,
					hasObscurer: false,
				};
			}

			if (fn === obscurerHandleScript) {
				return null;
			}

			// The only remaining evaluate is the inline `document.hasFocus()` check.
			return hasFocusCalls++ < tabStops;
		},
		async evaluateHandle() {
			return {};
		},
		async disposeRef() {},
		async pressTab() {},
		async pressEnter() {},
		async screenshotClip(clip: Rect) {
			record.clips.push(clip);

			return solidPng(8, 8, [255, 255, 255]);
		},
		async ensureFocusReporting() {},
	};

	return { adaptor, record };
}

describe("runFocusAppearanceAudit", () => {
	it("defaults the baseline limit to twice elementLimit", async () => {
		const { adaptor, record } = fakeAdaptor({ tabStops: 0 });

		await runFocusAppearanceAudit(adaptor, { elementLimit: 64 });

		expect(record.baselineLimit).toBe(128);
	});

	it("does not finish early by default", async () => {
		// Every white-on-white element fails the pixel diff, so the only thing
		// keeping the audit going to all three tab stops is the disabled default.
		const { adaptor } = fakeAdaptor({ tabStops: 3 });

		const result = await runFocusAppearanceAudit(adaptor, {});

		expect(result.summary.checked).toBe(3);
		expect(result.summary.failed).toBe(3);
		expect(result.summary.reachedFailedElementLimit).toBe(false);
	});

	it("does not time out by default", async () => {
		const { adaptor } = fakeAdaptor({ tabStops: 2 });

		const result = await runFocusAppearanceAudit(adaptor, {});

		expect(result.summary.timedOut).toBe(false);
		expect(result.summary.checked).toBe(2);
	});

	it("centres the element before screenshotting when its centre is obscured", async () => {
		const { adaptor, record } = fakeAdaptor({
			obscured: [true],
			tabStops: 1,
		});

		await runFocusAppearanceAudit(adaptor, { screenshotSettleDelay: 0 });

		expect(record.scrolls).toBe(1);
	});

	it("does not scroll when the element's centre is visible", async () => {
		const { adaptor, record } = fakeAdaptor({
			obscured: [false],
			tabStops: 1,
		});

		await runFocusAppearanceAudit(adaptor, { screenshotSettleDelay: 0 });

		expect(record.scrolls).toBe(0);
	});

	it("fails loudly when an entry references a missing snapshot", async () => {
		// A dangling styleIndex means the baseline payload violated its own
		// invariant; degrading silently would disguise the bug as a slow audit.
		const { adaptor } = fakeAdaptor({
			tabStops: 0,
			baseline: {
				styles: [],
				entries: [
					{
						index: 0,
						styleIndex: 0,
						rect: { x: 0, y: 0, width: 10, height: 10 },
					},
				],
			},
		});

		await expect(runFocusAppearanceAudit(adaptor, {})).rejects.toThrow(
			/missing style/i,
		);
	});

	it("resolves interned baseline snapshots for the style check", async () => {
		// Two elements share one unique snapshot via styleIndex; the probed
		// element's outline change must pass via the style check (no screenshots),
		// proving the interned snapshot was resolved into the baseline map.
		const rect = { x: 100, y: 100, width: 40, height: 20 };
		const { adaptor, record } = fakeAdaptor({
			tabStops: 1,
			baseline: {
				styles: [
					{ element: { "outline-style": "none" }, before: {}, after: {} },
				],
				entries: [
					{ index: 0, styleIndex: 0, rect },
					{ index: 1, styleIndex: 0, rect },
				],
			},
			active: {
				index: 1,
				isBody: false,
				isIframe: false,
				html: "<button>x</button>",
				styles: {
					element: { "outline-style": "auto" },
					before: {},
					after: {},
				},
				rect,
			},
		});

		const result = await runFocusAppearanceAudit(adaptor, {
			screenshotSettleDelay: 0,
		});

		expect(result.elements[0]?.detectionMethod).toBe("style");
		expect(record.clips).toHaveLength(0);
	});

	it("frames the unfocused screenshot from the rect measured after blur", async () => {
		// A fixed-position element: its page-relative rect changes between the
		// focused measurement (page scrolled down) and the post-blur measurement.
		const focused = { x: 100, y: 2100, width: 40, height: 20 };
		const unfocused = { x: 92, y: 96, width: 40, height: 20 };
		const { adaptor, record } = fakeAdaptor({
			rects: [focused, unfocused],
			tabStops: 1,
		});

		await runFocusAppearanceAudit(adaptor, { screenshotSettleDelay: 0 });

		expect(record.clips).toHaveLength(2);
		expect(record.clips[0]).toEqual({ x: 90, y: 2090, width: 60, height: 40 });
		// Same size, anchored so the element sits at the same 10px offset.
		expect(record.clips[1]).toEqual({ x: 82, y: 86, width: 60, height: 40 });
	});
});

describe("runFocusLoop - measureObscuring", () => {
	const opaqueCover: ObscuredMeasurement = {
		coveredFraction: 1,
		fullyObscured: true,
		offscreen: false,
		opacity: "opaque",
		obscuredBy: { selector: "footer.sticky", html: '<footer class="sticky">' },
	};

	it("records the obscuring measurement before detectIndicator", async () => {
		const order: string[] = [];
		const probe = scriptedProbe({
			hasFocus: [true, false],
			active: [info(0)],
			indicator: ["style"],
			obscured: [opaqueCover],
		});
		const originalMeasure = probe.measureObscuring;
		const originalDetect = probe.detectIndicator;
		probe.measureObscuring = async (el) => {
			order.push("measure");
			return originalMeasure(el);
		};
		probe.detectIndicator = async (el, baseline) => {
			order.push("detect");
			return originalDetect(el, baseline);
		};

		const result = await runFocusLoop(probe, OPTIONS);

		expect(order).toEqual(["measure", "detect"]);
		expect(result.elements[0]?.obscured).toEqual(opaqueCover);
		expect(result.summary.obscured.violations).toBe(1);
	});

	it("skips the obscuring seam when measureObscuring is false", async () => {
		let measured = 0;
		const probe = scriptedProbe({
			hasFocus: [true, false],
			active: [info(0)],
			indicator: ["style"],
			obscured: [opaqueCover],
		});
		const original = probe.measureObscuring;
		probe.measureObscuring = async (el) => {
			measured++;
			return original(el);
		};

		const result = await runFocusLoop(probe, {
			...OPTIONS,
			measureObscuring: false,
		});

		expect(measured).toBe(0);
		expect(result.elements[0]?.obscured).toBeUndefined();
		expect(result.summary.obscured.checked).toBe(0);
	});

	it("counts unknown-opacity full cover as incomplete", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, false],
				active: [info(0)],
				indicator: ["style"],
				obscured: [
					{
						coveredFraction: 1,
						fullyObscured: true,
						offscreen: false,
						opacity: "unknown",
						obscuredBy: null,
					},
				],
			}),
			OPTIONS,
		);

		expect(result.summary.obscured.incomplete).toBe(1);
		expect(result.summary.obscured.violations).toBe(0);
	});

	it("does not count partial cover as a violation", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, false],
				active: [info(0)],
				indicator: ["style"],
				obscured: [
					{
						coveredFraction: 0.4,
						fullyObscured: false,
						offscreen: false,
						opacity: "opaque",
						obscuredBy: null,
					},
				],
			}),
			OPTIONS,
		);

		expect(result.summary.obscured.violations).toBe(0);
		expect(result.summary.obscured.checked).toBe(1);
	});
});

describe("runFocusLoop - context change", () => {
	it("records a new-window violation on the focused element", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, false],
				active: [info(0)],
				indicator: ["style"],
				context: [
					{
						signals: { ...emptySignals(), openedWindow: true },
					},
				],
			}),
			OPTIONS,
		);

		expect(result.elements[0]?.contextChange).toEqual([
			{ kind: "new-window", bucket: "violation" },
		]);
		expect(result.summary.contextChange.violations).toBe(1);
	});

	it("records focus-removed without counting it as a focus-appearance pass", async () => {
		const body: ActiveElementInfo = { ...info(0), isBody: true };
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, true],
				active: [body],
				indicator: [],
				context: [
					{
						signals: { ...emptySignals(), focusRemoved: true },
						attributed: {
							selector: "#blurred",
							html: '<input id="blurred">',
						},
					},
				],
			}),
			OPTIONS,
		);

		expect(result.elements).toHaveLength(1);
		expect(result.elements[0]?.selector).toBe("#blurred");
		expect(result.elements[0]?.passed).toBe(false);
		expect(result.elements[0]?.appearanceMeasured).toBe(false);
		expect(result.elements[0]?.contextChange).toEqual([
			{ kind: "focus-removed", bucket: "violation" },
		]);
		expect(result.summary.passed).toBe(0);
		expect(result.summary.checked).toBe(0);
		expect(result.summary.failed).toBe(0);
		expect(result.summary.contextChange.violations).toBe(1);
	});

	it("aborts on navigation without counting it as a focus-appearance pass", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, true, true],
				active: [info(0), info(1)],
				indicator: ["style", "style"],
				context: [
					{
						signals: { ...emptySignals(), navigation: true },
						attributed: { selector: "#nav", html: '<a id="nav">' },
					},
				],
			}),
			OPTIONS,
		);

		expect(result.summary.abortedForNavigation).toBe(true);
		expect(result.elements).toHaveLength(1);
		expect(result.elements[0]?.appearanceMeasured).toBe(false);
		expect(result.elements[0]?.passed).toBe(false);
		expect(result.summary.checked).toBe(0);
		expect(result.summary.passed).toBe(0);
		expect(result.elements[0]?.contextChange).toEqual([
			{ kind: "navigation", bucket: "violation" },
		]);
	});

	it("skips indicator and obscuring when focus is redirected outside", async () => {
		let measured = 0;
		let detected = 0;
		const probe = scriptedProbe({
			hasFocus: [true, false],
			active: [info(1)],
			indicator: ["style"],
			obscured: [
				{
					coveredFraction: 1,
					fullyObscured: true,
					offscreen: false,
					opacity: "opaque",
					obscuredBy: { selector: "footer", html: "<footer>" },
				},
			],
			context: [
				{
					signals: { ...emptySignals(), redirect: "outside" },
					attributed: {
						selector: "#thief",
						html: '<input id="thief">',
					},
				},
			],
		});
		const originalMeasure = probe.measureObscuring;
		const originalDetect = probe.detectIndicator;
		probe.measureObscuring = async (el) => {
			measured++;
			return originalMeasure(el);
		};
		probe.detectIndicator = async (el, baseline) => {
			detected++;
			return originalDetect(el, baseline);
		};

		const result = await runFocusLoop(probe, OPTIONS);

		expect(measured).toBe(0);
		expect(detected).toBe(0);
		expect(result.elements).toHaveLength(1);
		expect(result.elements[0]?.selector).toBe("#thief");
		expect(result.elements[0]?.appearanceMeasured).toBe(false);
		expect(result.elements[0]?.passed).toBe(false);
		expect(result.elements[0]?.obscured).toBeUndefined();
		expect(result.elements[0]?.contextChange).toEqual([
			{ kind: "focus-redirected-outside", bucket: "violation" },
		]);
		expect(result.summary.checked).toBe(0);
		expect(result.summary.passed).toBe(0);
		expect(result.summary.obscured.violations).toBe(0);
	});

	it("does not treat pixel-diff blur/refocus as F55 on the next stop", async () => {
		let polluted = false;
		let activeCall = 0;
		const probe = scriptedProbe({
			hasFocus: [true, true, false],
			active: [info(0), info(1)],
			indicator: ["pixel-diff", "style"],
		});

		probe.detectIndicator = async () => {
			// Model the pixel-diff path leaving focusin noise as if blur hit body.
			polluted = true;
			return "pixel-diff";
		};
		probe.clearContextNoise = async () => {
			polluted = false;
		};
		probe.drainContextSignals = async () => {
			if (polluted) {
				return {
					signals: { ...emptySignals(), focusRemoved: true },
					attributed: { selector: "#ghost", html: '<button id="ghost">' },
				};
			}

			return { signals: emptySignals() };
		};
		probe.probeActiveElement = async () => {
			const list = [info(0), info(1)];
			return list[activeCall++] ?? null;
		};

		const result = await runFocusLoop(probe, OPTIONS);

		expect(result.summary.checked).toBe(2);
		expect(
			result.elements.some((e) =>
				e.contextChange?.some((f) => f.kind === "focus-removed"),
			),
		).toBe(false);
	});

	it("does not treat a clean settle as focus-removed", async () => {
		const result = await runFocusLoop(
			scriptedProbe({
				hasFocus: [true, false],
				active: [info(0)],
				indicator: ["style"],
			}),
			OPTIONS,
		);

		expect(result.elements[0]?.contextChange).toBeUndefined();
		expect(result.summary.contextChange.violations).toBe(0);
	});

	it("skips context observation when measureContextChange is false", async () => {
		let drained = 0;
		const probe = scriptedProbe({
			hasFocus: [true, false],
			active: [info(0)],
			indicator: ["style"],
			context: [
				{
					signals: { ...emptySignals(), openedWindow: true },
				},
			],
		});
		const original = probe.drainContextSignals;
		probe.drainContextSignals = async (el) => {
			drained++;
			return original(el);
		};

		const result = await runFocusLoop(probe, {
			...OPTIONS,
			measureContextChange: false,
		});

		expect(drained).toBe(0);
		expect(result.elements[0]?.contextChange).toBeUndefined();
	});
});
