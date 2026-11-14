import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { getSelector } from "@a11y-pulse/browser-adaptor/dom";
import { describe, expect, it, vi } from "vitest";
import {
	activeElementHandleScript,
	attributedHandleScript,
	baselineScript,
	blurScript,
	clearAttributedScript,
	clearContextFocusInsScript,
	clearMarkersScript,
	clearObscurerScript,
	documentReplacedScript,
	drainContextObserverScript,
	elementRectScript,
	elementStylesScript,
	focusScript,
	hasFocusScript,
	heldFocusScript,
	installContextObserverScript,
	locationHrefScript,
	markActiveElementScript,
	measureObscuringScript,
	needsCentringScript,
	obscurerHandleScript,
	pageDimensionsScript,
	probeActiveElementScript,
	scrollToCenterScript,
} from "./browser-scripts";
import {
	createTabOrchestrator,
	isContextDestroyedError,
	OBSCURING_RECHECK_DELAY_MS,
} from "./orchestrator";
import { sessionStartScript, tabStopScript } from "./session-scripts";
import type { ActiveElementInfo, SessionEndDetail, TabConsumer, TabStopSnapshot } from "./types";

function dummyAdaptor(): BrowserAdaptor {
	return {
		evaluate: vi.fn(async () => undefined) as BrowserAdaptor["evaluate"],
		evaluateHandle: vi.fn(async () => ({})),
		disposeRef: vi.fn(async () => undefined),
		pressTab: vi.fn(async () => undefined),
		pressEnter: vi.fn(async () => undefined),
		pressKey: vi.fn(async () => undefined),
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
		expect(() => orchestrator.attach(consumer())).toThrow(/attach after run\(\) has started/i);
		await running.catch(() => {});
	});

	it("throws when run() is called twice", async () => {
		const orchestrator = createTabOrchestrator(dummyAdaptor());
		await orchestrator.run();
		await expect(orchestrator.run()).rejects.toThrow(/already been called/i);
	});
});

const EMPTY_STYLES = { element: {}, before: {}, after: {} };

const CAPTURE_DELAY_MS = 20;

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
): TabConsumer & {
	stops: TabStopSnapshot[];
	sessionEnds: string[];
	revisitedIndexes: Array<number | null>;
} {
	const record = {
		stops: [] as TabStopSnapshot[],
		sessionEnds: [] as string[],
		revisitedIndexes: [] as Array<number | null>,
		capabilities: new Set(capabilities),
		async onTabStop(snapshot: TabStopSnapshot, session: { disconnect(): void }) {
			record.stops.push(snapshot);
			await onStop?.(snapshot, () => session.disconnect());
		},
		onSessionEnd(reason: string, detail: SessionEndDetail) {
			record.sessionEnds.push(reason);
			record.revisitedIndexes.push(detail.revisitedIndex);
		},
	};

	return record;
}

/**
 * Fixed `location.href` returned by `loopAdaptor`'s default handling of `locationHrefScript` so
 * tests that don't care about navigation-via-href never see a diff against the baseline captured at
 * session start (which uses the same default).
 */
const STABLE_HREF = "https://example.test/";

function loopAdaptor(script: {
	// Focus state per tab stop, read before that stop's tab press.
	hasFocus?: boolean[];
	// Focus state per tab stop after the tab press. Defaults to hasFocus.
	hasFocusAfterTab?: boolean[];
	// Whether ensureFocusReporting() restores a page that has lost focus.
	restoresFocus?: boolean;
	active?: Array<Omit<ActiveElementInfo, "selector"> | null>;
	// Why a repeated element held focus. Defaults to a control moving between its own parts.
	heldFocus?: { prevented: boolean; followed: boolean };
}): BrowserAdaptor {
	let activeCall = 0;
	let dynamicMarker: number | undefined;
	let stopIndex = -1;
	let tabbed = false;
	let postTabReads = 0;

	return {
		ensureFocusReporting: vi.fn(async () => {}),
		evaluate: (async (fn, ...args) => {
			if (fn === markActiveElementScript) {
				// One unmarked element per script: it keeps the marker it was first given.
				dynamicMarker ??= args[1] as number;

				return dynamicMarker;
			}

			if (fn === heldFocusScript) {
				return script.heldFocus ?? { prevented: false, followed: true };
			}

			if (fn === baselineScript) {
				return { styles: [EMPTY_STYLES], entries: [] };
			}

			if (fn === probeActiveElementScript) {
				tabbed = false;

				return (
					script.active?.[activeCall++] ?? {
						index: null,
						isBody: true,
						isIframe: false,
						html: "",
						styles: EMPTY_STYLES,
						rect: { x: 0, y: 0, width: 0, height: 0 },
					}
				);
			}

			if (fn === getSelector) {
				return "#fake";
			}

			if (fn === elementStylesScript) {
				return EMPTY_STYLES;
			}

			if (fn === clearMarkersScript) {
				return undefined;
			}

			if (fn === locationHrefScript) {
				return STABLE_HREF;
			}

			if (fn === hasFocusScript) {
				if (!tabbed) {
					return script.hasFocus?.[stopIndex + 1] ?? false;
				}

				// A second read in the same stop only follows a re-assertion.
				if (postTabReads++ > 0) {
					return script.restoresFocus ?? false;
				}

				return script.hasFocusAfterTab?.[stopIndex] ?? script.hasFocus?.[stopIndex] ?? false;
			}

			return false;
		}) as BrowserAdaptor["evaluate"],
		async evaluateHandle(fn) {
			if (fn === activeElementHandleScript) {
				return { kind: "active" };
			}

			return {};
		},
		async disposeRef() {},
		async pressTab() {
			stopIndex++;
			tabbed = true;
			postTabReads = 0;
		},
		async pressEnter() {},
		async pressKey() {},
		async screenshotClip() {
			return new Uint8Array([1]);
		},
	};
}

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
		expect(a.revisitedIndexes).toEqual([null]);
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

	it("allows exactly 256 consecutive iframe stops before focus counts as stuck in a frame", async () => {
		const run = async (iframeStops: number) => {
			const consumer = recordingConsumer();
			const orchestrator = createTabOrchestrator(
				loopAdaptor({
					hasFocus: Array(iframeStops + 3).fill(true),
					active: [...Array(iframeStops).fill(info(0, { isIframe: true })), info(1)],
				}),
				{ screenshotSettleDelay: 0 },
			);
			orchestrator.attach(consumer);
			await orchestrator.run();

			return consumer;
		};

		const atLimit = await run(256);
		const pastLimit = await run(257);

		expect(atLimit.stops.map((s) => s.activeElement.index)).toEqual([1]);
		expect(atLimit.sessionEnds).toEqual(["completed"]);
		expect(pastLimit.stops).toEqual([]);
		expect(pastLimit.sessionEnds).toEqual(["stuck"]);
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

	it("reports a control once while focus moves between its own parts", async () => {
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: Array(6).fill(true),
				active: [info(0), info(1), info(1), info(1), info(2)],
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(a);
		await orchestrator.run();
		expect(a.stops.map((s) => s.activeElement.index)).toEqual([0, 1, 2]);
		expect(a.revisitedIndexes).toEqual([null]);
	});

	it("allows exactly ten internal stops before an element counts as stuck", async () => {
		const tenRepeats = recordingConsumer();
		const elevenRepeats = recordingConsumer();
		const run = async (consumer: typeof tenRepeats, repeats: number) => {
			const orchestrator = createTabOrchestrator(
				loopAdaptor({
					hasFocus: Array(20).fill(true),
					active: [info(0), info(1), ...Array(repeats).fill(info(1)), info(2)],
				}),
				{ screenshotSettleDelay: 0 },
			);
			orchestrator.attach(consumer);
			await orchestrator.run();
		};

		await run(tenRepeats, 10);
		await run(elevenRepeats, 11);

		expect(tenRepeats.stops.map((s) => s.activeElement.index)).toEqual([0, 1, 2]);
		expect(elevenRepeats.stops.map((s) => s.activeElement.index)).toEqual([0, 1]);
		expect(elevenRepeats.revisitedIndexes).toEqual([1]);
	});

	it("ends as a cycle of one when an element never lets focus go", async () => {
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: Array(20).fill(true),
				active: [info(0), ...Array(15).fill(info(1))],
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(a);
		await orchestrator.run();
		expect(a.stops.map((s) => s.activeElement.index)).toEqual([0, 1]);
		expect(a.sessionEnds).toEqual(["completed"]);
		expect(a.revisitedIndexes).toEqual([1]);
	});

	it("ends as a cycle of one straight away when the page cancels Tab", async () => {
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: Array(20).fill(true),
				active: [info(0), info(1), info(1)],
				heldFocus: { prevented: true, followed: true },
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(a);
		await orchestrator.run();
		expect(a.stops.map((s) => s.activeElement.index)).toEqual([0, 1]);
		expect(a.revisitedIndexes).toEqual([1]);
	});

	it("ends normally when focus stays on the last element with nothing after it", async () => {
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: Array(20).fill(true),
				active: [info(0), info(1), info(1)],
				heldFocus: { prevented: false, followed: false },
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(a);
		await orchestrator.run();
		expect(a.stops.map((s) => s.activeElement.index)).toEqual([0, 1]);
		expect(a.sessionEnds).toEqual(["completed"]);
		expect(a.revisitedIndexes).toEqual([null]);
	});

	it("marks an element the baseline missed so its repeats are recognised", async () => {
		const a = recordingConsumer();
		const unmarked = { ...info(0), index: null };
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: Array(20).fill(true),
				active: [info(0), ...Array(15).fill(unmarked)],
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(a);
		await orchestrator.run();
		expect(a.stops).toHaveLength(2);
		expect(a.stops[1]?.activeElement.index).not.toBeNull();
	});

	it("names the revisited element when a cycle ends the session", async () => {
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: [true, true, true, true],
				active: [info(0), info(1), info(2), info(1)],
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(a);
		await orchestrator.run();
		expect(a.stops.map((s) => s.activeElement.index)).toEqual([0, 1, 2]);
		expect(a.revisitedIndexes).toEqual([1]);
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

	it("aborts when the document loses focus after the tab press", async () => {
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: [true, true],
				hasFocusAfterTab: [false],
				active: [info(0), info(1)],
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(a);
		await orchestrator.run();
		expect(a.stops).toHaveLength(0);
		expect(a.sessionEnds).toEqual(["lostFocus"]);
	});

	it("re-asserts focus reporting and continues when focus is restored after the tab press", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true, true],
			hasFocusAfterTab: [false],
			restoresFocus: true,
			active: [info(0), info(1)],
		});
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(adaptor, {
			screenshotSettleDelay: 0,
		});
		orchestrator.attach(a);
		await orchestrator.run();
		expect(a.stops.map((s) => s.activeElement.index)).toEqual([0, 1]);
		expect(a.sessionEnds).toEqual(["completed"]);
		expect(adaptor.ensureFocusReporting).toHaveBeenCalledTimes(2);
	});

	it("ends as completed when the last tab press walks off the end of the tab order", async () => {
		// Tabbing past the final element moves focus out of the document: the page
		// reports no focus and the probe reports <body>. That is the ordinary end
		// of a session, not a stolen focus, and re-asserting focus emulation
		// cannot bring it back.
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: [true, true, true],
				hasFocusAfterTab: [true, true, false],
				active: [info(0), info(1)],
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(a);
		await orchestrator.run();
		expect(a.stops.map((s) => s.activeElement.index)).toEqual([0, 1]);
		expect(a.sessionEnds).toEqual(["completed"]);
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

	it("reports the stops delivered and how the session ended", async () => {
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: [true, true, true],
				active: [info(0), info(1)],
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(recordingConsumer());

		const stats = await orchestrator.run();

		expect(stats).toMatchObject({
			tabStops: 2,
			unfocusedPairs: 0,
			screenshots: 0,
			captureMs: 0,
			endReason: "completed",
		});
		expect(stats.durationMs).toBeGreaterThan(0);
	});

	it("reports no end reason when every consumer disconnects itself", async () => {
		const orchestrator = createTabOrchestrator(
			loopAdaptor({
				hasFocus: [true, true, true],
				active: [info(0), info(1)],
			}),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(recordingConsumer([], (_snapshot, disconnect) => disconnect()));

		const stats = await orchestrator.run();

		expect(stats).toMatchObject({ tabStops: 1, endReason: null });
	});

	it("times screenshot captures", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [info(0)],
		});
		adaptor.screenshotClip = async () => {
			await new Promise((resolve) => setTimeout(resolve, CAPTURE_DELAY_MS));

			return new Uint8Array([1]);
		};
		const orchestrator = createTabOrchestrator(adaptor, { screenshotSettleDelay: 0 });
		orchestrator.attach({
			capabilities: new Set(["screenshot"]),
			async onTabStop(_snapshot, session) {
				await session.screenshotClip();
			},
		});

		const stats = await orchestrator.run();

		// setTimeout may fire a millisecond early.
		expect(stats.captureMs).toBeGreaterThanOrEqual(CAPTURE_DELAY_MS - 1);
		expect(stats.durationMs).toBeGreaterThanOrEqual(stats.captureMs);
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

	it("captures unfocusedPair once per stop when a declarer calls ensureUnfocusedPair", async () => {
		const clips: unknown[] = [];
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [info(0)],
		});
		const originalEvaluate = adaptor.evaluate.bind(adaptor);
		adaptor.evaluate = (async (fn, ...args) => {
			if (fn === pageDimensionsScript) {
				return { width: 2000, height: 4000 };
			}

			if (fn === needsCentringScript) {
				return false;
			}

			if (fn === elementRectScript) {
				return { x: 10, y: 20, width: 30, height: 40 };
			}

			if (fn === blurScript || fn === focusScript || fn === scrollToCenterScript) {
				return undefined;
			}

			return originalEvaluate(fn, ...args);
		}) as BrowserAdaptor["evaluate"];
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
		const stats = await orchestrator.run();
		expect(clips).toHaveLength(2);
		expect(stats).toMatchObject({ tabStops: 1, unfocusedPairs: 1, screenshots: 0 });
	});

	it("does not capture a screenshot when nobody calls session.screenshotClip", async () => {
		const screenshots: number[] = [];
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [info(0)],
		});
		adaptor.screenshotClip = async () => {
			screenshots.push(1);

			return new Uint8Array([1]);
		};
		const a = recordingConsumer(["screenshot"]);
		const orchestrator = createTabOrchestrator(adaptor, {
			screenshotSettleDelay: 0,
		});
		orchestrator.attach(a);
		await orchestrator.run();
		expect(screenshots).toEqual([]);
	});

	it("throws from screenshotClip when the consumer did not declare it", async () => {
		const a = recordingConsumer([]);
		let thrown: Error | undefined;
		const wrapped: TabConsumer = {
			capabilities: new Set(),
			async onTabStop(snapshot, session) {
				try {
					await session.screenshotClip();
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
		expect(thrown?.message).toMatch(/did not declare screenshot/i);
	});

	it("captures a screenshot once per stop when a declarer calls screenshotClip", async () => {
		const clips: unknown[] = [];
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [info(0)],
		});
		const originalEvaluate = adaptor.evaluate.bind(adaptor);
		adaptor.evaluate = (async (fn, ...args) => {
			if (fn === pageDimensionsScript) {
				return { width: 2000, height: 4000 };
			}

			if (fn === elementRectScript) {
				return { x: 10, y: 20, width: 30, height: 40 };
			}

			return originalEvaluate(fn, ...args);
		}) as BrowserAdaptor["evaluate"];
		adaptor.screenshotClip = async (clip) => {
			clips.push(clip);

			return new Uint8Array([clips.length]);
		};

		const a: TabConsumer = {
			capabilities: new Set(["screenshot"]),
			async onTabStop(_snapshot, session) {
				const first = await session.screenshotClip();
				const second = await session.screenshotClip();
				expect(first).toBe(second);
				expect(first).toEqual(new Uint8Array([1]));
			},
		};

		const orchestrator = createTabOrchestrator(adaptor, {
			screenshotSettleDelay: 0,
			screenshotClipBuffer: 10,
		});
		orchestrator.attach(a);
		const stats = await orchestrator.run();
		expect(clips).toHaveLength(1);
		expect(stats).toMatchObject({ tabStops: 1, unfocusedPairs: 0, screenshots: 1 });
	});

	it("scrolls to center before capture when the element needs centring", async () => {
		let scrolls = 0;
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [info(0)],
		});
		const originalEvaluate = adaptor.evaluate.bind(adaptor);
		adaptor.evaluate = (async (fn, ...args) => {
			if (fn === needsCentringScript) {
				expect(args[1]).toBe(10);

				return true;
			}

			if (fn === scrollToCenterScript) {
				expect(args[1]).toBe(10);
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
		}) as BrowserAdaptor["evaluate"];
		adaptor.screenshotClip = async () => new Uint8Array([1]);

		const a: TabConsumer = {
			capabilities: new Set(["unfocusedPair"]),
			async onTabStop(_snapshot, session) {
				await session.ensureUnfocusedPair();
			},
		};
		const orchestrator = createTabOrchestrator(adaptor, {
			screenshotSettleDelay: 0,
			screenshotClipBuffer: 10,
		});
		orchestrator.attach(a);
		await orchestrator.run();
		expect(scrolls).toBe(1);
	});

	it("aborts in-flight settle when the last consumer disconnects", async () => {
		const settleDelay = 500;
		let disconnect: (() => void) | undefined;
		const a = recordingConsumer();
		a.onSessionStart = (session) => {
			disconnect = () => session.disconnect();
		};

		const adaptor = loopAdaptor({
			hasFocus: [true],
			active: [info(0)],
		});
		let probeCalls = 0;
		const evaluate = adaptor.evaluate;
		adaptor.evaluate = (async (fn, ...args) => {
			if (fn === probeActiveElementScript) {
				probeCalls += 1;
			}

			return evaluate(fn, ...args);
		}) as BrowserAdaptor["evaluate"];

		let releasePressTab!: () => void;
		adaptor.pressTab = () =>
			new Promise<void>((resolve) => {
				releasePressTab = resolve;
			});

		const orchestrator = createTabOrchestrator(adaptor, {
			screenshotSettleDelay: settleDelay,
		});
		orchestrator.attach(a);
		const running = orchestrator.run();

		await vi.waitFor(() => {
			expect(releasePressTab).toBeTypeOf("function");
			expect(disconnect).toBeDefined();
		});
		releasePressTab();
		await Promise.resolve();
		await Promise.resolve();

		const started = Date.now();
		disconnect?.();
		await running;
		expect(Date.now() - started).toBeLessThan(settleDelay / 2);
		expect(probeCalls).toBe(0);
		expect(a.stops).toHaveLength(0);
	});

	it("measures obscuring only while a remaining consumer declared it", async () => {
		const measures: number[] = [];
		const adaptor = loopAdaptor({
			hasFocus: [true, true, true],
			active: [info(0), info(1)],
		});
		const original = adaptor.evaluate.bind(adaptor);
		adaptor.evaluate = (async (fn, ...args) => {
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
		}) as BrowserAdaptor["evaluate"];

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

	/** An adaptor that reports every stop as covered by `cover`, and counts what that costs. */
	function coveredAdaptor(cover: { opacity: "opaque" | "semi-transparent" }) {
		const calls = { measure: 0, clear: 0, obscurerHandle: 0 };
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [info(0)],
		});
		const original = adaptor.evaluate.bind(adaptor);
		adaptor.evaluate = (async (fn, ...args) => {
			if (fn === measureObscuringScript) {
				calls.measure++;

				return {
					coveredFraction: 1,
					fullyObscured: true,
					offscreen: false,
					opacity: cover.opacity,
					obscuredByHtml: '<div id="banner">',
					hasObscurer: true,
				};
			}

			if (fn === clearObscurerScript) {
				calls.clear++;

				return undefined;
			}

			return original(fn, ...args);
		}) as BrowserAdaptor["evaluate"];
		adaptor.evaluateHandle = async (fn) => {
			if (fn === obscurerHandleScript) {
				calls.obscurerHandle++;
			}

			return {};
		};

		return { adaptor, calls };
	}

	it("looks twice at an opaque cover, in case it was only passing through", async () => {
		vi.useFakeTimers();

		try {
			const { adaptor, calls } = coveredAdaptor({ opacity: "opaque" });
			const obscuring = recordingConsumer(["obscuring"]);
			const orchestrator = createTabOrchestrator(adaptor, { screenshotSettleDelay: 0 });
			orchestrator.attach(obscuring);
			const running = orchestrator.run();

			await vi.advanceTimersByTimeAsync(OBSCURING_RECHECK_DELAY_MS - 1);
			expect(calls.measure).toBe(1);
			expect(obscuring.stops).toHaveLength(0);

			await vi.advanceTimersByTimeAsync(1);
			await vi.runAllTimersAsync();
			await running;

			expect(calls.measure).toBe(2);
			expect(obscuring.stops[0]?.obscuring).toEqual({
				coveredFraction: 1,
				fullyObscured: true,
				offscreen: false,
				opacity: "opaque",
				obscuredBy: { selector: "#fake", html: '<div id="banner">' },
			});
			expect(calls.clear).toBe(1);
		} finally {
			vi.useRealTimers();
		}
	});

	it("does not wait to look again at a cover the page shows through", async () => {
		vi.useFakeTimers();

		try {
			const { adaptor, calls } = coveredAdaptor({ opacity: "semi-transparent" });
			const obscuring = recordingConsumer(["obscuring"]);
			const orchestrator = createTabOrchestrator(adaptor, { screenshotSettleDelay: 0 });
			orchestrator.attach(obscuring);
			const running = orchestrator.run();

			// Well short of the recheck delay: only the zero-length settle timers need to run.
			await vi.advanceTimersByTimeAsync(1);
			await running;

			expect(calls.measure).toBe(1);
			expect(obscuring.stops[0]?.obscuring?.opacity).toBe("semi-transparent");
			expect(obscuring.stops[0]?.obscuring?.obscuredBy?.selector).toBe("#fake");
		} finally {
			vi.useRealTimers();
		}
	});

	it("only clears the obscurer marker when a cover was marked", async () => {
		let clears = 0;
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [info(0)],
		});
		const original = adaptor.evaluate.bind(adaptor);
		adaptor.evaluate = (async (fn, ...args) => {
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

			if (fn === clearObscurerScript) {
				clears++;

				return undefined;
			}

			return original(fn, ...args);
		}) as BrowserAdaptor["evaluate"];
		const obscuring = recordingConsumer(["obscuring"]);
		const orchestrator = createTabOrchestrator(adaptor, { screenshotSettleDelay: 0 });
		orchestrator.attach(obscuring);
		await orchestrator.run();

		expect(obscuring.stops[0]?.obscuring?.obscuredBy).toBeNull();
		expect(clears).toBe(0);
	});

	it("asks an adaptor once for a composed script, then sends scripts one by one", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [info(0)],
		});
		const original = adaptor.evaluate.bind(adaptor);
		const seen: unknown[] = [];
		adaptor.evaluate = (async (fn, ...args) => {
			seen.push(fn);

			return original(fn, ...args);
		}) as BrowserAdaptor["evaluate"];
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(adaptor, { screenshotSettleDelay: 0 });
		orchestrator.attach(a);
		await orchestrator.run();

		// This adaptor does not run functions at all, so the composed script never answers.
		expect(seen[0]).toBe(sessionStartScript.pageFunction);
		expect(seen.filter((fn) => fn === sessionStartScript.pageFunction)).toHaveLength(1);
		expect(seen).not.toContain(tabStopScript.pageFunction);
		expect(seen).toContain(probeActiveElementScript);
		expect(a.stops.map((stop) => stop.activeElement.selector)).toEqual(["#fake"]);
	});

	it("never sends a composed script when composeScripts is off", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [info(0)],
		});
		const original = adaptor.evaluate.bind(adaptor);
		const seen: unknown[] = [];
		adaptor.evaluate = (async (fn, ...args) => {
			seen.push(fn);

			return original(fn, ...args);
		}) as BrowserAdaptor["evaluate"];
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(adaptor, {
			screenshotSettleDelay: 0,
			composeScripts: false,
		});
		orchestrator.attach(a);
		await orchestrator.run();

		expect(seen).not.toContain(sessionStartScript.pageFunction);
		expect(a.stops).toHaveLength(1);
	});

	it("sends every stop as one composed script once the adaptor has answered one", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true, true, true],
			active: [info(0), info(1)],
		});
		const original = adaptor.evaluate.bind(adaptor);
		const seen: unknown[] = [];
		const stops = [info(0), info(1)];
		adaptor.evaluate = (async (fn, ...args) => {
			seen.push(fn);

			if (fn === sessionStartScript.pageFunction) {
				const [startArgs] = args as [{ sentinel: string }];

				return {
					sentinel: startArgs.sentinel,
					payload: { styles: [], entries: [] },
					href: null,
				};
			}

			if (fn === tabStopScript.pageFunction) {
				const base = stops.shift();

				return base === undefined
					? { kind: "body", blurredStop: null, raw: null, baselineHref: null }
					: {
							kind: "stop",
							base,
							index: base.index,
							selector: `#e${base.index}`,
							raw: null,
							drainDestroyed: false,
							obscuring: null,
							baselineHref: null,
							ref: null,
						};
			}

			return original(fn, ...args);
		}) as BrowserAdaptor["evaluate"];
		const handles = vi.fn(async () => ({}));
		adaptor.evaluateHandle = handles;
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(adaptor, { screenshotSettleDelay: 0 });
		orchestrator.attach(a);
		const stats = await orchestrator.run();

		expect(a.stops.map((stop) => stop.activeElement.selector)).toEqual(["#e0", "#e1"]);
		expect(stats.endReason).toBe("completed");
		expect(seen.filter((fn) => fn === tabStopScript.pageFunction)).toHaveLength(3);
		expect(seen).not.toContain(probeActiveElementScript);
		// Nobody captured anything, so no element was ever fetched from the page.
		expect(handles).not.toHaveBeenCalled();
	});

	it("notifies remaining consumers with failed and rethrows when pressTab throws", async () => {
		const a = recordingConsumer();
		const adaptor = loopAdaptor({
			hasFocus: [true],
			active: [info(0)],
		});
		adaptor.pressTab = async () => {
			throw new Error("tab failed");
		};
		const evaluate = adaptor.evaluate;
		adaptor.evaluate = (async (fn, ...args) => {
			if (fn === clearMarkersScript) {
				throw new Error("teardown failed");
			}

			return evaluate(fn, ...args);
		}) as BrowserAdaptor["evaluate"];

		const orchestrator = createTabOrchestrator(adaptor, {
			screenshotSettleDelay: 0,
		});
		orchestrator.attach(a);
		await expect(orchestrator.run()).rejects.toThrow("tab failed");
		expect(a.sessionEnds).toEqual(["failed"]);
	});

	it("drains context signals before measuring obscuring", async () => {
		const order: string[] = [];
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [info(0)],
		});
		const original = adaptor.evaluate.bind(adaptor);
		adaptor.evaluate = (async (fn, ...args) => {
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
		}) as BrowserAdaptor["evaluate"];
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
		adaptor.evaluate = (async (fn, ...args) => {
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
		}) as BrowserAdaptor["evaluate"];
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
		adaptor.evaluate = (async (fn, ...args) => {
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
		}) as BrowserAdaptor["evaluate"];
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

	it("detects navigation via href diff even when the post-navigation probe would otherwise report isBody", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true],
			active: [],
		});
		const original = adaptor.evaluate.bind(adaptor);
		let hrefCalls = 0;
		adaptor.evaluate = (async (fn, ...args) => {
			if (fn === locationHrefScript) {
				hrefCalls++;

				return hrefCalls === 1 ? STABLE_HREF : "https://example.test/other";
			}

			if (fn === drainContextObserverScript) {
				// Soft-nav flag is false: the observer's execution context survived long enough to answer,
				// but this was a hard nav, not a pushState/hashchange, so the href-diff layer must still
				// treat it as a full navigation rather than trusting a stale soft flag.
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
		}) as BrowserAdaptor["evaluate"];
		const ctx = recordingConsumer(["contextSignals"]);
		const orchestrator = createTabOrchestrator(adaptor, {
			screenshotSettleDelay: 0,
		});
		orchestrator.attach(ctx);
		await orchestrator.run();
		expect(ctx.sessionEnds).toEqual(["navigation"]);
		expect(ctx.stops).toHaveLength(0);
	});

	it("classifies navigation when the active-element probe itself throws a destroyed-context error", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true],
			active: [info(0)],
		});
		const original = adaptor.evaluate.bind(adaptor);
		adaptor.evaluate = (async (fn, ...args) => {
			if (fn === probeActiveElementScript) {
				throw new Error("Execution context was destroyed");
			}

			if (fn === installContextObserverScript) {
				return undefined;
			}

			return original(fn, ...args);
		}) as BrowserAdaptor["evaluate"];
		const ctx = recordingConsumer(["contextSignals"]);
		const orchestrator = createTabOrchestrator(adaptor, {
			screenshotSettleDelay: 0,
		});
		orchestrator.attach(ctx);
		await orchestrator.run();
		expect(ctx.sessionEnds).toEqual(["navigation"]);
		expect(ctx.stops).toHaveLength(0);
	});

	it("classifies navigation when the context drain call throws a destroyed-context error", async () => {
		const adaptor = loopAdaptor({
			hasFocus: [true],
			active: [info(0)],
		});
		const original = adaptor.evaluate.bind(adaptor);
		let drains = 0;
		adaptor.evaluate = (async (fn, ...args) => {
			if (fn === drainContextObserverScript) {
				drains++;
				throw new Error("Execution context was destroyed");
			}

			if (fn === installContextObserverScript) {
				return undefined;
			}

			return original(fn, ...args);
		}) as BrowserAdaptor["evaluate"];
		const ctx = recordingConsumer(["contextSignals"]);
		const orchestrator = createTabOrchestrator(adaptor, {
			screenshotSettleDelay: 0,
		});
		orchestrator.attach(ctx);
		await orchestrator.run();
		// href is unchanged (loopAdaptor's default), so the primary href-diff layer sees no change and
		// this stop reaches the full-mapping drain call with a resolved active element already in hand:
		// the stop is still notified (matching "aborts the session after notifying a navigation drain"
		// above) before the session ends, since a thrown destroyed-context error here is just an
		// alternate way of learning the same thing a non-throwing `navigation: true` drain reports.
		expect(ctx.stops).toHaveLength(1);
		expect(ctx.stops[0]?.contextSignals?.signals.navigation).toBe(true);
		expect(ctx.sessionEnds).toEqual(["navigation"]);
		expect(drains).toBe(1);
	});

	it("clears context observer noise after ensureUnfocusedPair blur", async () => {
		const order: string[] = [];
		const adaptor = loopAdaptor({
			hasFocus: [true, true],
			active: [info(0)],
		});
		const original = adaptor.evaluate.bind(adaptor);
		adaptor.evaluate = (async (fn, ...args) => {
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
				fn === needsCentringScript ||
				fn === elementRectScript ||
				fn === blurScript ||
				fn === focusScript
			) {
				if (fn === pageDimensionsScript) {
					return { width: 100, height: 100 };
				}

				if (fn === needsCentringScript) {
					return false;
				}

				if (fn === elementRectScript) {
					return { x: 0, y: 0, width: 10, height: 10 };
				}

				return undefined;
			}

			return original(fn, ...args);
		}) as BrowserAdaptor["evaluate"];
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
		// The session's second (and final) loop iteration is the "done tabbing" isBody exit, which also
		// drains context signals before ending, hence a trailing "drain" with no further
		// "pair"/"clear": that drain reports hasAttributed: false, this fixture having nothing
		// attributed on the second iteration. The last "drain" is the session reading the observer
		// once more as it ends, for what timers did after the last stop.
		expect(order).toEqual(["drain", "pair", "clear", "drain", "drain"]);
	});

	describe("F55 focus-removal at the isBody exit", () => {
		it("notifies an attached contextSignals consumer of the attributed element before ending", async () => {
			const adaptor = loopAdaptor({
				hasFocus: [true],
				active: [],
			});
			const attributedRef = { kind: "attributed" };
			adaptor.evaluateHandle = (async (fn) => {
				if (fn === attributedHandleScript) {
					return attributedRef;
				}

				return {};
			}) as BrowserAdaptor["evaluateHandle"];
			const original = adaptor.evaluate.bind(adaptor);
			adaptor.evaluate = (async (fn, ...args) => {
				if (fn === drainContextObserverScript) {
					return {
						openedWindow: false,
						submittedForm: false,
						focusRemoved: true,
						redirect: null,
						softUrlChange: false,
						navigation: false,
						attributedHtml: '<input id="blurred">',
						hasAttributed: true,
					};
				}

				if (fn === getSelector && args[0] === attributedRef) {
					return "#blurred";
				}

				if (fn === installContextObserverScript || fn === clearAttributedScript) {
					return undefined;
				}

				return original(fn, ...args);
			}) as BrowserAdaptor["evaluate"];

			const ctx = recordingConsumer(["contextSignals"]);
			const orchestrator = createTabOrchestrator(adaptor, {
				screenshotSettleDelay: 0,
			});
			orchestrator.attach(ctx);
			await orchestrator.run();

			expect(ctx.stops).toHaveLength(1);
			expect(ctx.stops[0]?.tabIndex).toBe(1);
			expect(ctx.stops[0]?.activeElement.selector).toBe("#blurred");
			expect(ctx.stops[0]?.activeElement.html).toBe('<input id="blurred">');
			expect(ctx.stops[0]?.activeElement.isBody).toBe(false);
			expect(ctx.stops[0]?.contextSignals?.signals.focusRemoved).toBe(true);
			expect(ctx.sessionEnds).toEqual(["completed"]);
		});

		it("does not notify an attached consumer that did not declare contextSignals, since there is no live element for it to act on", async () => {
			const adaptor = loopAdaptor({
				hasFocus: [true],
				active: [],
			});
			const attributedRef = { kind: "attributed" };
			adaptor.evaluateHandle = (async (fn) => {
				if (fn === attributedHandleScript) {
					return attributedRef;
				}

				return {};
			}) as BrowserAdaptor["evaluateHandle"];
			const original = adaptor.evaluate.bind(adaptor);
			adaptor.evaluate = (async (fn, ...args) => {
				if (fn === drainContextObserverScript) {
					return {
						openedWindow: false,
						submittedForm: false,
						focusRemoved: true,
						redirect: null,
						softUrlChange: false,
						navigation: false,
						attributedHtml: '<input id="blurred">',
						hasAttributed: true,
					};
				}

				if (fn === getSelector && args[0] === attributedRef) {
					return "#blurred";
				}

				if (fn === installContextObserverScript || fn === clearAttributedScript) {
					return undefined;
				}

				return original(fn, ...args);
			}) as BrowserAdaptor["evaluate"];

			const ctx = recordingConsumer(["contextSignals"]);
			const plain = recordingConsumer();
			const orchestrator = createTabOrchestrator(adaptor, {
				screenshotSettleDelay: 0,
			});
			orchestrator.attach(ctx);
			orchestrator.attach(plain);
			await orchestrator.run();

			// The synthetic F55 snapshot has no live focused element (it already blurred itself), so only
			// the contextSignals declarer (the capability this mechanism exists to serve) gets notified.
			// A plain consumer with no contextSignals capability has nothing here it could act on, unlike
			// a normal tab stop where every consumer's fields are meaningfully absent-or-present for a
			// real element.
			expect(plain.stops).toHaveLength(0);
			expect(ctx.stops).toHaveLength(1);
			expect(plain.sessionEnds).toEqual(["completed"]);
		});

		it("ends silently with zero stops when isBody has nothing attributed (genuine end of tab sequence)", async () => {
			const adaptor = loopAdaptor({
				hasFocus: [true],
				active: [],
			});
			const original = adaptor.evaluate.bind(adaptor);
			adaptor.evaluate = (async (fn, ...args) => {
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

				if (fn === installContextObserverScript) {
					return undefined;
				}

				return original(fn, ...args);
			}) as BrowserAdaptor["evaluate"];

			const ctx = recordingConsumer(["contextSignals"]);
			const orchestrator = createTabOrchestrator(adaptor, {
				screenshotSettleDelay: 0,
			});
			orchestrator.attach(ctx);
			await orchestrator.run();

			expect(ctx.stops).toHaveLength(0);
			expect(ctx.sessionEnds).toEqual(["completed"]);
		});

		it("does not drain at all when no attached consumer declared contextSignals", async () => {
			let drains = 0;
			const adaptor = loopAdaptor({
				hasFocus: [true],
				active: [],
			});
			const original = adaptor.evaluate.bind(adaptor);
			adaptor.evaluate = (async (fn, ...args) => {
				if (fn === drainContextObserverScript) {
					drains++;
				}

				return original(fn, ...args);
			}) as BrowserAdaptor["evaluate"];

			const plain = recordingConsumer();
			const orchestrator = createTabOrchestrator(adaptor, {
				screenshotSettleDelay: 0,
			});
			orchestrator.attach(plain);
			await orchestrator.run();

			expect(drains).toBe(0);
			expect(plain.stops).toHaveLength(0);
			expect(plain.sessionEnds).toEqual(["completed"]);
		});

		it("ends with reason navigation when the isBody-exit drain throws a destroyed-context error", async () => {
			const adaptor = loopAdaptor({
				hasFocus: [true],
				active: [],
			});
			const original = adaptor.evaluate.bind(adaptor);
			adaptor.evaluate = (async (fn, ...args) => {
				if (fn === drainContextObserverScript) {
					throw new Error("Execution context was destroyed");
				}

				if (fn === installContextObserverScript) {
					return undefined;
				}

				return original(fn, ...args);
			}) as BrowserAdaptor["evaluate"];

			const ctx = recordingConsumer(["contextSignals"]);
			const orchestrator = createTabOrchestrator(adaptor, {
				screenshotSettleDelay: 0,
			});
			orchestrator.attach(ctx);
			await orchestrator.run();

			expect(ctx.stops).toHaveLength(0);
			expect(ctx.sessionEnds).toEqual(["navigation"]);
		});

		/**
		 * Builds a consumer that mirrors `@a11y-pulse/focus-appearance-audit`'s real `onTabStop`
		 * closely enough to be a faithful regression test: it declares `unfocusedPair` +
		 * `baselineStyles` and calls `session.ensureUnfocusedPair()` whenever `snapshot.baselineStyles`
		 * is absent (see `packages/focus-appearance-audit/src/audit.ts`). The synthetic F55 snapshot
		 * never sets `baselineStyles`, so this consumer would call `ensureUnfocusedPair()` for it if
		 * ever notified, which throws synchronously ("unfocusedPair capture not implemented") since
		 * there is no `activeHandle` for the synthetic stop to hold. Scoping notification to
		 * `contextSignals` declarers means this consumer should never be handed the synthetic snapshot
		 * at all.
		 */
		function unfocusedPairConsumer(): TabConsumer & {
			stops: TabStopSnapshot[];
			ensureCalls: number;
		} {
			const record = {
				stops: [] as TabStopSnapshot[],
				ensureCalls: 0,
				capabilities: new Set(["unfocusedPair", "baselineStyles"] as const),
				async onTabStop(
					snapshot: TabStopSnapshot,
					session: { ensureUnfocusedPair(): Promise<unknown> },
				) {
					record.stops.push(snapshot);

					if (!snapshot.baselineStyles) {
						record.ensureCalls++;
						await session.ensureUnfocusedPair();
					}
				},
			};

			return record;
		}

		function f55Adaptor(): BrowserAdaptor {
			const adaptor = loopAdaptor({
				hasFocus: [true],
				active: [],
			});
			const attributedRef = { kind: "attributed" };
			adaptor.evaluateHandle = (async (fn) => {
				if (fn === attributedHandleScript) {
					return attributedRef;
				}

				return {};
			}) as BrowserAdaptor["evaluateHandle"];
			const original = adaptor.evaluate.bind(adaptor);
			adaptor.evaluate = (async (fn, ...args) => {
				if (fn === drainContextObserverScript) {
					return {
						openedWindow: false,
						submittedForm: false,
						focusRemoved: true,
						redirect: null,
						softUrlChange: false,
						navigation: false,
						attributedHtml: '<input id="blurred">',
						hasAttributed: true,
					};
				}

				if (fn === getSelector && args[0] === attributedRef) {
					return "#blurred";
				}

				if (fn === installContextObserverScript || fn === clearAttributedScript) {
					return undefined;
				}

				return original(fn, ...args);
			}) as BrowserAdaptor["evaluate"];

			return adaptor;
		}

		it("screenshots the attributed element for a screenshot declarer, then disposes it", async () => {
			const adaptor = f55Adaptor();
			const rectTargets: unknown[] = [];
			const disposed: unknown[] = [];
			const withRect = adaptor.evaluate.bind(adaptor);
			adaptor.evaluate = (async (fn, ...args) => {
				if (fn === pageDimensionsScript) {
					return { width: 2000, height: 4000 };
				}

				if (fn === elementRectScript) {
					rectTargets.push(args[0]);

					return { x: 10, y: 20, width: 30, height: 40 };
				}

				return withRect(fn, ...args);
			}) as BrowserAdaptor["evaluate"];
			adaptor.disposeRef = async (ref) => {
				disposed.push(ref);
			};

			let screenshot: Uint8Array | undefined;
			const consumer: TabConsumer = {
				capabilities: new Set(["contextSignals", "screenshot"]),
				async onTabStop(_snapshot, session) {
					screenshot = await session.screenshotClip();
				},
			};

			const orchestrator = createTabOrchestrator(adaptor, { screenshotSettleDelay: 0 });
			orchestrator.attach(consumer);
			const stats = await orchestrator.run();

			expect(screenshot).toEqual(new Uint8Array([1]));
			expect(rectTargets).toEqual([{ kind: "attributed" }]);
			expect(disposed).toContainEqual({ kind: "attributed" });
			expect(stats).toMatchObject({ tabStops: 1, screenshots: 1, endReason: "completed" });
		});

		it("does not crash a combined session when an unfocusedPair-declaring consumer (like focus-appearance-audit) is attached alongside contextSignals, and still rescues the contextSignals consumer (unfocusedPair-consumer attached first)", async () => {
			const adaptor = f55Adaptor();
			const pairConsumer = unfocusedPairConsumer();
			const ctx = recordingConsumer(["contextSignals"]);
			const orchestrator = createTabOrchestrator(adaptor, {
				screenshotSettleDelay: 0,
			});
			orchestrator.attach(pairConsumer);
			orchestrator.attach(ctx);

			await expect(orchestrator.run()).resolves.toMatchObject({ endReason: "completed" });

			expect(ctx.sessionEnds).toEqual(["completed"]);
			expect(ctx.stops).toHaveLength(1);
			expect(ctx.stops[0]?.contextSignals?.signals.focusRemoved).toBe(true);
			// Scoped out of notification entirely: no live element for it to act on, so
			// ensureUnfocusedPair() (which would throw) is never reached.
			expect(pairConsumer.stops).toHaveLength(0);
			expect(pairConsumer.ensureCalls).toBe(0);
		});

		it("does not crash a combined session when an unfocusedPair-declaring consumer (like focus-appearance-audit) is attached alongside contextSignals, and still rescues the contextSignals consumer (contextSignals attached first)", async () => {
			const adaptor = f55Adaptor();
			const pairConsumer = unfocusedPairConsumer();
			const ctx = recordingConsumer(["contextSignals"]);
			const orchestrator = createTabOrchestrator(adaptor, {
				screenshotSettleDelay: 0,
			});
			orchestrator.attach(ctx);
			orchestrator.attach(pairConsumer);

			await expect(orchestrator.run()).resolves.toMatchObject({ endReason: "completed" });

			expect(ctx.sessionEnds).toEqual(["completed"]);
			expect(ctx.stops).toHaveLength(1);
			expect(ctx.stops[0]?.contextSignals?.signals.focusRemoved).toBe(true);
			expect(pairConsumer.stops).toHaveLength(0);
			expect(pairConsumer.ensureCalls).toBe(0);
		});

		it("still clears the attributed marker when a contextSignals consumer's onTabStop throws", async () => {
			const adaptor = f55Adaptor();
			let clearCalls = 0;
			const original = adaptor.evaluate.bind(adaptor);
			adaptor.evaluate = (async (fn, ...args) => {
				if (fn === clearAttributedScript) {
					clearCalls++;

					return undefined;
				}

				return original(fn, ...args);
			}) as BrowserAdaptor["evaluate"];

			const throwingCtx: TabConsumer = {
				capabilities: new Set(["contextSignals"]),
				onTabStop: async () => {
					throw new Error("boom");
				},
			};
			const orchestrator = createTabOrchestrator(adaptor, {
				screenshotSettleDelay: 0,
			});
			orchestrator.attach(throwingCtx);

			await expect(orchestrator.run()).rejects.toThrow("boom");
			expect(clearCalls).toBe(1);
		});
	});
});

describe("session limits and failures", () => {
	// Ten distinct elements, more than any limit below allows through.
	const many = Array.from({ length: 10 }, (_, i) => info(i));
	const focused = Array.from({ length: 11 }, () => true);

	it("ends with reason limit once maxTabPresses is used up", async () => {
		const a = recordingConsumer();
		const adaptor = loopAdaptor({ hasFocus: focused, active: many });
		const pressTab = vi.spyOn(adaptor, "pressTab");
		const orchestrator = createTabOrchestrator(adaptor, {
			screenshotSettleDelay: 0,
			maxTabPresses: 3,
		});
		orchestrator.attach(a);

		const stats = await orchestrator.run();

		expect(pressTab).toHaveBeenCalledTimes(3);
		expect(a.stops).toHaveLength(3);
		expect(a.sessionEnds).toEqual(["limit"]);
		expect(stats.endReason).toBe("limit");
	});

	it("ends with reason limit once maxDuration has passed", async () => {
		const a = recordingConsumer([], async () => {
			await new Promise((resolve) => setTimeout(resolve, 15));
		});
		const orchestrator = createTabOrchestrator(loopAdaptor({ hasFocus: focused, active: many }), {
			screenshotSettleDelay: 0,
			maxDuration: 20,
		});
		orchestrator.attach(a);

		const stats = await orchestrator.run();

		expect(stats.endReason).toBe("limit");
		expect(a.stops.length).toBeGreaterThan(0);
		expect(a.stops.length).toBeLessThan(many.length);
	});

	it("detaches a consumer that throws and sees the others through to the end", async () => {
		const broken = recordingConsumer([], (snapshot) => {
			if (snapshot.tabIndex === 2) {
				throw new Error("audit bug");
			}
		});
		const healthy = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			loopAdaptor({ hasFocus: [true, true, true, true], active: [info(0), info(1), info(2)] }),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(broken);
		orchestrator.attach(healthy);

		await expect(orchestrator.run()).rejects.toThrow("audit bug");

		expect(broken.stops).toHaveLength(2);
		expect(broken.sessionEnds).toEqual(["failed"]);
		expect(healthy.stops).toHaveLength(3);
		expect(healthy.sessionEnds).toEqual(["completed"]);
		expect(orchestrator.failures).toHaveLength(1);
		expect(orchestrator.failures[0]?.consumer).toBe(broken);
	});

	it("detaches a consumer whose onSessionStart throws before the first Tab press", async () => {
		const broken: TabConsumer = {
			capabilities: new Set(),
			onSessionStart: () => {
				throw new Error("bad options");
			},
			onTabStop: vi.fn(),
		};
		const healthy = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			loopAdaptor({ hasFocus: [true, true], active: [info(0)] }),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(broken);
		orchestrator.attach(healthy);

		await expect(orchestrator.run()).rejects.toThrow("bad options");

		expect(broken.onTabStop).not.toHaveBeenCalled();
		expect(healthy.stops).toHaveLength(1);
	});

	/** A drain with nothing to report, apart from what `partial` says. */
	function quietDrain(partial: Record<string, unknown> = {}): Record<string, unknown> {
		return {
			openedWindow: false,
			submittedForm: false,
			focusRemoved: false,
			redirect: null,
			softUrlChange: false,
			navigation: false,
			attributedHtml: null,
			hasAttributed: false,
			late: [],
			unattributed: null,
			...partial,
		};
	}

	/** A two-stop session whose context observer answers each drain from `drains` in turn. */
	function dialogAdaptor(counts: number[], drains: Array<Record<string, unknown>>): BrowserAdaptor {
		const adaptor = loopAdaptor({ hasFocus: [true, true, true], active: [info(0), info(1)] });
		const original = adaptor.evaluate.bind(adaptor);

		adaptor.takeDismissedDialogs = () => counts.shift() ?? 0;
		adaptor.evaluate = (async (fn, ...args) => {
			if (fn === drainContextObserverScript) {
				return drains.shift() ?? quietDrain();
			}

			return original(fn, ...args);
		}) as BrowserAdaptor["evaluate"];

		return adaptor;
	}

	it("reports a dialog on the stop whose element the observer saw raise it", async () => {
		const ctx = recordingConsumer(["contextSignals"]);
		// The adaptor is asked before the first press, then once per stop.
		const adaptor = dialogAdaptor([0, 0, 2], [quietDrain(), quietDrain({ raisedDialog: true })]);
		const orchestrator = createTabOrchestrator(adaptor, { screenshotSettleDelay: 0 });
		orchestrator.attach(ctx);

		const stats = await orchestrator.run();

		expect(ctx.stops.map((stop) => stop.contextSignals?.signals.openedDialog)).toEqual([
			false,
			true,
		]);
		expect(ctx.stops.map((stop) => stop.contextSignals?.unattributed)).toEqual([
			undefined,
			undefined,
		]);
		expect(stats.dialogsDismissed).toBe(2);
	});

	it("does not put dialogs dismissed before the first press down to the first stop", async () => {
		const ctx = recordingConsumer(["contextSignals"]);
		const adaptor = dialogAdaptor([3, 0, 0], []);
		const orchestrator = createTabOrchestrator(adaptor, { screenshotSettleDelay: 0 });
		orchestrator.attach(ctx);

		const stats = await orchestrator.run();

		expect(ctx.stops).toHaveLength(2);
		expect(ctx.stops.map((stop) => stop.contextSignals?.signals.openedDialog)).toEqual([
			false,
			false,
		]);
		expect(ctx.stops.map((stop) => stop.contextSignals?.unattributed)).toEqual([
			undefined,
			undefined,
		]);
		expect(stats.dialogsDismissed).toBe(0);
	});

	it("reports a dialog nothing ties to an element as unattributed, not as the stop's", async () => {
		const ctx = recordingConsumer(["contextSignals"]);
		const dialogOnly = {
			signals: {
				openedWindow: false,
				submittedForm: false,
				focusRemoved: false,
				redirect: null,
				softUrlChange: false,
				navigation: false,
				openedDialog: true,
			},
			details: {},
		};
		// On the first stop the observer saw the page raise a dialog on its own account; on the
		// second the adaptor dismissed one the observer never saw (raised from a frame, say).
		const adaptor = dialogAdaptor(
			[0, 1, 1],
			[
				quietDrain({
					unattributed: {
						openedWindow: false,
						submittedForm: false,
						softUrlChange: false,
						navigationPrevented: false,
						raisedDialog: true,
					},
				}),
				quietDrain(),
			],
		);
		const orchestrator = createTabOrchestrator(adaptor, { screenshotSettleDelay: 0 });
		orchestrator.attach(ctx);

		await orchestrator.run();

		expect(ctx.stops.map((stop) => stop.contextSignals?.signals.openedDialog)).toEqual([
			false,
			false,
		]);
		expect(ctx.stops[0]?.contextSignals?.unattributed).toEqual([
			{ signals: { ...dialogOnly.signals, navigationPrevented: false }, details: {} },
		]);
		expect(ctx.stops[1]?.contextSignals?.unattributed).toEqual([dialogOnly]);
	});

	it("hands what the observer still holds at the end of the session to onSessionEnd", async () => {
		const details: unknown[] = [];
		const consumer: TabConsumer = {
			capabilities: new Set(["contextSignals"]),
			onTabStop() {},
			onSessionEnd(_reason, detail) {
				details.push(detail.contextSignals);
			},
		};
		const lateWindow = {
			index: 1,
			html: '<input id="last">',
			openedWindow: true,
			openedWindowUrl: "/late-offer",
			submittedForm: false,
			softUrlChange: false,
			navigationPrevented: false,
			raisedDialog: false,
		};
		// Two stops, the drain at the end of the tab order, then the last one as the session ends.
		const adaptor = dialogAdaptor(
			[],
			[quietDrain(), quietDrain(), quietDrain(), quietDrain({ late: [lateWindow] })],
		);
		const orchestrator = createTabOrchestrator(adaptor, { screenshotSettleDelay: 0 });
		orchestrator.attach(consumer);

		await orchestrator.run();

		expect(details).toEqual([
			{
				late: [
					{
						index: 1,
						html: '<input id="last">',
						signals: {
							openedWindow: true,
							submittedForm: false,
							focusRemoved: false,
							redirect: null,
							softUrlChange: false,
							navigation: false,
							openedDialog: false,
							navigationPrevented: false,
						},
						details: { openedWindowUrl: "/late-offer" },
					},
				],
			},
		]);
	});

	function navigatingAdaptor(replaced: boolean | Error): BrowserAdaptor {
		const adaptor = loopAdaptor({ hasFocus: [true, true, true], active: [info(0), info(1)] });
		const evaluate = adaptor.evaluate;
		let selectors = 0;

		adaptor.evaluate = (async (fn, ...args) => {
			// The second stop's selector lookup is where the document goes away: a call the loop
			// has no navigation check around.
			if (fn === getSelector && ++selectors === 2) {
				throw new Error("Execution context was destroyed, most likely because of a navigation.");
			}

			if (fn === documentReplacedScript && selectors === 2) {
				if (replaced instanceof Error) {
					throw replaced;
				}

				return replaced;
			}

			return evaluate(fn, ...args);
		}) as BrowserAdaptor["evaluate"];

		return adaptor;
	}

	it("ends with reason navigation when any call loses its document and the page comes back on a new one", async () => {
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(navigatingAdaptor(true), {
			screenshotSettleDelay: 0,
		});
		orchestrator.attach(a);

		const stats = await orchestrator.run();

		expect(stats.endReason).toBe("navigation");
		expect(a.sessionEnds).toEqual(["navigation"]);
		expect(a.stops).toHaveLength(1);
	});

	it("fails when a call loses its document and the page never answers again", async () => {
		const a = recordingConsumer();
		const orchestrator = createTabOrchestrator(
			navigatingAdaptor(new Error("Target page, context or browser has been closed")),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(a);

		await expect(orchestrator.run()).rejects.toThrow(/Execution context was destroyed/);
		expect(a.sessionEnds).toEqual(["failed"]);
	});

	it("ends with reason navigation when the tab observer is gone, without contextSignals", async () => {
		const a = recordingConsumer();
		const adaptor = loopAdaptor({ hasFocus: [true, true, true], active: [info(0), info(1)] });
		const evaluate = adaptor.evaluate;
		let checks = 0;

		adaptor.evaluate = (async (fn, ...args) => {
			if (fn === documentReplacedScript) {
				return ++checks === 2;
			}

			return evaluate(fn, ...args);
		}) as BrowserAdaptor["evaluate"];

		const orchestrator = createTabOrchestrator(adaptor, { screenshotSettleDelay: 0 });
		orchestrator.attach(a);

		const stats = await orchestrator.run();

		// The second element belongs to whatever page came next, so it is never reported.
		expect(a.stops).toHaveLength(1);
		expect(stats.endReason).toBe("navigation");
	});
});

describe("isContextDestroyedError", () => {
	it.each([
		"Execution context was destroyed, most likely because of a navigation.",
		"Protocol error (Runtime.callFunctionOn): Target closed.",
		"Target page, context or browser has been closed",
		"Error: frame was detached",
		"Navigating frame was detached",
	])("matches %s", (message) => {
		expect(isContextDestroyedError(new Error(message))).toBe(true);
	});

	it("does not match an unrelated failure", () => {
		expect(isContextDestroyedError(new Error("boom"))).toBe(false);
	});
});
