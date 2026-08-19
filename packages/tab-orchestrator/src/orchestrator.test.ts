import { describe, expect, it, vi } from "vitest";
import type { BrowserAdaptor } from "./adaptor";
import {
	activeElementHandleScript,
	baselineScript,
	blurScript,
	clearMarkersScript,
	elementRectScript,
	elementStylesScript,
	focusScript,
	isCenterObscuredScript,
	pageDimensionsScript,
	probeActiveElementScript,
	scrollToCenterScript,
} from "./browser-scripts";
import { getSelector } from "./get-selector";
import { createTabOrchestrator } from "./orchestrator";
import type { ActiveElementInfo, TabConsumer, TabStopSnapshot } from "./types";

function dummyAdaptor(): BrowserAdaptor {
	return {
		evaluate: vi.fn(async () => undefined) as BrowserAdaptor["evaluate"],
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

const EMPTY_STYLES = { element: {}, before: {}, after: {} };

function info(
	index: number,
	extra: Partial<ActiveElementInfo> = {},
): ActiveElementInfo {
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
	capabilities: Array<
		TabConsumer["capabilities"] extends ReadonlySet<infer C> ? C : never
	> = [],
	onStop?: (
		snapshot: TabStopSnapshot,
		disconnect: () => void,
	) => void | Promise<void>,
): TabConsumer & { stops: TabStopSnapshot[]; sessionEnds: string[] } {
	const record = {
		stops: [] as TabStopSnapshot[],
		sessionEnds: [] as string[],
		capabilities: new Set(capabilities),
		async onTabStop(
			snapshot: TabStopSnapshot,
			session: { disconnect(): void },
		) {
			record.stops.push(snapshot);
			await onStop?.(snapshot, () => session.disconnect());
		},
		onSessionEnd(reason: string) {
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
		evaluate: (async (fn, ..._args) => {
			if (fn === baselineScript) {
				return { styles: [EMPTY_STYLES], entries: [] };
			}
			if (fn === probeActiveElementScript) {
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
			return script.hasFocus?.[focusCall++] ?? false;
		}) as BrowserAdaptor["evaluate"],
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
			if (fn === isCenterObscuredScript) {
				return false;
			}
			if (fn === elementRectScript) {
				return { x: 10, y: 20, width: 30, height: 40 };
			}
			if (
				fn === blurScript ||
				fn === focusScript ||
				fn === scrollToCenterScript
			) {
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
		adaptor.evaluate = (async (fn, ...args) => {
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
});
