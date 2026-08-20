import type { ActiveElementInfo } from "@a11y-pulse/tab-orchestrator";
import {
	activeElementHandleScript,
	type BrowserAdaptor,
	baselineScript,
	clearMarkersScript,
	createTabOrchestrator,
	getSelector,
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
import {
	createFocusNotObscuredAudit,
	type FocusNotObscuredOptions,
} from "./audit";

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
 * Duplicated from `@a11y-pulse/tab-orchestrator`'s own `orchestrator.test.ts`
 * fake-adaptor helper (not exported by the package's public API). Dispatches
 * on the identity of the injected browser-script functions.
 */
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

/**
 * `loopAdaptor` plus `measureObscuringScript` dispatch: serves the queued
 * measurement for the *current* tab stop on every `measureObscuringScript`
 * call within that stop (the orchestrator re-measures once, after a 250ms
 * delay, whenever the first read reports `fullyObscured`, to rule out
 * transient layout — see Task 8's obscuring re-check), and no-ops the
 * obscurer-marker teardown call so it doesn't consume a `hasFocus` slot.
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
		return original(fn, ...args);
	}) as BrowserAdaptor["evaluate"];
	return adaptor;
}

function measurement(
	partial: Partial<MeasureObscuringResult> = {},
): MeasureObscuringResult {
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
	it("declares only the obscuring capability", () => {
		const audit = createFocusNotObscuredAudit();
		expect(audit.capabilities.has("obscuring")).toBe(true);
		expect(audit.capabilities.has("unfocusedPair")).toBe(false);
		expect(audit.capabilities.has("baselineStyles")).toBe(false);
		expect(audit.capabilities.size).toBe(1);
	});

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
		const orchestrator = createTabOrchestrator(
			obscuringAdaptor([measurement()]),
			{ screenshotSettleDelay: 0 },
		);
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
		const orchestrator = createTabOrchestrator(
			obscuringAdaptor([measurement(), measurement()]),
			{ screenshotSettleDelay: 0 },
		);
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

describe("createFocusNotObscuredAudit options type", () => {
	it("accepts the documented options", () => {
		const options: FocusNotObscuredOptions = {
			elementLimit: 5,
			failedElementLimit: 1,
			timeout: 100,
			screenshotSettleDelay: 10,
		};
		expect(
			createFocusNotObscuredAudit(options).capabilities.has("obscuring"),
		).toBe(true);
	});
});
