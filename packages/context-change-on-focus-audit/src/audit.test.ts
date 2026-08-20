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
	type DrainContextObserverResult,
	drainContextObserverScript,
	installContextObserverScript,
	locationHrefScript,
} from "../../tab-orchestrator/src/browser-scripts";
import {
	type ContextChangeOnFocusOptions,
	createContextChangeOnFocusAudit,
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

function emptyDrain(): DrainContextObserverResult {
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

/**
 * `loopAdaptor` plus `drainContextObserverScript` dispatch: serves the queued
 * signals for the *current* tab stop, keeps `locationHrefScript` constant so
 * the orchestrator's proactive href-diff navigation check never fires (it
 * would otherwise short-circuit before `onTabStop` for a stop whose fake
 * drain reports `navigation: true`), and no-ops `installContextObserverScript`.
 */
function contextAdaptor(
	drains: DrainContextObserverResult[],
	overrides: { hasFocus?: boolean[] } = {},
): BrowserAdaptor {
	const adaptor = loopAdaptor({
		hasFocus: overrides.hasFocus ?? drains.map(() => true).concat(true),
		active: drains.map((_, index) => info(index)),
	});
	const original = adaptor.evaluate.bind(adaptor);
	let stopIndex = -1;
	adaptor.evaluate = (async (fn, ...args) => {
		if (fn === probeActiveElementScript) {
			stopIndex++;
			return original(fn, ...args);
		}
		if (fn === locationHrefScript) {
			return "http://fake/";
		}
		if (fn === installContextObserverScript) {
			return undefined;
		}
		if (fn === drainContextObserverScript) {
			return drains[stopIndex] ?? emptyDrain();
		}
		return original(fn, ...args);
	}) as BrowserAdaptor["evaluate"];
	return adaptor;
}

describe("createContextChangeOnFocusAudit", () => {
	it("declares only the contextSignals capability", () => {
		const audit = createContextChangeOnFocusAudit();
		expect(audit.capabilities.has("contextSignals")).toBe(true);
		expect(audit.capabilities.has("obscuring")).toBe(false);
		expect(audit.capabilities.has("unfocusedPair")).toBe(false);
		expect(audit.capabilities.has("baselineStyles")).toBe(false);
		expect(audit.capabilities.size).toBe(1);
	});

	it("records a violation for a new window and disconnects at elementLimit", async () => {
		const audit = createContextChangeOnFocusAudit({ elementLimit: 1 });
		const orchestrator = createTabOrchestrator(
			contextAdaptor([drainWith({ openedWindow: true }), emptyDrain()]),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(audit);
		await orchestrator.run();
		expect(audit.result.elements).toHaveLength(1);
		expect(audit.result.elements[0]?.failed).toBe(true);
		expect(audit.result.elements[0]?.findings).toEqual([
			{ kind: "new-window", bucket: "violation" },
		]);
		expect(audit.result.summary.reachedLimit).toBe(true);
	});

	it("records a pass for a clean tab stop", async () => {
		const audit = createContextChangeOnFocusAudit();
		const orchestrator = createTabOrchestrator(contextAdaptor([emptyDrain()]), {
			screenshotSettleDelay: 0,
		});
		orchestrator.attach(audit);
		await orchestrator.run();
		expect(audit.result.elements).toHaveLength(1);
		expect(audit.result.elements[0]?.failed).toBe(false);
		expect(audit.result.elements[0]?.findings).toEqual([]);
		expect(audit.result.summary.checked).toBe(1);
		expect(audit.result.summary.passed).toBe(1);
		expect(audit.result.summary.failed).toBe(0);
		expect(audit.result.summary.sessionEnd).toBe("completed");
	});

	it("records incomplete findings without counting them as failures", async () => {
		const audit = createContextChangeOnFocusAudit();
		const orchestrator = createTabOrchestrator(
			contextAdaptor([drainWith({ softUrlChange: true })]),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(audit);
		await orchestrator.run();
		expect(audit.result.elements[0]?.findings).toEqual([
			{ kind: "url-changed", bucket: "incomplete" },
		]);
		expect(audit.result.elements[0]?.failed).toBe(false);
		expect(audit.result.summary.failed).toBe(0);
	});

	it("attaches the selector/html of the focused element", async () => {
		const audit = createContextChangeOnFocusAudit();
		const orchestrator = createTabOrchestrator(
			contextAdaptor([drainWith({ focusRemoved: true })]),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(audit);
		await orchestrator.run();
		const element = audit.result.elements[0];
		expect(element?.selector).toBe("#fake");
		expect(element?.tabIndex).toBe(1);
		expect(element?.findings).toEqual([
			{ kind: "focus-removed", bucket: "violation" },
		]);
	});

	it("reports a navigation finding and ends the session as navigation", async () => {
		const audit = createContextChangeOnFocusAudit();
		const orchestrator = createTabOrchestrator(
			contextAdaptor([drainWith({ navigation: true }), emptyDrain()]),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(audit);
		await orchestrator.run();
		expect(audit.result.elements).toHaveLength(1);
		expect(audit.result.elements[0]?.findings).toEqual([
			{ kind: "navigation", bucket: "violation" },
		]);
		expect(audit.result.elements[0]?.failed).toBe(true);
		expect(audit.result.summary.sessionEnd).toBe("navigation");
	});

	it("disconnects after failedElementLimit while another consumer keeps receiving stops", async () => {
		const other = recordingConsumer();
		const audit = createContextChangeOnFocusAudit({ failedElementLimit: 1 });
		const orchestrator = createTabOrchestrator(
			contextAdaptor([drainWith({ openedWindow: true }), emptyDrain()]),
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
		const audit = createContextChangeOnFocusAudit();
		const orchestrator = createTabOrchestrator(
			contextAdaptor([
				drainWith({ openedWindow: true }),
				drainWith({ submittedForm: true }),
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
		const audit = createContextChangeOnFocusAudit({
			timeout: 150,
			screenshotSettleDelay: 80,
		});
		const orchestrator = createTabOrchestrator(
			contextAdaptor([emptyDrain(), emptyDrain(), emptyDrain()]),
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
		const audit = createContextChangeOnFocusAudit({ timeout: 0 });
		const orchestrator = createTabOrchestrator(
			contextAdaptor([emptyDrain(), emptyDrain()]),
			{ screenshotSettleDelay: 0 },
		);
		orchestrator.attach(audit);
		await orchestrator.run();
		expect(audit.result.summary.timedOut).toBe(false);
		expect(audit.result.summary.checked).toBe(2);
		expect(audit.result.summary.sessionEnd).toBe("completed");
	});

	it("sets sessionEnd to lostFocus when the document loses focus while attached", async () => {
		const audit = createContextChangeOnFocusAudit();
		const adaptor = contextAdaptor([emptyDrain()], {
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

function drainWith(
	partial: Partial<DrainContextObserverResult>,
): DrainContextObserverResult {
	return { ...emptyDrain(), ...partial };
}

describe("createContextChangeOnFocusAudit options type", () => {
	it("accepts the documented options", () => {
		const options: ContextChangeOnFocusOptions = {
			elementLimit: 5,
			failedElementLimit: 1,
			timeout: 100,
			screenshotSettleDelay: 10,
		};
		expect(
			createContextChangeOnFocusAudit(options).capabilities.has(
				"contextSignals",
			),
		).toBe(true);
	});
});
