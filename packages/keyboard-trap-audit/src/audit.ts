import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
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
	escapeIgnoredScript,
	type FocusProbe,
	focusOutsideScript,
	focusSelectorScript,
	inspectRingScript,
	leaveOutsideScript,
	outsideOpenedScript,
	probeFocusScript,
	type RingInspection,
	watchEscapeScript,
} from "./browser-scripts";
import type {
	EscapeAttempt,
	EscapeKey,
	EscapeRoute,
	InconclusiveReason,
	KeyboardTrapElement,
	KeyboardTrapOutcome,
	KeyboardTrapResult,
} from "./result";

export type { EscapeKey } from "./result";

export const DEFAULT_ESCAPE_ATTEMPT_ROUNDS = 2;

// An Escape handler may close its dialog only after an exit animation, which runs slower on a busy
// machine, so focus is re-read for this long before Escape counts as having done nothing.
const ESCAPE_POLL_MS = 1000;

const ESCAPE_POLL_INTERVAL_MS = 50;

// How long after Escape to ask whether the page visibly ignored it, which ends the wait early.
const ESCAPE_IGNORED_AFTER_MS = 150;

export const RING_ELEMENT_LIMIT = 10;

/**
 * Rings with more members than this are not walked in full: Tab and Shift+Tab are pressed only from
 * the `RING_SAMPLE_SPAN` members either side of where the ring wraps round, which is where a focus
 * trap decides whether to let focus go. A sampled ring that no key left is reported as
 * `inconclusive` (`ring-sampled`) rather than `trapped`, since a way out from a member in the
 * middle of it was never tried.
 */
export const RING_WALK_LIMIT = 32;

export const RING_SAMPLE_SPAN = 8;

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
		inconclusiveReason: null,
		ring: [],
		ringSize: 0,
		container: null,
		dialog: null,
		excludedCount: 0,
		escapedVia: null,
		roundsAttempted: 0,
		keysTried: [],
		attempts: [],
		sampledRing: false,
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

// The audit's `timeout` ran out before the exits had all been tried.
const TIMED_OUT = "timed-out";

// The only exit was past the edge of the page, and the page pulled focus back on re-entry.
const PAGE_EDGE_ONLY = "page-edge-only";

type AttemptOutcome =
	| EscapeRoute
	| typeof RING_CHANGED
	| typeof NAVIGATED
	| typeof TIMED_OUT
	| typeof PAGE_EDGE_ONLY
	| null;

class Navigated extends Error {}

class TimedOut extends Error {}

type EscapeContext = {
	adaptor: BrowserAdaptor;
	ring: readonly string[];
	inspection: Extract<RingInspection, { resolved: true }>;
	rounds: number;
	settleDelay: number;
	/** `Date.now()` after which to give up, or `null` for no limit. */
	deadline: number | null;
	attempts: EscapeAttempt[];
	onRound: (round: number) => void;
};

/**
 * Press each standard exit from the ring in turn, for `rounds` rounds, and return the first that
 * moves focus out of it or dismisses its container.
 */
async function attemptEscape(context: EscapeContext): Promise<AttemptOutcome> {
	const { adaptor, ring, inspection, rounds, settleDelay, deadline, attempts } = context;
	const selectors = [...ring];
	let href: string | undefined;
	let round = 0;
	let edgeOnly = false;
	// The round's Escape press, while its wait was cut short and may yet prove to have worked.
	let pendingEscape: { attempt: EscapeAttempt; pressedAt: number } | null = null;

	const probe = async (): Promise<FocusProbe> => {
		if (deadline !== null && Date.now() > deadline) {
			throw new TimedOut();
		}

		let state: FocusProbe;

		try {
			state = await adaptor.evaluate(probeFocusScript, selectors, CONTAINER_ATTR);
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

	const describe = (state: FocusProbe): string | null =>
		state.landed ? truncateHtml(state.landed) : null;

	const record = (key: EscapeKey, from: FocusProbe): EscapeAttempt => {
		const attempt: EscapeAttempt = {
			round,
			key,
			presses: 0,
			from: describe(from),
			landed: describe(from),
			exited: false,
		};
		attempts.push(attempt);

		return attempt;
	};

	const pressOnce = async (key: EscapeKey, attempt: EscapeAttempt): Promise<FocusProbe> => {
		await adaptor.pressKey(key);
		await sleep(settleDelay);
		const after = await probe();
		attempt.presses++;
		attempt.landed = describe(after);
		attempt.exited = escaped(after);

		return after;
	};

	/** Focus a ring member by script, and read back where focus is. */
	const focusRing = async (index = 0): Promise<FocusProbe> => {
		await adaptor.evaluate(focusSelectorScript, selectors[index]!, index);

		return probe();
	};

	/**
	 * The container went away within the time Escape is given to work, after the wait on it was
	 * cut short: an Escape handler that closes late did that, not the key pressed since.
	 */
	const closedByEscape = (state: FocusProbe): boolean => {
		if (
			pendingEscape === null ||
			state.containerVisible ||
			Date.now() - pendingEscape.pressedAt > ESCAPE_POLL_MS
		) {
			return false;
		}

		pendingEscape.attempt.exited = true;
		pendingEscape.attempt.landed = describe(state);

		return true;
	};

	/**
	 * Whether focus that left the page past one edge can come back in at the other without the
	 * page pulling it into the ring again. A page with nothing outside the ring to land on has no
	 * such re-entry to fail; one whose elements outside the ring have gone since cannot be shown
	 * to let focus stay out.
	 *
	 * Giving an element focus runs the page's handlers for it. What that opened is closed with
	 * Escape where that is safe, a form control gets back what it held, and focus is taken off it.
	 */
	const staysOutside = async (which: "first" | "last"): Promise<boolean> => {
		const reached = await adaptor.evaluate(focusOutsideScript, which);

		if (reached !== "focused") {
			return reached === "none";
		}

		try {
			await sleep(settleDelay);
			const stayed = (await probe()).member === -1;

			if (stayed && (await adaptor.evaluate(outsideOpenedScript))) {
				await adaptor.pressKey("Escape");
				await sleep(settleDelay);
			}

			return stayed;
		} finally {
			try {
				await adaptor.evaluate(leaveOutsideScript);
			} catch {
				// The document this ran in has gone.
			}
		}
	};

	/**
	 * Focus that a Tab or Shift+Tab at the edge of the page left on nothing has gone out to the
	 * browser's own interface, which is how Chromium shows it, rather than to another element.
	 */
	const leftPage = (key: "Tab" | "Shift+Tab", after: FocusProbe): boolean =>
		after.containerVisible &&
		!after.landed &&
		(key === "Shift+Tab" ? inspection.atStart : inspection.atEnd);

	/**
	 * Whether a Tab or Shift+Tab that took focus no further is the browser's own way out of the
	 * page: at the edge of the page, uncancelled, and not undone by the page on the way back in.
	 */
	const leftByPageEdge = async (
		key: "Tab" | "Shift+Tab",
		attempt: EscapeAttempt,
	): Promise<boolean> => {
		const atEdge = key === "Shift+Tab" ? inspection.atStart : inspection.atEnd;

		if (!atEdge || attempt.cancelled) {
			return false;
		}

		attempt.pageEdge = true;

		// From the browser's toolbar the same key comes back in at the other end of the page. A
		// page that pulls focus back into the ring from there has let nothing out.
		if (await staysOutside(key === "Shift+Tab" ? "last" : "first")) {
			attempt.exited = true;

			return true;
		}

		edgeOnly = true;

		return false;
	};

	/**
	 * Press Tab or Shift+Tab from the member at `start`, up to `limit` times, until focus leaves the
	 * ring or comes back to a member this walk has already been on, which closes the loop.
	 */
	const walk = async (
		key: "Tab" | "Shift+Tab",
		start: number,
		limit: number,
	): Promise<"exit" | "escape-key" | typeof RING_CHANGED | null> => {
		let before = await focusRing(start);

		if (escaped(before)) {
			return closedByEscape(before) ? "escape-key" : RING_CHANGED;
		}

		const attempt = record(key, before);
		const seen = new Set<number>([before.member]);

		for (let step = 0; step < limit; step++) {
			const after = await pressOnce(key, attempt);

			if (escaped(after)) {
				if (closedByEscape(after)) {
					attempt.exited = false;

					return "escape-key";
				}

				if (!leftPage(key, after)) {
					return "exit";
				}

				attempt.exited = false;

				return (await leftByPageEdge(key, attempt)) ? "exit" : null;
			}

			const stayed = after.member === before.member;
			const closed = seen.has(after.member);

			if (closed || step === limit - 1) {
				attempt.cancelled = await adaptor.evaluate(tabPreventedScript);
			}

			// A headless browser can keep focus on the first or last element of the page where a real
			// one moves it out to its own toolbar. Focus that stayed put, at the edge of the page,
			// without the page cancelling the key, is that way out.
			if (stayed) {
				return (await leftByPageEdge(key, attempt)) ? "exit" : null;
			}

			if (closed) {
				return null;
			}

			seen.add(after.member);
			before = after;
		}

		return null;
	};

	const sampled = selectors.length > RING_WALK_LIMIT;
	// One more press than the ring has members walks past its first element.
	const walkLimit = sampled ? RING_SAMPLE_SPAN * 2 : selectors.length + 1;
	const backwardStart = sampled ? RING_SAMPLE_SPAN : 0;
	const forwardStart = sampled ? selectors.length - 1 - RING_SAMPLE_SPAN : 0;

	try {
		for (round = 1; round <= rounds; round++) {
			context.onRound(round);
			pendingEscape = null;

			if (inspection.escapeIndex !== -1) {
				const before = await focusRing(inspection.escapeIndex);

				if (escaped(before)) {
					return RING_CHANGED;
				}

				await adaptor.evaluate(watchEscapeScript);
				const attempt = record("Escape", before);
				await adaptor.pressKey("Escape");
				const pressedAt = Date.now();
				attempt.presses = 1;
				let asked = false;

				for (let waited = 0; waited <= ESCAPE_POLL_MS; waited += ESCAPE_POLL_INTERVAL_MS) {
					await sleep(ESCAPE_POLL_INTERVAL_MS);
					const state = await probe();
					attempt.landed = describe(state);

					if (escaped(state)) {
						attempt.exited = true;

						return "escape-key";
					}

					// A page that did nothing at all with the key is not about to close anything.
					if (!asked && waited + ESCAPE_POLL_INTERVAL_MS >= ESCAPE_IGNORED_AFTER_MS) {
						asked = true;

						if (await adaptor.evaluate(escapeIgnoredScript)) {
							// Not every late close can be seen coming, so the keys pressed next do
							// not take the credit for a container that goes within Escape's time.
							pendingEscape = { attempt, pressedAt };

							break;
						}
					}
				}
			}

			const backward = await walk("Shift+Tab", backwardStart, walkLimit);

			if (backward) {
				return backward === "exit" ? "shift-tab" : backward;
			}

			// Arrows change the value of form controls and composite widgets, so they are only
			// pressed where they can do nothing but move focus.
			const arrowIndex = inspection.arrowSafe.indexOf(true);

			if (arrowIndex !== -1) {
				for (const arrow of ["ArrowDown", "ArrowRight"] as const) {
					const start = await focusRing(arrowIndex);

					if (escaped(start)) {
						return closedByEscape(start) ? "escape-key" : RING_CHANGED;
					}

					const arrowAttempt = record(arrow, start);
					const moved = await pressOnce(arrow, arrowAttempt);

					if (escaped(moved)) {
						if (closedByEscape(moved)) {
							arrowAttempt.exited = false;

							return "escape-key";
						}

						return "arrow-key";
					}

					const tab = record("Tab", moved);
					const after = await pressOnce("Tab", tab);

					if (escaped(after) && closedByEscape(after)) {
						tab.exited = false;

						return "escape-key";
					}

					if (escaped(after) && !leftPage("Tab", after)) {
						return "arrow-key";
					}

					tab.exited = false;
					tab.cancelled = await adaptor.evaluate(tabPreventedScript);

					if (
						(escaped(after) || after.member === moved.member) &&
						(await leftByPageEdge("Tab", tab))
					) {
						return "arrow-key";
					}
				}
			}

			const forward = await walk("Tab", forwardStart, walkLimit);

			if (forward) {
				return forward === "exit" ? "tab" : forward;
			}
		}
	} catch (error) {
		if (error instanceof Navigated) {
			return NAVIGATED;
		}

		if (error instanceof TimedOut) {
			return TIMED_OUT;
		}

		throw error;
	}

	return edgeOnly ? PAGE_EDGE_ONLY : null;
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

	const settle = (
		outcome: KeyboardTrapOutcome,
		reason: InconclusiveReason | null = null,
	): KeyboardTrapResult => {
		result.outcome = outcome;
		result.inconclusiveReason = outcome === "inconclusive" ? reason : null;
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
			const deadline = resolved.timeout > 0 ? Date.now() + resolved.timeout : null;

			if (stops.length === 0 && end?.reason === "completed") {
				return settle("no-focusable");
			}

			// Focus that went into an iframe and never came out may be trapped in there, where the
			// tab loop cannot see which elements it is cycling through.
			if (end?.reason === "stuck" && end.detail.stuckIn) {
				result.container = end.detail.stuckIn;

				return settle("inconclusive", "stuck-in-frame");
			}

			if (end?.reason !== "completed") {
				if (result.summary.timedOut) {
					return settle("inconclusive", "timed-out");
				}

				return settle(
					"inconclusive",
					result.summary.reachedLimit ? "element-limit" : "session-ended",
				);
			}

			const { revisitedIndex } = end.detail;

			if (revisitedIndex === null) {
				return settle("no-cycle");
			}

			const ringStart = stops.findIndex((stop) => stop.index === revisitedIndex);

			if (ringStart === -1) {
				return settle("inconclusive", "ring-unresolved");
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

				// A selector built before the page re-rendered can name a different element by now.
				// Judging that element would judge the wrong widget.
				const sameElements =
					inspection.resolved &&
					inspection.tags.every((tag, i) => openingTagName(ring[i]!.html) === tag);

				if (!inspection.resolved || !sameElements) {
					return settle("inconclusive", "ring-unresolved");
				}

				result.excludedCount = inspection.excludedCount + inspection.shutOutCount;
				result.dialog = inspection.dialog ?? null;

				// A modal or `inert` shutting out the rest of the page is still a part of the page holding
				// focus, unless the cycle spans the whole page around it.
				if (
					inspection.excludedCount === 0 &&
					(inspection.shutOutCount === 0 || inspection.containerIsRoot)
				) {
					return settle("small-ring");
				}

				if (inspection.containerIsRoot) {
					return settle("inconclusive", "scattered-ring");
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
				result.sampledRing = ring.length > RING_WALK_LIMIT;

				const escapedVia = await attemptEscape({
					adaptor,
					ring: selectors,
					inspection,
					rounds: resolved.escapeAttemptRounds,
					settleDelay: resolved.screenshotSettleDelay,
					deadline,
					attempts: result.attempts,
					onRound: (round) => {
						result.roundsAttempted = round;
					},
				});

				result.keysTried = [...new Set(result.attempts.map((attempt) => attempt.key))];

				if (escapedVia === TIMED_OUT) {
					result.summary.timedOut = true;

					return settle("inconclusive", "timed-out");
				}

				if (
					escapedVia === RING_CHANGED ||
					escapedVia === NAVIGATED ||
					escapedVia === PAGE_EDGE_ONLY
				) {
					return settle("inconclusive", escapedVia);
				}

				result.escapedVia = escapedVia;

				if (escapedVia) {
					return settle("escaped");
				}

				// No key left the ring from the members that were tried. Only a ring walked in full
				// has been shown to hold focus.
				return result.sampledRing ? settle("inconclusive", "ring-sampled") : settle("trapped");
			} finally {
				// Each step is isolated: after a navigation the scripts may have no document to run in.
				// The audit's own watch on the page's timers comes off before the tab observer's, which
				// it sits on top of.
				try {
					await adaptor.evaluate(clearContainerScript, CONTAINER_ATTR);
				} catch {}

				try {
					await adaptor.evaluate(removeTabObserverScript);
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
