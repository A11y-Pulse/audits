import type { BrowserAdaptor, KeyName } from "@a11y-pulse/browser-adaptor";
import { getSelector, truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import {
	type BaseAuditOptions,
	createAuditSelfDisconnect,
	createTabOrchestrator,
	DEFAULT_ELEMENT_LIMIT,
	DEFAULT_SCREENSHOT_SETTLE_DELAY,
	DEFAULT_TIMEOUT,
	installTabObserverScript,
	removeTabObserverScript,
	type SessionEndDetail,
	type SessionEndReason,
	TABBABLE_SELECTOR,
	type TabConsumer,
	tabPreventedScript,
} from "@a11y-pulse/tab-orchestrator";
import {
	CONTAINER_ATTR,
	clearContainerScript,
	containerHandleScript,
	containerHtmlScript,
	type FocusProbe,
	focusSelectorScript,
	inspectRingScript,
	probeFocusScript,
	type RingInspection,
} from "./browser-scripts";
import type {
	EscapeRoute,
	KeyboardTrapElement,
	KeyboardTrapOutcome,
	KeyboardTrapResult,
} from "./result";

export const DEFAULT_ESCAPE_ATTEMPT_ROUNDS = 2;

/** The keys the escape protocol presses. Never an activation key such as Enter or Space. */
export type EscapeKey = Extract<
	KeyName,
	"Tab" | "Shift+Tab" | "Escape" | "ArrowDown" | "ArrowRight"
>;

// An Escape handler may close its dialog only after an exit animation, which runs slower on a busy
// machine, so focus is re-read for this long before Escape counts as having done nothing.
const ESCAPE_POLL_MS = 1000;

const ESCAPE_POLL_INTERVAL_MS = 50;

export const RING_ELEMENT_LIMIT = 10;

export type KeyboardTrapOptions = Omit<BaseAuditOptions, "failedElementLimit"> & {
	/**
	 * How many times to run the whole escape protocol before reporting a trap, so a transient state
	 * cannot produce a finding on its own.
	 */
	escapeAttemptRounds?: number;
};

type ResolvedOptions = Required<KeyboardTrapOptions>;

function resolveOptions(options: KeyboardTrapOptions): ResolvedOptions {
	return {
		elementLimit: options.elementLimit ?? DEFAULT_ELEMENT_LIMIT,
		screenshotSettleDelay: options.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
		timeout: options.timeout ?? DEFAULT_TIMEOUT,
		escapeAttemptRounds: Math.max(1, options.escapeAttemptRounds ?? DEFAULT_ESCAPE_ATTEMPT_ROUNDS),
	};
}

function emptyResult(): KeyboardTrapResult {
	return {
		outcome: "inconclusive",
		ring: [],
		ringSize: 0,
		container: null,
		excludedCount: 0,
		escapedVia: null,
		roundsAttempted: 0,
		summary: {
			checked: 0,
			passed: 0,
			failed: 0,
			reachedLimit: false,
			reachedFailedElementLimit: false,
			timedOut: false,
			sessionEnd: null,
		},
	};
}

type Stop = KeyboardTrapElement & { index: number | null };

function openingTagName(html: string): string | undefined {
	return /^<([^\s/>]+)/.exec(html)?.[1]?.toLowerCase();
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

// The ring stopped holding focus between attempts, so the state the cycle was found in is gone.
const RING_CHANGED = "ring-changed";

// A key press loaded another document, which says nothing about whether the ring traps focus.
const NAVIGATED = "navigated";

type AttemptOutcome = EscapeRoute | typeof RING_CHANGED | typeof NAVIGATED | null;

class Navigated extends Error {}

/**
 * Press each standard exit from the ring in turn, for `rounds` rounds, and return the first that
 * moves focus out of it or dismisses its container.
 */
async function attemptEscape(
	adaptor: BrowserAdaptor,
	ring: readonly string[],
	inspection: Extract<RingInspection, { resolved: true }>,
	rounds: number,
	settleDelay: number,
	onRound: (round: number) => void,
): Promise<AttemptOutcome> {
	let href: string | undefined;

	const probe = async (): Promise<FocusProbe> => {
		let state: FocusProbe;

		try {
			state = await adaptor.evaluate(probeFocusScript, ring, CONTAINER_ATTR);
		} catch {
			// The document this script ran in has gone.
			throw new Navigated();
		}

		href ??= state.href;

		if (state.href !== href) {
			throw new Navigated();
		}

		return state;
	};

	const escaped = (state: FocusProbe): boolean => state.member === -1 || !state.containerVisible;

	const press = async (key: EscapeKey): Promise<boolean> => {
		const before = await probe();
		await adaptor.pressKey(key);
		await sleep(settleDelay);
		const after = await probe();

		if (escaped(after)) {
			return true;
		}

		// A headless browser can keep focus on the first or last element of the page where a real one
		// moves it out to its own toolbar. Focus that stayed put, at the edge of the page, without the
		// page cancelling the key, is that way out.
		const atEdge = key === "Shift+Tab" ? inspection.atStart : key === "Tab" && inspection.atEnd;

		return (
			atEdge && after.member === before.member && !(await adaptor.evaluate(tabPreventedScript))
		);
	};

	const focusRing = async (index = 0): Promise<boolean> => {
		await adaptor.evaluate(focusSelectorScript, ring[index]!);

		return escaped(await probe());
	};

	try {
		for (let round = 1; round <= rounds; round++) {
			onRound(round);

			if (inspection.escapeIndex !== -1) {
				if (await focusRing(inspection.escapeIndex)) {
					return RING_CHANGED;
				}

				await adaptor.pressKey("Escape");

				for (let waited = 0; waited <= ESCAPE_POLL_MS; waited += ESCAPE_POLL_INTERVAL_MS) {
					await sleep(ESCAPE_POLL_INTERVAL_MS);

					if (escaped(await probe())) {
						return "escape-key";
					}
				}
			}

			if (await focusRing()) {
				return RING_CHANGED;
			}

			// One more press than the ring has members walks backwards past its first element.
			for (let step = 0; step <= ring.length; step++) {
				if (await press("Shift+Tab")) {
					return "shift-tab";
				}
			}

			// Arrows change the value of form controls and composite widgets, so they are only
			// pressed where they can do nothing but move focus.
			const arrowIndex = inspection.arrowSafe.indexOf(true);

			if (arrowIndex !== -1) {
				for (const arrow of ["ArrowDown", "ArrowRight"] as const) {
					if (await focusRing(arrowIndex)) {
						return RING_CHANGED;
					}

					await adaptor.pressKey(arrow);
					await sleep(settleDelay);

					if (escaped(await probe())) {
						return "arrow-key";
					}

					if (await press("Tab")) {
						return "arrow-key";
					}
				}
			}

			if (await focusRing()) {
				return RING_CHANGED;
			}

			for (let step = 0; step <= ring.length; step++) {
				if (await press("Tab")) {
					return "tab";
				}
			}
		}
	} catch (error) {
		if (error instanceof Navigated) {
			return NAVIGATED;
		}

		throw error;
	}

	return null;
}

/**
 * Tab through focusable elements and report whether focus becomes confined to part of the page with
 * no standard keyboard exit (WCAG 2.1.2 No Keyboard Trap). Attach to a `createTabOrchestrator`
 * session, then call `verify` once the session has run. Or use `runKeyboardTrapAudit` to run as the
 * sole consumer.
 */
export function createKeyboardTrapAudit(options: KeyboardTrapOptions = {}): TabConsumer & {
	result: KeyboardTrapResult;
	verify(adaptor: BrowserAdaptor): Promise<KeyboardTrapResult>;
} {
	const resolved = resolveOptions(options);
	const result = emptyResult();
	const stops: Stop[] = [];
	let end: { reason: SessionEndReason; detail: SessionEndDetail } | null = null;
	const selfDisconnect = createAuditSelfDisconnect();

	const settle = (outcome: KeyboardTrapOutcome): KeyboardTrapResult => {
		result.outcome = outcome;
		result.summary.failed = outcome === "trapped" ? 1 : 0;
		result.summary.passed =
			outcome === "no-cycle" || outcome === "small-ring" || outcome === "escaped" ? 1 : 0;

		return result;
	};

	return {
		result,
		capabilities: new Set(),
		onSessionStart(session) {
			selfDisconnect.armTimeout(resolved.timeout, session, () => {
				result.summary.timedOut = true;
			});
		},
		onTabStop(snapshot, session) {
			const { activeElement } = snapshot;
			stops.push({
				index: activeElement.index,
				selector: activeElement.selector,
				html: activeElement.html,
			});
			result.summary.checked = stops.length;

			if (stops.length >= resolved.elementLimit) {
				result.summary.reachedLimit = true;
				selfDisconnect.disconnect(session);
			}
		},
		onSessionEnd(reason, detail) {
			selfDisconnect.clear();

			if (!selfDisconnect.disconnectedSelf) {
				result.summary.sessionEnd = reason;
				end = { reason, detail };
			}
		},
		async verify(adaptor) {
			if (stops.length === 0 && end?.reason === "completed") {
				return settle("no-focusable");
			}

			if (end?.reason !== "completed") {
				return settle("inconclusive");
			}

			const { revisitedIndex } = end.detail;

			if (revisitedIndex === null) {
				return settle("no-cycle");
			}

			const ringStart = stops.findIndex((stop) => stop.index === revisitedIndex);

			if (ringStart === -1) {
				return settle("inconclusive");
			}

			const ring = stops.slice(ringStart);
			const selectors = ring.map((stop) => stop.selector);
			result.ringSize = ring.length;
			result.ring = ring
				.slice(0, RING_ELEMENT_LIMIT)
				.map(({ selector, html }) => ({ selector, html }));

			try {
				const inspection = await adaptor.evaluate(
					inspectRingScript,
					selectors,
					CONTAINER_ATTR,
					TABBABLE_SELECTOR,
				);

				// A selector built in one shadow root, or before the page re-rendered, can name a different
				// element by now. Judging that element would judge the wrong widget.
				const sameElements =
					inspection.resolved &&
					inspection.tags.every((tag, i) => openingTagName(ring[i]!.html) === tag);

				if (!inspection.resolved || !sameElements) {
					return settle("inconclusive");
				}

				result.excludedCount = inspection.excludedCount + inspection.shutOutCount;

				// A modal or `inert` shutting out the rest of the page is still a part of the page holding
				// focus, unless the cycle spans the whole page around it.
				if (
					inspection.excludedCount === 0 &&
					(inspection.shutOutCount === 0 || inspection.containerIsRoot)
				) {
					return settle("small-ring");
				}

				if (inspection.containerIsRoot) {
					return settle("inconclusive");
				}

				const handle = await adaptor.evaluateHandle(containerHandleScript);

				try {
					const selector = await adaptor.evaluate(getSelector, handle);
					const html = await adaptor.evaluate(containerHtmlScript, handle, CONTAINER_ATTR);
					result.container = { selector, html: truncateHtml(html) };
				} finally {
					await adaptor.disposeRef(handle);
				}

				await adaptor.evaluate(installTabObserverScript);

				const escapedVia = await attemptEscape(
					adaptor,
					selectors,
					inspection,
					resolved.escapeAttemptRounds,
					resolved.screenshotSettleDelay,
					(round) => {
						result.roundsAttempted = round;
					},
				);

				if (escapedVia === RING_CHANGED || escapedVia === NAVIGATED) {
					return settle("inconclusive");
				}

				result.escapedVia = escapedVia;

				return settle(escapedVia ? "escaped" : "trapped");
			} finally {
				// Each step is isolated: after a navigation the scripts may have no document to run in.
				try {
					await adaptor.evaluate(removeTabObserverScript);
				} catch {}

				try {
					await adaptor.evaluate(clearContainerScript, CONTAINER_ATTR);
				} catch {}
			}
		},
	};
}

/**
 * Tab through focusable elements and report whether focus becomes confined to part of the page with
 * no standard keyboard exit. Builds a private tab session, drives the loop, verifies any cycle, and
 * hands back this consumer's result.
 */
export async function runKeyboardTrapAudit(
	adaptor: BrowserAdaptor,
	options: KeyboardTrapOptions = {},
): Promise<KeyboardTrapResult> {
	const resolved = resolveOptions(options);
	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: resolved.screenshotSettleDelay,
		markerLimit: resolved.elementLimit,
	});
	const audit = createKeyboardTrapAudit(options);
	orchestrator.attach(audit);
	await orchestrator.run();

	return audit.verify(adaptor);
}
