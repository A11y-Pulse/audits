import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { getSelector } from "@a11y-pulse/browser-adaptor/dom";
import type { ActiveElementInfo } from "@a11y-pulse/tab-orchestrator";
import {
	activeElementHandleScript,
	baselineScript,
	clearMarkersScript,
	createTabOrchestrator,
	elementRectScript,
	hasFocusScript,
	pageDimensionsScript,
	probeActiveElementScript,
	type TabConsumer,
	type TabStopSnapshot,
} from "@a11y-pulse/tab-orchestrator";
import { describe, expect, it } from "vitest";
import {
	clearObscurerScript,
	type MeasureObscuringResult,
	measureObscuringScript,
} from "../../tab-orchestrator/src/browser-scripts";
import { addContextOutlineScript } from "../../tab-orchestrator/src/capture-screenshot";
import { createFocusNotObscuredAudit } from "./audit";
import {
	hasTopPinnedContentScript,
	restoreScrollScript,
	scrollToTopEdgeScript,
} from "./browser-scripts";

const EMPTY_STYLES = { element: {}, before: {}, after: {} };

function info(
	index: number,
	extra: Partial<ActiveElementInfo> = {},
): Omit<ActiveElementInfo, "selector"> {
	return {
		index,
		isBody: false,
		isIframe: false,
		html: `<button>${index}</button>`,
		styles: EMPTY_STYLES,
		rect: { x: 0, y: 0, width: 10, height: 10 },
		...extra,
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

/**
 * Duplicated from `@a11y-pulse/tab-orchestrator`'s own `orchestrator.test.ts` fake-adaptor helper
 * (not exported by the package's public API). Dispatches on the identity of the injected
 * browser-script functions.
 */
function loopAdaptor(script: {
	hasFocus?: boolean[];
	active?: Array<Omit<ActiveElementInfo, "selector"> | null>;
}): BrowserAdaptor {
	let stopIndex = -1;
	let tabbed = false;
	let activeCall = 0;

	return {
		evaluate: (async (fn, ..._args) => {
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

			if (fn === clearMarkersScript) {
				return undefined;
			}

			if (fn === pageDimensionsScript) {
				return { width: 1024, height: 768 };
			}

			if (fn === elementRectScript) {
				return { x: 0, y: 0, width: 10, height: 10 };
			}

			if (fn === hasFocusScript) {
				return script.hasFocus?.[tabbed ? stopIndex : stopIndex + 1] ?? false;
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
		},
		async pressEnter() {},
		async pressKey() {},
		async screenshotClip() {
			return new Uint8Array([1]);
		},
		async ensureFocusReporting() {},
	};
}

/**
 * `loopAdaptor` plus `measureObscuringScript` dispatch: serves the queued measurement for the
 * *current* tab stop on every `measureObscuringScript` call within that stop (the orchestrator
 * re-measures once, after a delay, whenever the first read reports `fullyObscured`, to rule out
 * transient layout), and no-ops the obscurer-marker teardown call so it doesn't consume a
 * `hasFocus` slot.
 */
function obscuringAdaptor(
	measurements: MeasureObscuringResult[],
	overrides: { hasFocus?: boolean[] } = {},
): BrowserAdaptor {
	const adaptor = loopAdaptor({
		hasFocus: overrides.hasFocus ?? measurements.map(() => true).concat(true),
		active: measurements.map((_, index) => info(index)),
	});
	const original = adaptor.evaluate.bind(adaptor);
	let stopIndex = -1;
	adaptor.evaluate = (async (fn, ...args) => {
		if (fn === probeActiveElementScript) {
			stopIndex++;

			return original(fn, ...args);
		}

		if (fn === measureObscuringScript) {
			return measurements[stopIndex];
		}

		if (fn === clearObscurerScript) {
			return undefined;
		}

		if (fn === addContextOutlineScript) {
			return { clip: { x: 0, y: 0, width: 1024, height: 200 } };
		}

		return original(fn, ...args);
	}) as BrowserAdaptor["evaluate"];

	return adaptor;
}

/**
 * `obscuringAdaptor` for the tab pass, then a page with content pinned to its top where every
 * element scrolled to the top edge measures as `scrolled`. Records which selectors were scrolled
 * and how often scroll positions were put back.
 */
function scrollingAdaptor(
	passMeasurements: MeasureObscuringResult[],
	scrolled: MeasureObscuringResult,
	page: { pinnedContent?: boolean } = {},
): BrowserAdaptor & { scrolledSelectors: string[]; restores: number; screenshots: number } {
	const base = obscuringAdaptor(passMeasurements);
	const original = base.evaluate.bind(base);
	const takeScreenshot = base.screenshotClip.bind(base);
	let scrolling = false;
	const adaptor = Object.assign(base, {
		scrolledSelectors: [] as string[],
		restores: 0,
		screenshots: 0,
	});

	adaptor.evaluate = (async (fn, ...args) => {
		if (fn === hasTopPinnedContentScript) {
			return page.pinnedContent ?? true;
		}

		if (fn === scrollToTopEdgeScript) {
			scrolling = true;
			adaptor.scrolledSelectors.push(args[0] as string);

			return true;
		}

		if (fn === restoreScrollScript) {
			scrolling = false;
			adaptor.restores++;

			return undefined;
		}

		if (fn === measureObscuringScript && scrolling) {
			return scrolled;
		}

		return original(fn, ...args);
	}) as BrowserAdaptor["evaluate"];

	adaptor.screenshotClip = async (clip, scale) => {
		adaptor.screenshots++;

		return takeScreenshot(clip, scale);
	};

	return adaptor;
}

function measurement(partial: Partial<MeasureObscuringResult> = {}): MeasureObscuringResult {
	return {
		coveredFraction: 0,
		fullyObscured: false,
		offscreen: false,
		opacity: "opaque",
		obscuredByHtml: null,
		hasObscurer: false,
		...partial,
	};
}

describe("createFocusNotObscuredAudit", () => {
	it("records a violation for opaque full cover and disconnects at elementLimit", async () => {
		const audit = createFocusNotObscuredAudit({ elementLimit: 1 });
		expect(audit.capabilities.has("obscuring")).toBe(true);
		const orchestrator = createTabOrchestrator(
			obscuringAdaptor([
				measurement({
					coveredFraction: 1,
					fullyObscured: true,
					opacity: "opaque",
					obscuredByHtml: "<footer>",
					hasObscurer: true,
				}),
				measurement(),
			]),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(audit);
		await orchestrator.run();
		expect(audit.result.elements).toHaveLength(1);
		expect(audit.result.elements[0]?.bucket).toBe("violation");
		expect(audit.result.summary.reachedLimit).toBe(true);
	});

	it("records a pass for an unobscured element", async () => {
		const audit = createFocusNotObscuredAudit();
		const orchestrator = createTabOrchestrator(obscuringAdaptor([measurement()]), {
			screenshotSettleDelay: 0,
		});
		orchestrator.attach(audit);
		await orchestrator.run();
		expect(audit.result.elements).toHaveLength(1);
		expect(audit.result.elements[0]?.bucket).toBe("pass");
		expect(audit.result.summary.checked).toBe(1);
		expect(audit.result.summary.passed).toBe(1);
		expect(audit.result.summary.failed).toBe(0);
		expect(audit.result.summary.sessionEnd).toBe("completed");
	});

	it("records a pass (not a failure) for a semi-transparent full cover", async () => {
		const audit = createFocusNotObscuredAudit();
		const orchestrator = createTabOrchestrator(
			obscuringAdaptor([
				measurement({
					coveredFraction: 1,
					fullyObscured: true,
					opacity: "semi-transparent",
					obscuredByHtml: "<div>",
					hasObscurer: true,
				}),
			]),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(audit);
		await orchestrator.run();
		expect(audit.result.elements[0]?.bucket).toBe("pass");
		expect(audit.result.summary.failed).toBe(0);
	});

	it("records incomplete (not a failure) for an offscreen focus target", async () => {
		const audit = createFocusNotObscuredAudit();
		const orchestrator = createTabOrchestrator(
			obscuringAdaptor([measurement({ offscreen: true })]),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(audit);
		await orchestrator.run();
		expect(audit.result.elements[0]?.bucket).toBe("incomplete");
		expect(audit.result.summary.failed).toBe(0);
	});

	it("attaches the measurement and selector/html of the obscuring element", async () => {
		const audit = createFocusNotObscuredAudit();
		const orchestrator = createTabOrchestrator(
			obscuringAdaptor([
				measurement({
					coveredFraction: 1,
					fullyObscured: true,
					opacity: "opaque",
					obscuredByHtml: "<footer>Sticky</footer>",
					hasObscurer: true,
				}),
			]),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(audit);
		await orchestrator.run();
		const element = audit.result.elements[0];
		// truncateHtml keeps only the opening tag (see ActiveElementInfo.html).
		expect(element?.measurement.obscuredBy?.html).toBe("<footer>");
		expect(element?.measurement.fullyObscured).toBe(true);
		expect(element?.selector).toBe("#fake");
		expect(element?.tabIndex).toBe(1);
	});

	it("disconnects after failedElementLimit while another consumer keeps receiving stops", async () => {
		const other = recordingConsumer();
		const audit = createFocusNotObscuredAudit({ failedElementLimit: 1 });
		const orchestrator = createTabOrchestrator(
			obscuringAdaptor([
				measurement({
					coveredFraction: 1,
					fullyObscured: true,
					opacity: "opaque",
					hasObscurer: true,
				}),
				measurement(),
			]),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(audit);
		orchestrator.attach(other);
		await orchestrator.run();
		expect(audit.result.summary.checked).toBe(1);
		expect(audit.result.summary.failed).toBe(1);
		expect(audit.result.summary.reachedFailedElementLimit).toBe(true);
		expect(audit.result.summary.reachedLimit).toBe(false);
		expect(audit.result.summary.sessionEnd).toBeNull();
		expect(other.stops).toHaveLength(2);
	});

	it("never finishes early when failedElementLimit is 0 (default)", async () => {
		const audit = createFocusNotObscuredAudit();
		const orchestrator = createTabOrchestrator(
			obscuringAdaptor([
				measurement({
					fullyObscured: true,
					coveredFraction: 1,
					hasObscurer: true,
				}),
				measurement({
					fullyObscured: true,
					coveredFraction: 1,
					hasObscurer: true,
				}),
			]),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(audit);
		await orchestrator.run();
		expect(audit.result.summary.checked).toBe(2);
		expect(audit.result.summary.failed).toBe(2);
		expect(audit.result.summary.reachedFailedElementLimit).toBe(false);
		expect(audit.result.summary.sessionEnd).toBe("completed");
	});

	it("returns results gathered so far when timeout fires during a hung settle", async () => {
		const audit = createFocusNotObscuredAudit({
			timeout: 150,
			screenshotSettleDelay: 80,
		});
		const orchestrator = createTabOrchestrator(
			obscuringAdaptor([measurement(), measurement(), measurement()]),
			{ screenshotSettleDelay: 80 },
		);
		orchestrator.attach(audit);

		const started = Date.now();
		await orchestrator.run();

		expect(Date.now() - started).toBeLessThan(400);
		expect(audit.result.summary.timedOut).toBe(true);
		expect(audit.result.summary.checked).toBe(1);
		expect(audit.result.summary.sessionEnd).toBeNull();
	}, 2000);

	it("does not time out when timeout is 0 (default)", async () => {
		const audit = createFocusNotObscuredAudit({ timeout: 0 });
		const orchestrator = createTabOrchestrator(obscuringAdaptor([measurement(), measurement()]), {
			screenshotSettleDelay: 0,
		});
		orchestrator.attach(audit);
		await orchestrator.run();
		expect(audit.result.summary.timedOut).toBe(false);
		expect(audit.result.summary.checked).toBe(2);
		expect(audit.result.summary.sessionEnd).toBe("completed");
	});

	it("sets sessionEnd to lostFocus when the document loses focus while attached", async () => {
		const audit = createFocusNotObscuredAudit();
		const adaptor = obscuringAdaptor([measurement()], {
			hasFocus: [true, false],
		});
		const orchestrator = createTabOrchestrator(adaptor, {
			screenshotSettleDelay: 0,
		});
		orchestrator.attach(audit);
		await orchestrator.run();
		expect(audit.result.summary.checked).toBe(1);
		expect(audit.result.summary.sessionEnd).toBe("lostFocus");
	});
});

describe("createFocusNotObscuredAudit screenshots", () => {
	it("captures a screenshot for a violation but not for a pass", async () => {
		const audit = createFocusNotObscuredAudit();
		const orchestrator = createTabOrchestrator(
			obscuringAdaptor([
				measurement({
					coveredFraction: 1,
					fullyObscured: true,
					opacity: "opaque",
					hasObscurer: true,
				}),
				measurement(),
			]),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(audit);
		await orchestrator.run();

		expect(audit.result.elements).toHaveLength(2);
		expect(audit.result.elements[0]?.bucket).toBe("violation");
		expect(audit.result.elements[0]?.screenshot).toEqual(new Uint8Array([1]));
		expect(audit.result.elements[1]?.bucket).toBe("pass");
		expect(audit.result.elements[1]?.screenshot).toBeUndefined();
	});

	it("captures a screenshot for an incomplete offscreen element", async () => {
		const audit = createFocusNotObscuredAudit();
		const orchestrator = createTabOrchestrator(
			obscuringAdaptor([measurement({ offscreen: true })]),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(audit);
		await orchestrator.run();

		expect(audit.result.elements[0]?.bucket).toBe("incomplete");
		expect(audit.result.elements[0]?.screenshot).toEqual(new Uint8Array([1]));
	});

	it("omits screenshots past screenshotLimit but keeps every element", async () => {
		const violations = Array.from({ length: 3 }, () =>
			measurement({
				coveredFraction: 1,
				fullyObscured: true,
				opacity: "opaque",
				hasObscurer: true,
			}),
		);
		const audit = createFocusNotObscuredAudit({ screenshotLimit: 2 });
		const orchestrator = createTabOrchestrator(obscuringAdaptor(violations), {
			screenshotSettleDelay: 0,
		});
		orchestrator.attach(audit);
		await orchestrator.run();

		expect(audit.result.elements).toHaveLength(3);
		expect(audit.result.summary.failed).toBe(3);
		expect(audit.result.elements.slice(0, 2).every((e) => e.screenshot)).toBe(true);
		expect(audit.result.elements[2]?.screenshot).toBeUndefined();
	});
});

describe("createFocusNotObscuredAudit not-painted elements", () => {
	it("passes an element that is not painted and has no label to measure", async () => {
		const audit = createFocusNotObscuredAudit();
		const orchestrator = createTabOrchestrator(
			obscuringAdaptor([measurement({ notPainted: true, offscreen: true })]),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(audit);
		await orchestrator.run();

		expect(audit.result.elements.map((element) => element.bucket)).toEqual(["pass"]);
		expect(audit.result.elements[0]?.measurement.notPainted).toBe(true);
		expect(audit.result.elements[0]?.screenshot).toBeUndefined();
	});
});

describe("checkScrolledToTop", () => {
	const hiddenUnderHeader = measurement({
		coveredFraction: 1,
		fullyObscured: true,
		opacity: "opaque",
		obscuredByHtml: "<header>",
		hasObscurer: true,
		coverPosition: "sticky",
	});

	async function tabPass(adaptor: BrowserAdaptor, options = {}) {
		const audit = createFocusNotObscuredAudit(options);
		const orchestrator = createTabOrchestrator(adaptor, { screenshotSettleDelay: 0 });
		orchestrator.attach(audit);
		await orchestrator.run();

		return audit;
	}

	it("turns a pass into a violation when the element is hidden once scrolled to the top", async () => {
		const adaptor = scrollingAdaptor([measurement(), measurement()], hiddenUnderHeader);
		const audit = await tabPass(adaptor);

		expect(audit.result.summary.failed).toBe(0);

		await audit.checkScrolledToTop(adaptor);

		expect(audit.result.elements.map((element) => [element.bucket, element.foundBy])).toEqual([
			["violation", "scrolled-to-top"],
			["violation", "scrolled-to-top"],
		]);
		expect(audit.result.elements[0]?.measurement.obscuredBy).toEqual({
			selector: "#fake",
			html: "<header>",
			position: "sticky",
		});
		expect(audit.result.elements[0]?.screenshot).toBeInstanceOf(Uint8Array);
		expect(audit.result.summary).toMatchObject({ failed: 2, passed: 0, scrolledToTopChecked: 2 });
		// Every scroll is undone, including the last.
		expect(adaptor.restores).toBe(2);
	});

	it("leaves the tab pass's verdict alone when nothing covers the scrolled element", async () => {
		const adaptor = scrollingAdaptor([measurement(), measurement()], measurement());
		const audit = await tabPass(adaptor);

		await audit.checkScrolledToTop(adaptor);

		expect(audit.result.elements.map((element) => [element.bucket, element.foundBy])).toEqual([
			["pass", undefined],
			["pass", undefined],
		]);
		expect(audit.result.summary.scrolledToTopChecked).toBe(2);
		expect(adaptor.restores).toBe(2);
	});

	it("does not scroll anything on a page with nothing pinned to its top", async () => {
		const adaptor = scrollingAdaptor([measurement()], hiddenUnderHeader, { pinnedContent: false });
		const audit = await tabPass(adaptor);

		await audit.checkScrolledToTop(adaptor);

		expect(adaptor.scrolledSelectors).toEqual([]);
		expect(audit.result.elements[0]?.bucket).toBe("pass");
	});

	it("only re-measures elements that passed and were on screen", async () => {
		const adaptor = scrollingAdaptor(
			[
				measurement({ offscreen: true }),
				measurement({ notPainted: true }),
				measurement({
					coveredFraction: 1,
					fullyObscured: true,
					obscuredByHtml: "<footer>",
					hasObscurer: true,
				}),
				measurement(),
			],
			hiddenUnderHeader,
		);
		const audit = await tabPass(adaptor);

		await audit.checkScrolledToTop(adaptor);

		expect(adaptor.scrolledSelectors).toHaveLength(1);
		expect(audit.result.elements.map((element) => element.foundBy)).toEqual([
			undefined,
			undefined,
			undefined,
			"scrolled-to-top",
		]);
	});

	it("samples at most scrolledToTopLimit elements, and none when it is 0", async () => {
		const passes = Array.from({ length: 6 }, () => measurement());

		const limited = scrollingAdaptor(passes, hiddenUnderHeader);
		const limitedAudit = await tabPass(limited, { scrolledToTopLimit: 3 });
		await limitedAudit.checkScrolledToTop(limited);

		// Spread from the first element to the last, not the first three.
		expect(limitedAudit.result.elements.map((element) => element.bucket)).toEqual([
			"violation",
			"pass",
			"pass",
			"violation",
			"pass",
			"violation",
		]);

		const off = scrollingAdaptor(passes, hiddenUnderHeader);
		const offAudit = await tabPass(off, { scrolledToTopLimit: 0 });
		await offAudit.checkScrolledToTop(off);

		expect(off.scrolledSelectors).toEqual([]);
	});

	it("counts scrolled-to-top screenshots against screenshotLimit", async () => {
		const adaptor = scrollingAdaptor(
			[measurement(), measurement(), measurement()],
			hiddenUnderHeader,
		);
		const audit = await tabPass(adaptor, { screenshotLimit: 2 });

		await audit.checkScrolledToTop(adaptor);

		expect(audit.result.elements.map((element) => element.screenshot !== undefined)).toEqual([
			true,
			true,
			false,
		]);
		expect(adaptor.screenshots).toBe(2);
	});
});
