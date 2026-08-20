import {
	type ActiveElementInfo,
	type BaselinePayload,
	type BrowserAdaptor,
	baselineScript,
	blurScript,
	clearMarkersScript,
	createTabOrchestrator,
	elementRectScript,
	elementStylesScript,
	focusScript,
	getSelector,
	isCenterObscuredScript,
	pageDimensionsScript,
	probeActiveElementScript,
	scrollToCenterScript,
	type TabConsumer,
	type TabStopSnapshot,
} from "@a11y-pulse/tab-orchestrator";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import type { FocusAppearanceAuditAdaptor } from "./adaptor";
import {
	createFocusAppearanceAudit,
	type FocusAppearanceOptions,
	runFocusAppearanceAudit,
} from "./audit";
import type { Rect, StyleSnapshot } from "./detection";

const EMPTY_STYLES: StyleSnapshot = { element: {}, before: {}, after: {} };
const UNFOCUSED_STYLES: StyleSnapshot = {
	element: { "outline-style": "none" },
	before: {},
	after: {},
};
const FOCUSED_STYLES: StyleSnapshot = {
	element: { "outline-style": "auto" },
	before: {},
	after: {},
};
const RECT: Rect = { x: 0, y: 0, width: 10, height: 10 };

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

const WHITE_PNG = new Uint8Array(solidPng(8, 8, [255, 255, 255]));
const BLACK_PNG = new Uint8Array(solidPng(8, 8, [0, 0, 0]));

function info(
	index: number,
	extra: Partial<Omit<ActiveElementInfo, "selector">> = {},
): Omit<ActiveElementInfo, "selector"> {
	return {
		index,
		isBody: false,
		isIframe: false,
		html: `<button>${index}</button>`,
		styles: EMPTY_STYLES,
		rect: RECT,
		...extra,
	};
}

function stylePassActive(index: number): Omit<ActiveElementInfo, "selector"> {
	return info(index, { styles: FOCUSED_STYLES });
}

function stylePassBaseline(indexes: number[]): BaselinePayload {
	return {
		styles: [UNFOCUSED_STYLES],
		entries: indexes.map((index) => ({
			index,
			styleIndex: 0,
			rect: RECT,
		})),
	};
}

function recordingConsumer(): TabConsumer & { stops: TabStopSnapshot[] } {
	const record = {
		stops: [] as TabStopSnapshot[],
		capabilities: new Set<never>(),
		async onTabStop(snapshot: TabStopSnapshot) {
			record.stops.push(snapshot);
		},
	};
	return record;
}

function loopAdaptor(script: {
	hasFocus?: boolean[];
	active?: Array<Omit<ActiveElementInfo, "selector"> | null>;
	baseline?: BaselinePayload;
	pngs?: Uint8Array[];
}): BrowserAdaptor & { clipCalls: number } {
	let focusCall = 0;
	let activeCall = 0;
	let lastIndex: number | null = null;
	let pngCall = 0;
	const adaptor: BrowserAdaptor & { clipCalls: number } = {
		clipCalls: 0,
		evaluate: (async (fn, ..._args) => {
			if (fn === baselineScript) {
				return script.baseline ?? { styles: [EMPTY_STYLES], entries: [] };
			}
			if (fn === probeActiveElementScript) {
				const next = script.active?.[activeCall++] ?? {
					index: null,
					isBody: true,
					isIframe: false,
					html: "",
					styles: EMPTY_STYLES,
					rect: { x: 0, y: 0, width: 0, height: 0 },
				};
				lastIndex = next?.index ?? null;
				return next;
			}
			if (fn === getSelector) {
				return lastIndex === null ? "#fake" : `#e${lastIndex}`;
			}
			if (fn === elementStylesScript) {
				return EMPTY_STYLES;
			}
			if (fn === pageDimensionsScript) {
				return { width: 2000, height: 4000 };
			}
			if (fn === isCenterObscuredScript) {
				return false;
			}
			if (fn === elementRectScript) {
				return { x: 100, y: 100, width: 40, height: 20 };
			}
			if (
				fn === blurScript ||
				fn === focusScript ||
				fn === scrollToCenterScript ||
				fn === clearMarkersScript
			) {
				return undefined;
			}
			return script.hasFocus?.[focusCall++] ?? false;
		}) as BrowserAdaptor["evaluate"],
		async evaluateHandle() {
			return {};
		},
		async disposeRef() {},
		async pressTab() {},
		async screenshotClip() {
			adaptor.clipCalls++;
			const pngs = script.pngs;
			if (pngs !== undefined && pngs.length > 0) {
				return pngs[pngCall++ % pngs.length] ?? WHITE_PNG;
			}
			return WHITE_PNG;
		},
		async ensureFocusReporting() {},
	};
	return adaptor;
}

async function runWithOrchestrator(
	adaptor: BrowserAdaptor,
	options: FocusAppearanceOptions = {},
	extra: TabConsumer[] = [],
) {
	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: options.screenshotSettleDelay ?? 0,
		screenshotClipBuffer: options.screenshotClipBuffer,
		markerLimit: options.elementLimit,
		baselineElementLimit: options.baselineElementLimit,
	});
	const audit = createFocusAppearanceAudit(options);
	orchestrator.attach(audit);
	for (const consumer of extra) {
		orchestrator.attach(consumer);
	}
	await orchestrator.run();
	return audit;
}

describe("createFocusAppearanceAudit", () => {
	it("passes via style without calling screenshotClip", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [stylePassActive(0)],
			baseline: stylePassBaseline([0]),
		});

		const audit = await runWithOrchestrator(adaptor);

		expect(audit.result.elements[0]?.detectionMethod).toBe("style");
		expect(audit.result.elements[0]?.passed).toBe(true);
		expect(audit.result.elements[0]?.failureEvidence).toBeUndefined();
		expect(adaptor.clipCalls).toBe(0);
		expect(audit.result.summary.sessionEnd).toBe("completed");
	});

	it("calls ensureUnfocusedPair on a style miss and passes via pixel-diff", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [info(0, { styles: UNFOCUSED_STYLES })],
			baseline: {
				styles: [UNFOCUSED_STYLES],
				entries: [{ index: 0, styleIndex: 0, rect: RECT }],
			},
			pngs: [WHITE_PNG, BLACK_PNG],
		});

		const audit = await runWithOrchestrator(adaptor);

		expect(audit.result.elements[0]?.detectionMethod).toBe("pixel-diff");
		expect(audit.result.elements[0]?.passed).toBe(true);
		expect(adaptor.clipCalls).toBe(2);
		expect(audit.result.summary.sessionEnd).toBe("completed");
	});

	it("disconnects after failedElementLimit: 1 while another consumer keeps receiving stops", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true, true],
			active: [info(0), info(1)],
		});
		const other = recordingConsumer();

		const audit = await runWithOrchestrator(
			adaptor,
			{ failedElementLimit: 1 },
			[other],
		);

		expect(audit.result.summary.checked).toBe(1);
		expect(audit.result.summary.failed).toBe(1);
		expect(audit.result.summary.reachedFailedElementLimit).toBe(true);
		expect(audit.result.summary.reachedLimit).toBe(false);
		expect(audit.result.summary.sessionEnd).toBeNull();
		expect(other.stops.map((s) => s.activeElement.index)).toEqual([0, 1]);
	});

	it("disconnects after elementLimit: 1", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true, true],
			active: [stylePassActive(0), stylePassActive(1)],
			baseline: stylePassBaseline([0, 1]),
		});
		const other = recordingConsumer();

		const audit = await runWithOrchestrator(adaptor, { elementLimit: 1 }, [
			other,
		]);

		expect(audit.result.summary.checked).toBe(1);
		expect(audit.result.summary.reachedLimit).toBe(true);
		expect(audit.result.summary.sessionEnd).toBeNull();
		expect(other.stops).toHaveLength(2);
	});

	it("records no appearance row when the only candidate is an iframe then body", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [
				info(0, {
					index: null,
					isIframe: true,
					html: "<iframe></iframe>",
				}),
			],
		});

		const audit = await runWithOrchestrator(adaptor);

		expect(audit.result.elements).toEqual([]);
		expect(audit.result.summary.checked).toBe(0);
		expect(audit.result.summary.sessionEnd).toBe("completed");
	});

	it("sets sessionEnd to lostFocus when the document loses focus while attached", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, false],
			active: [stylePassActive(0)],
			baseline: stylePassBaseline([0]),
		});

		const audit = await runWithOrchestrator(adaptor);

		expect(audit.result.summary.checked).toBe(1);
		expect(audit.result.summary.sessionEnd).toBe("lostFocus");
	});

	it("records a failure with evidence when neither stage finds an indicator", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [info(0)],
		});

		const audit = await runWithOrchestrator(adaptor);

		const failed = audit.result.elements[0];
		expect(failed?.passed).toBe(false);
		expect(failed?.detectionMethod).toBeNull();
		expect(failed?.failureEvidence?.focusedScreenshot).toBeInstanceOf(
			Uint8Array,
		);
		expect(failed?.failureEvidence?.unfocusedScreenshot).toBeInstanceOf(
			Uint8Array,
		);
		expect(audit.result.summary.failed).toBe(1);
		expect(audit.result.summary.sessionEnd).toBe("completed");
	});
});

describe("createFocusAppearanceAudit — failedElementLimit", () => {
	it("never finishes early when the limit is 0", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true, true, true],
			active: [info(0), info(1), info(2)],
		});

		const audit = await runWithOrchestrator(adaptor, {
			failedElementLimit: 0,
		});

		expect(audit.result.summary.checked).toBe(3);
		expect(audit.result.summary.failed).toBe(3);
		expect(audit.result.summary.reachedFailedElementLimit).toBe(false);
		expect(audit.result.summary.sessionEnd).toBe("completed");
	});
});

describe("createFocusAppearanceAudit — timeout", () => {
	it("returns results gathered so far when timeout fires during a hung settle", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true, true, true],
			active: [stylePassActive(0), stylePassActive(1), stylePassActive(2)],
			baseline: stylePassBaseline([0, 1, 2]),
		});

		const started = Date.now();
		const audit = await runWithOrchestrator(adaptor, {
			timeout: 150,
			screenshotSettleDelay: 80,
		});

		expect(Date.now() - started).toBeLessThan(400);
		expect(audit.result.summary.timedOut).toBe(true);
		expect(audit.result.summary.checked).toBe(1);
		expect(audit.result.summary.passed).toBe(1);
		expect(audit.result.elements).toHaveLength(1);
		expect(audit.result.summary.sessionEnd).toBeNull();
	}, 2000);

	it("times out with no results when settle hangs immediately", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true],
			active: [stylePassActive(0)],
			baseline: stylePassBaseline([0]),
		});

		const started = Date.now();
		const audit = await runWithOrchestrator(adaptor, {
			timeout: 50,
			screenshotSettleDelay: 500,
		});

		expect(Date.now() - started).toBeLessThan(250);
		expect(audit.result.summary.timedOut).toBe(true);
		expect(audit.result.summary.checked).toBe(0);
		expect(audit.result.summary.sessionEnd).toBeNull();
	}, 2000);

	it("does not time out when the timeout is 0", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true, true],
			active: [stylePassActive(0), stylePassActive(1)],
			baseline: stylePassBaseline([0, 1]),
		});

		const audit = await runWithOrchestrator(adaptor, { timeout: 0 });

		expect(audit.result.summary.timedOut).toBe(false);
		expect(audit.result.summary.checked).toBe(2);
		expect(audit.result.summary.sessionEnd).toBe("completed");
	});

	it("completes normally when the audit finishes before the timeout", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true, true],
			active: [stylePassActive(0), stylePassActive(1)],
			baseline: stylePassBaseline([0, 1]),
		});

		const audit = await runWithOrchestrator(adaptor, { timeout: 10_000 });

		expect(audit.result.summary.timedOut).toBe(false);
		expect(audit.result.summary.checked).toBe(2);
		expect(audit.result.summary.sessionEnd).toBe("completed");
	});
});

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

			if (fn === elementStylesScript) {
				return EMPTY_STYLES;
			}

			if (
				fn === blurScript ||
				fn === focusScript ||
				fn === clearMarkersScript
			) {
				return undefined;
			}

			// The only remaining evaluate is the inline `document.hasFocus()` check.
			return hasFocusCalls++ < tabStops;
		},
		async evaluateHandle() {
			return {};
		},
		async disposeRef() {},
		async pressTab() {},
		async screenshotClip(clip: Rect, _scale?: number) {
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
		expect(result.summary.sessionEnd).toBe("lostFocus");
	});

	it("attaches focused and unfocused screenshots and styles on failure", async () => {
		const rect = { x: 100, y: 100, width: 40, height: 20 };
		// Identical snapshots so the style stage does not short-circuit; the
		// white-on-white pixel diff then fails and surfaces the evidence.
		const styles: StyleSnapshot = {
			element: { "outline-style": "none" },
			before: {},
			after: {},
		};
		const { adaptor } = fakeAdaptor({
			tabStops: 1,
			baseline: {
				styles: [styles],
				entries: [{ index: 0, styleIndex: 0, rect }],
			},
			active: {
				index: 0,
				isBody: false,
				isIframe: false,
				html: "<button>x</button>",
				styles,
				rect,
			},
		});

		const result = await runFocusAppearanceAudit(adaptor, {
			screenshotSettleDelay: 0,
		});

		const failed = result.elements[0];
		expect(failed?.passed).toBe(false);
		expect(failed?.detectionMethod).toBeNull();
		expect(failed?.failureEvidence?.focusedScreenshot).toBeInstanceOf(
			Uint8Array,
		);
		expect(failed?.failureEvidence?.unfocusedScreenshot).toBeInstanceOf(
			Uint8Array,
		);
		expect(
			failed?.failureEvidence?.focusedScreenshot.byteLength,
		).toBeGreaterThan(0);
		expect(
			failed?.failureEvidence?.unfocusedScreenshot.byteLength,
		).toBeGreaterThan(0);
		expect(failed?.failureEvidence?.focusedStyles).toEqual({
			element: {},
			before: {},
			after: {},
		});
		expect(failed?.failureEvidence?.unfocusedStyles).toEqual({
			element: {},
			before: {},
			after: {},
		});
	});

	it("does not time out by default", async () => {
		const { adaptor } = fakeAdaptor({ tabStops: 2 });

		const result = await runFocusAppearanceAudit(adaptor, {});

		expect(result.summary.timedOut).toBe(false);
		expect(result.summary.checked).toBe(2);
		expect(result.summary.sessionEnd).toBe("lostFocus");
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

	it("does not throw when an entry references a missing snapshot", async () => {
		// Orchestrator skips dangling interned indexes instead of throwing; the
		// style stage is skipped and detection falls through to the pixel diff.
		const { adaptor } = fakeAdaptor({
			tabStops: 1,
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
			active: {
				index: 0,
				isBody: false,
				isIframe: false,
				html: "<button>x</button>",
				styles: EMPTY_STYLES,
				rect: { x: 0, y: 0, width: 10, height: 10 },
			},
		});

		const result = await runFocusAppearanceAudit(adaptor, {
			screenshotSettleDelay: 0,
		});

		expect(result.elements[0]?.detectionMethod).toBeNull();
		expect(result.summary.failed).toBe(1);
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
		expect(result.elements[0]?.failureEvidence).toBeUndefined();
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
