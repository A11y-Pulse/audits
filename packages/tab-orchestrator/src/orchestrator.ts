import type { BrowserAdaptor, ElementRef } from "@a11y-pulse/browser-adaptor";
import { getSelector, truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import {
	type ActiveElementBase,
	activeElementHandleScript,
	attributedHandleScript,
	type ContextEventSummary,
	clearAttributedScript,
	clearContextFocusInsScript,
	type DrainContextObserverResult,
	documentReplacedScript,
	drainContextObserverScript,
	hasFocusScript,
	landedHrefScript,
	probeActiveElementScript,
	TABBABLE_SELECTOR,
} from "./browser-scripts";
import { captureContextScreenshot, captureScreenshot } from "./capture-screenshot";
import { ComposedTimeoutError, runComposed } from "./compose-script";
import { FOCUS_STYLE_PROPERTIES } from "./focus-style";
import { toObscuredMeasurement } from "./obscuring";
import {
	COMPOSED_SENTINEL,
	finalContextScript,
	type SessionStartArgs,
	type SessionStartResult,
	sessionEndScript,
	sessionStartScript,
	type TabStopArgs,
	type TabStopHost,
	type TabStopResult,
	tabStopScript,
} from "./session-scripts";
import { forgetStopElementScript, stopElementHandleScript } from "./stop-element";
import type {
	ActiveElementInfo,
	Capability,
	ConsumerFailure,
	ContextChangeDetails,
	ContextChangeDrain,
	ContextChangeSignals,
	SessionEndDetail,
	SessionEndReason,
	StyleSnapshot,
	TabConsumer,
	TabSessionHandle,
	TabSessionStats,
	TabStopSnapshot,
	UnfocusedPair,
} from "./types";
import { captureUnfocusedPair } from "./unfocused-pair";

/**
 * Whether an `evaluate()` rejection looks like the page navigated out from
 * under it (execution context destroyed) rather than an unexpected failure.
 * A full navigation is the one context-change signal the in-page observer
 * can never self-report: it destroys the JS context before it can log
 * anything, so the host has to infer it from how `evaluate()` failed.
 */
export function isContextDestroyedError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);

	// Each adaptor's driver words this differently: "Target closed" is Puppeteer's, "has been
	// closed" is Playwright's.
	return /Execution context was destroyed|Target closed|has been closed|frame was detached|navigat/i.test(
		message,
	);
}

function contextDetails(
	summary: ContextEventSummary,
	formSelector: string | null,
): ContextChangeDetails {
	const details: ContextChangeDetails = {};

	if (summary.openedWindow) {
		details.openedWindowUrl = summary.openedWindowUrl ?? "";
	}

	if (summary.submittedForm && summary.submittedFormHtml !== null) {
		details.submittedForm = {
			selector: formSelector,
			html: truncateHtml(summary.submittedFormHtml),
			action: summary.submittedFormAction ?? "",
		};
	}

	if (summary.softUrlChange && summary.urlFrom !== null && summary.urlTo !== null) {
		details.urlChange = { from: summary.urlFrom, to: summary.urlTo };
	}

	if (summary.navigationPrevented) {
		details.navigationUrl = summary.navigationUrl ?? "";
	}

	return details;
}

/** The signals of a change that is not about the focused element losing or passing on focus. */
function summarySignals(summary: ContextEventSummary): ContextChangeSignals {
	return {
		openedWindow: summary.openedWindow,
		submittedForm: summary.submittedForm,
		focusRemoved: false,
		redirect: null,
		softUrlChange: summary.softUrlChange,
		navigation: false,
		openedDialog: summary.raisedDialog === true,
		navigationPrevented: summary.navigationPrevented,
	};
}

/** The changes a drain reports that are not the current stop's: late ones, and ownerless ones. */
function toCarriedContext(
	raw: DrainContextObserverResult,
	dialogsDismissed: boolean,
): Pick<ContextChangeDrain, "late" | "unattributed"> {
	const carried: Pick<ContextChangeDrain, "late" | "unattributed"> = {};
	const late = Array.isArray(raw.late) ? raw.late : [];

	if (late.length > 0) {
		carried.late = late.map((change) => ({
			index: change.index,
			html: truncateHtml(change.html),
			signals: summarySignals(change),
			details: contextDetails(change, null),
		}));
	}

	if (raw.unattributed) {
		carried.unattributed = [
			{
				signals: summarySignals(raw.unattributed),
				details: contextDetails(raw.unattributed, null),
			},
		];
	}

	// A dialog the adaptor dismissed that the observer never saw raised (one from a frame, or a
	// `beforeunload` prompt) cannot be put down to any element.
	const seen =
		raw.raisedDialog === true ||
		raw.unattributed?.raisedDialog === true ||
		late.some((change) => change.raisedDialog === true);

	if (dialogsDismissed && !seen) {
		carried.unattributed = [
			...(carried.unattributed ?? []),
			{
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
			},
		];
	}

	return carried;
}

/** Add what earlier drains left undelivered to what this one reports. */
function mergeCarried(
	into: Pick<ContextChangeDrain, "late" | "unattributed">,
	carried: Pick<ContextChangeDrain, "late" | "unattributed">,
): void {
	if (carried.late && carried.late.length > 0) {
		into.late = [...carried.late, ...(into.late ?? [])];
	}

	if (carried.unattributed && carried.unattributed.length > 0) {
		into.unattributed = [...carried.unattributed, ...(into.unattributed ?? [])];
	}
}

/** What consumers are shown of one drain of the context observer. */
function toContextDrain(
	raw: DrainContextObserverResult,
	dialogsDismissed: boolean,
	attributed: { selector: string; html: string } | null,
	formSelector: string | null,
): ContextChangeDrain {
	const details = contextDetails(raw, formSelector);

	if (attributed !== null) {
		details.attributed = attributed;
	}

	return {
		signals: {
			openedWindow: raw.openedWindow,
			submittedForm: raw.submittedForm,
			focusRemoved: raw.focusRemoved,
			redirect: raw.redirect,
			softUrlChange: raw.softUrlChange,
			navigation: raw.navigation,
			openedDialog: raw.raisedDialog === true,
			navigationPrevented: raw.navigationPrevented === true,
			focusGuard: raw.focusGuard === true,
		},
		details,
		...toCarriedContext(raw, dialogsDismissed),
	};
}

export const DEFAULT_SCREENSHOT_SETTLE_DELAY = 33;
export const DEFAULT_SCREENSHOT_CLIP_BUFFER = 10;
export const DEFAULT_MARKER_LIMIT = 1024;
export const MARKER_ATTR = "data-a11y-focus-idx";
export const OBSCURER_ATTR = "data-a11y-obscurer";
export const OBSCURING_RECHECK_DELAY_MS = 250;

/**
 * Tab presses a session makes before it gives up. Consumers normally stop themselves long before
 * this; it is what ends a session on a page that never runs out of new tab stops.
 */
export const DEFAULT_MAX_TAB_PRESSES = 4096;

// The longest a stop script keeps looking again at an element that is still moving, and what a
// composed stop script is allowed on top of its own waits before the host gives up on it. Must be
// at least the limit the stop script itself applies.
const OBSCURING_SETTLE_LIMIT_MS = 1500;
const COMPOSED_STOP_MARGIN_MS = 3000;

// Consecutive Tab presses one element may absorb before it counts as stuck.
const MAX_INTERNAL_STOPS = 10;

// Consecutive Tab presses focus may spend inside iframes, whose own elements the loop cannot tell
// apart, before it counts as stuck there.
const MAX_IFRAME_STOPS = 256;

/**
 * How long a session with a `contextSignals` consumer waits, as it ends, for short timers set in
 * the focus handling of the elements it visited. The tab observer tags timers of up to a second.
 */
const FINAL_TIMER_WAIT_MS = 1000;

// How often, and how far apart in milliseconds, to ask a page whose execution context was just
// destroyed whether it has come back on a new document.
const NAVIGATION_PROBE_ATTEMPTS = 5;
const NAVIGATION_PROBE_INTERVAL_MS = 50;
/** Longest to wait for a navigation that has started to bring its new document in. */
const NAVIGATION_LAND_LIMIT_MS = 5000;
// How long a stop gives a document that has started to leave to be replaced, before it counts as
// having stayed. The stop script waits this out itself, so it must fit in COMPOSED_STOP_MARGIN_MS.
const LEAVING_LIMIT_MS = 2000;

// Consecutive Tab presses that may each land on an element which gives focus straight back, before
// the page counts as never letting focus settle.
const MAX_BLURRED_STOPS = 32;

export type TabSessionOptions = {
	screenshotSettleDelay?: number;
	screenshotClipBuffer?: number;
	markerLimit?: number;
	baselineElementLimit?: number;
	/**
	 * Tab presses after which the session ends with reason `limit`, whatever its consumers are doing.
	 * Defaults to `DEFAULT_MAX_TAB_PRESSES`.
	 */
	maxTabPresses?: number;
	/** Milliseconds after which the session ends with reason `limit`. 0, the default, is no limit. */
	maxDuration?: number;
	/**
	 * Send the page scripts each step needs as one function, in one call to the browser. Defaults to
	 * true. The session falls back to one call per script by itself when the adaptor's `evaluate()`
	 * turns out not to run such a function; set this to false to skip the attempt.
	 */
	composeScripts?: boolean;
};

export type TabOrchestrator = {
	attach(consumer: TabConsumer): void;
	/**
	 * Tab through the page. Rejects when the session itself fails, and also, once every other
	 * consumer has been seen through to the end, when a consumer threw.
	 */
	run(): Promise<TabSessionStats>;
	/** The consumers that threw during the session, each detached at that point. */
	readonly failures: readonly ConsumerFailure[];
};

export function createTabOrchestrator(
	adaptor: BrowserAdaptor,
	options: TabSessionOptions = {},
): TabOrchestrator {
	const consumers: TabConsumer[] = [];
	let started = false;
	let ran = false;
	const failures: ConsumerFailure[] = [];

	return {
		failures,
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

			const startedAt = performance.now();
			const stats: TabSessionStats = {
				tabStops: 0,
				unfocusedPairs: 0,
				screenshots: 0,
				captureMs: 0,
				durationMs: 0,
				endReason: null,
				dialogsDismissed: 0,
			};

			if (consumers.length === 0) {
				return stats;
			}

			const timedCapture = async <T>(capture: () => Promise<T>): Promise<T> => {
				const captureStartedAt = performance.now();

				try {
					return await capture();
				} finally {
					stats.captureMs += performance.now() - captureStartedAt;
				}
			};

			const attached = new Set(consumers);
			const screenshotSettleDelay =
				options.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY;
			const screenshotClipBuffer = options.screenshotClipBuffer ?? DEFAULT_SCREENSHOT_CLIP_BUFFER;
			const markerLimit = Math.max(
				options.markerLimit ?? DEFAULT_MARKER_LIMIT,
				options.baselineElementLimit ?? 0,
			);
			const maxTabPresses = options.maxTabPresses ?? DEFAULT_MAX_TAB_PRESSES;
			const maxDuration = options.maxDuration ?? 0;
			const styleProps = [...FOCUS_STYLE_PROPERTIES];
			const resolved = {
				screenshotSettleDelay,
				screenshotClipBuffer,
				styleProps,
				// Whether page scripts travel composed, one call per step. Only set once the adaptor
				// has shown, at session start, that it runs such a function.
				composed: false,
			};

			let settleTimer: ReturnType<typeof setTimeout> | undefined;
			let resolveSettle: (() => void) | undefined;
			const pairByStop = { current: null as Promise<UnfocusedPair> | null };
			const screenshotByStop = { current: null as Promise<Uint8Array> | null };
			const attributedShotByStop = { current: null as Promise<Uint8Array> | null };
			// The last stop consumers were shown, and whether they were shown a navigation, so that a
			// navigation nobody could be shown the cause of can at least say where it came after.
			let lastStop: { selector: string; html: string } | null = null;
			let navigationShown = false;
			let navigatedTo: string | null = null;
			// The element the current stop is about. Fetched from the page the first time a capture
			// asks for it, so a stop nobody captures costs no handle.
			const stopElement = {
				active: false,
				ref: undefined as ElementRef | undefined,
				pending: null as Promise<ElementRef> | null,
				// The stop was measured by a composed script, which kept its element in the page.
				remembered: false,
			};
			let tabPressedAt = 0;
			let lastHasAttributed = false;
			// The end of the session, from when the loop decides on it until consumers are told.
			let pendingEnd: {
				reason: SessionEndReason;
				detail: SessionEndDetail;
				consumers: TabConsumer[];
			} | null = null;
			// Late and ownerless context changes read at a point where no consumer was notified
			// (focus on the body with nothing to attribute), kept for the next notification.
			let carried: Pick<ContextChangeDrain, "late" | "unattributed"> = {};
			// Captured when observers are installed and re-armed after every
			// detected soft URL change, so repeated soft navigations across stops
			// compare against the most recent href rather than the original load.
			let baselineHref: string | null = null;

			const remainingHas = (capability: Capability): boolean =>
				[...attached].some((c) => c.capabilities.has(capability));

			// Decided once from who is attached at session start; never re-checked,
			// so the observer stays installed even after every declarer disconnects
			// (it is only uninstalled when the session is torn down, and skipped per-stop until then).
			const contextSignalsWanted = remainingHas("contextSignals");

			// Computed styles are only read for consumers that compare them.
			const wantedStyleProps = (): string[] =>
				remainingHas("baselineStyles") || remainingHas("unfocusedPair") ? styleProps : [];

			const stopHandle = (): Promise<ElementRef> => {
				if (stopElement.ref !== undefined) {
					return Promise.resolve(stopElement.ref);
				}

				// A composed stop script left the element it measured in the page under a name. Asking
				// for whatever is focused now would be wrong once focus has moved on, which a focus
				// handler passing focus along from a timer does before a slow consumer captures.
				stopElement.pending ??= adaptor
					.evaluateHandle(
						stopElement.remembered ? stopElementHandleScript : activeElementHandleScript,
					)
					.then((ref) => {
						stopElement.ref = ref;

						return ref;
					});

				return stopElement.pending;
			};

			/**
			 * A capture is the one thing that needs the page to have painted the focused state, so it
			 * is what pays the full settle delay when the measurements before it did not have to.
			 */
			const captureReady = async (): Promise<void> => {
				if (!resolved.composed) {
					return;
				}

				const remaining = screenshotSettleDelay - (performance.now() - tabPressedAt);

				if (remaining > 0) {
					await new Promise((resolve) => setTimeout(resolve, remaining));
				}
			};

			const handleFor = (consumer: TabConsumer): TabSessionHandle => ({
				disconnect() {
					attached.delete(consumer);

					if (attached.size === 0 && settleTimer !== undefined) {
						clearTimeout(settleTimer);
						settleTimer = undefined;
						resolveSettle?.();
						resolveSettle = undefined;
					}
				},
				ensureUnfocusedPair: () => {
					if (!consumer.capabilities.has("unfocusedPair")) {
						throw new Error("Consumer did not declare unfocusedPair");
					}

					if (!remainingHas("unfocusedPair")) {
						throw new Error("Consumer did not declare unfocusedPair");
					}

					if (!stopElement.active) {
						throw new Error("unfocusedPair capture not implemented");
					}

					if (pairByStop.current === null) {
						stats.unfocusedPairs++;
						pairByStop.current = timedCapture(async () => {
							await captureReady();

							return captureUnfocusedPair(adaptor, resolved, await stopHandle());
						});
					}

					return pairByStop.current;
				},
				screenshotClip: (target = "focused") => {
					if (!consumer.capabilities.has("screenshot")) {
						throw new Error("Consumer did not declare screenshot");
					}

					if (!remainingHas("screenshot")) {
						throw new Error("Consumer did not declare screenshot");
					}

					if (!stopElement.active) {
						throw new Error("screenshot capture not implemented");
					}

					if (target === "attributed") {
						if (attributedShotByStop.current === null) {
							stats.screenshots++;
							attributedShotByStop.current = timedCapture(async () => {
								await captureReady();

								const ref = await adaptor.evaluateHandle(attributedHandleScript);

								try {
									return await captureScreenshot(adaptor, resolved, ref);
								} finally {
									await adaptor.disposeRef(ref);
								}
							});
						}

						return attributedShotByStop.current;
					}

					if (screenshotByStop.current === null) {
						stats.screenshots++;
						screenshotByStop.current = timedCapture(async () => {
							await captureReady();

							return captureScreenshot(adaptor, resolved, await stopHandle());
						});
					}

					return screenshotByStop.current;
				},
				screenshotContext: () => {
					if (!consumer.capabilities.has("screenshot") || !remainingHas("screenshot")) {
						throw new Error("Consumer did not declare screenshot");
					}

					if (!stopElement.active) {
						throw new Error("screenshot capture not implemented");
					}

					stats.screenshots++;

					return timedCapture(async () => {
						await captureReady();

						return captureContextScreenshot(adaptor, await stopHandle());
					});
				},
			});

			/** Let go of the current stop's element once every capture of it has finished. */
			const releaseStopElement = async (): Promise<void> => {
				stopElement.active = false;

				for (const capture of [
					pairByStop.current,
					screenshotByStop.current,
					attributedShotByStop.current,
					stopElement.pending,
				]) {
					try {
						await capture;
					} catch {
						// Capture errors already surface through the consumer that awaited.
					}
				}

				const ref = stopElement.ref;
				stopElement.ref = undefined;
				stopElement.pending = null;

				if (ref !== undefined) {
					await adaptor.disposeRef(ref);
				}
			};

			const end = (
				reason: SessionEndReason,
				revisitedIndex: number | null = null,
				stuckIn: SessionEndDetail["stuckIn"] = null,
			): void => {
				stats.endReason = reason;

				const detail: SessionEndDetail = stuckIn ? { revisitedIndex, stuckIn } : { revisitedIndex };

				if (reason === "navigation" && !navigationShown) {
					detail.navigation = { after: lastStop, url: navigatedTo };
				}

				// Consumers are told once the loop is over (`deliverEnd`), after the context observer
				// has been read a last time. Until then the session just has nobody left attached.
				pendingEnd = { reason, detail, consumers: [...attached] };
				attached.clear();
			};

			/** Tell the consumers of a session that has ended that it has. */
			const deliverEnd = (): void => {
				const ending = pendingEnd;

				pendingEnd = null;

				if (ending === null) {
					return;
				}

				for (const consumer of ending.consumers) {
					try {
						consumer.onSessionEnd?.(ending.reason, ending.detail);
					} catch (error) {
						failures.push({ consumer, error });
					}
				}
			};

			/**
			 * Read the context observer one last time before the session ends. Changes the last
			 * elements of the tab order deferred to a short timer have no later stop to be reported
			 * at, so the timers are waited for (up to `FINAL_TIMER_WAIT_MS`) and what they did is put
			 * on the end detail, along with anything earlier drains left undelivered.
			 */
			const flushContext = async (): Promise<void> => {
				const ending = pendingEnd;

				if (
					ending === null ||
					!contextSignalsWanted ||
					ending.reason === "navigation" ||
					ending.reason === "failed" ||
					!ending.consumers.some((consumer) => consumer.capabilities.has("contextSignals"))
				) {
					return;
				}

				const remaining: Pick<ContextChangeDrain, "late" | "unattributed"> = {};

				try {
					const reading = runComposed(
						adaptor,
						finalContextScript,
						{ composed: resolved.composed },
						{ markerAttr: MARKER_ATTR, maxWaitMs: FINAL_TIMER_WAIT_MS },
					);

					reading.catch(() => {});

					// Bounded on the host as well: the wait runs on the page's own timers, which a page
					// is free to have replaced with ones that never fire. The observer can still be read
					// without waiting.
					let giveUp: ReturnType<typeof setTimeout> | undefined;
					let raw: DrainContextObserverResult | null | undefined;

					try {
						raw = await Promise.race([
							reading,
							new Promise<undefined>((resolve) => {
								giveUp = setTimeout(() => resolve(undefined), FINAL_TIMER_WAIT_MS + 500);
							}),
						]);
					} finally {
						clearTimeout(giveUp);
					}

					if (raw === undefined) {
						raw = await adaptor.evaluate(drainContextObserverScript, MARKER_ATTR, true);
					}

					const dialogs = adaptor.takeDismissedDialogs?.() ?? 0;

					stats.dialogsDismissed += dialogs;

					if (raw) {
						mergeCarried(remaining, toCarriedContext(raw, dialogs > 0));
					}
				} catch {
					// A page that has gone, or an adaptor that cannot run the scripts, has nothing more
					// to say. What was carried over is still delivered.
				}

				mergeCarried(remaining, carried);
				carried = {};

				if (remaining.late || remaining.unattributed) {
					ending.detail.contextSignals = remaining;
				}
			};

			/**
			 * Run one consumer's callback. A consumer that throws is detached and told the session
			 * failed for it, and the others carry on: one audit's bug must not cost every other
			 * audit sharing the pass its results.
			 */
			const notify = async (
				consumer: TabConsumer,
				call: () => void | Promise<void>,
			): Promise<void> => {
				try {
					await call();
				} catch (error) {
					failures.push({ consumer, error });

					if (attached.delete(consumer)) {
						try {
							consumer.onSessionEnd?.("failed", { revisitedIndex: null });
						} catch {}
					}
				}
			};

			/**
			 * Whether the page reports focus, re-asserting focus reporting once
			 * before answering no.
			 */
			async function documentHasFocus(): Promise<boolean> {
				if (await adaptor.evaluate(hasFocusScript)) {
					return true;
				}

				// Another target taking the foreground clears focus emulation.
				await adaptor.ensureFocusReporting();

				return adaptor.evaluate(hasFocusScript);
			}

			/**
			 * Whether the page is alive on a document other than the one the session started on,
			 * allowing a navigation still in flight a moment to land.
			 */
			async function documentWasReplaced(): Promise<boolean> {
				for (let attempt = 0; attempt < NAVIGATION_PROBE_ATTEMPTS; attempt++) {
					try {
						return (await adaptor.evaluate(documentReplacedScript)) === true;
					} catch (error) {
						if (!isContextDestroyedError(error)) {
							return false;
						}
					}

					await new Promise((resolve) => setTimeout(resolve, NAVIGATION_PROBE_INTERVAL_MS));
				}

				return false;
			}

			/**
			 * End the session on a navigation, first asking the document the page landed on where
			 * that is. A navigation consumers were already shown needs no such evidence.
			 */
			async function endOnNavigation(): Promise<void> {
				const landBy = Date.now() + NAVIGATION_LAND_LIMIT_MS;
				let destroyed = 0;

				while (!navigationShown && destroyed < NAVIGATION_PROBE_ATTEMPTS) {
					try {
						const landed = await adaptor.evaluate(landedHrefScript);

						if (!landed?.leaving) {
							if (typeof landed?.href === "string") {
								navigatedTo = landed.href;
							}

							break;
						}

						// The page is still on the document it is leaving: where it is now is not where it
						// went. Give the new one until the limit to arrive, then say nothing of where.
						if (Date.now() >= landBy) {
							break;
						}
					} catch (error) {
						if (!isContextDestroyedError(error)) {
							break;
						}

						destroyed++;
					}

					await new Promise((resolve) => setTimeout(resolve, NAVIGATION_PROBE_INTERVAL_MS));
				}

				end("navigation");
			}

			let failure: unknown;
			// Held for the session only: outside it the page's dialogs are the caller's business.
			const stopDismissingDialogs = adaptor.startDismissingDialogs?.();

			try {
				await adaptor.ensureFocusReporting();

				const startArgs: SessionStartArgs = {
					sentinel: COMPOSED_SENTINEL,
					styleProps: wantedStyleProps(),
					markerAttr: MARKER_ATTR,
					markerLimit,
					wantContext: contextSignalsWanted,
				};
				let opening: SessionStartResult | undefined;

				if (options.composeScripts ?? true) {
					// The first composed script doubles as the test of whether the adaptor runs one: only
					// a function that really ran in a page answers with the sentinel.
					let answer: SessionStartResult | undefined;

					try {
						answer = await runComposed(adaptor, sessionStartScript, { composed: true }, startArgs);
					} catch (error) {
						if (isContextDestroyedError(error)) {
							throw error;
						}
					}

					if (answer?.sentinel === COMPOSED_SENTINEL) {
						opening = answer;
						resolved.composed = true;
					}
				}

				opening ??= await runComposed(adaptor, sessionStartScript, { composed: false }, startArgs);

				const payload = opening.payload;
				const interned = new Map<number, StyleSnapshot>();

				for (const entry of payload.entries) {
					const styles = payload.styles[entry.styleIndex];

					if (styles !== undefined) {
						interned.set(entry.index, styles);
					}
				}

				if (contextSignalsWanted) {
					baselineHref = opening.href;
				}

				for (const consumer of [...attached]) {
					await notify(consumer, () => consumer.onSessionStart?.(handleFor(consumer)));
				}

				const visited = new Set<number>();
				// Elements the baseline did not mark (media players, summaries, content added later) are
				// marked when first focused, numbered from the limit no baseline index can reach.
				let nextMarker = markerLimit;
				let previousIndex: number | null = null;
				let internalStops = 0;
				let iframeStops = 0;
				let blurredStops = 0;
				let tabPresses = 0;

				const stopHost: TabStopHost = {
					reassertFocus: () => adaptor.ensureFocusReporting(),
					visited: (index) => visited.has(index),
				};

				// Dialogs the adaptor dismissed before the first press (one the page raised as it
				// loaded, say) are nothing any tab stop did.
				adaptor.takeDismissedDialogs?.();

				while (attached.size > 0) {
					pairByStop.current = null;
					screenshotByStop.current = null;
					attributedShotByStop.current = null;
					lastHasAttributed = false;

					if (
						tabPresses >= maxTabPresses ||
						(maxDuration > 0 && performance.now() - startedAt >= maxDuration)
					) {
						end("limit");
						break;
					}

					if (!(await documentHasFocus())) {
						end("lostFocus");
						break;
					}

					await adaptor.pressTab();
					tabPresses++;
					tabPressedAt = performance.now();

					if (!resolved.composed) {
						// A composed stop script waits inside the page instead, and only for as long as the
						// page takes to settle.
						await new Promise<void>((resolve) => {
							resolveSettle = resolve;
							settleTimer = setTimeout(() => {
								settleTimer = undefined;
								resolveSettle = undefined;
								resolve();
							}, screenshotSettleDelay);
						});

						if (attached.size === 0) {
							break;
						}
					}

					const wantContext = remainingHas("contextSignals");
					const stopArgs: TabStopArgs = {
						settleMs: screenshotSettleDelay,
						resumed: false,
						styleProps: wantedStyleProps(),
						markerAttr: MARKER_ATTR,
						nextMarker,
						previousIndex,
						wantContext,
						baselineHref,
						wantObscuring: remainingHas("obscuring"),
						obscurerAttr: OBSCURER_ATTR,
						obscuringRecheckDelayMs: OBSCURING_RECHECK_DELAY_MS,
						tabbableSelector: TABBABLE_SELECTOR,
						leavingLimitMs: LEAVING_LIMIT_MS,
						leavingIntervalMs: NAVIGATION_PROBE_INTERVAL_MS,
					};
					const stopRun = {
						composed: resolved.composed,
						host: stopHost,
						isDestroyed: isContextDestroyedError,
						// Every wait a composed stop script makes happens inside the page, on the page's
						// own timers and frames, which the page may have stopped (fake timers, a paused
						// clock). The host allows it the longest those waits can add up to, and a margin.
						timeoutMs:
							screenshotSettleDelay +
							(stopArgs.wantObscuring
								? OBSCURING_SETTLE_LIMIT_MS + OBSCURING_RECHECK_DELAY_MS
								: 0) +
							COMPOSED_STOP_MARGIN_MS,
					};

					let step: TabStopResult;

					try {
						try {
							step = await runComposed(adaptor, tabStopScript, stopRun, stopArgs);

							if (step.kind === "needsFocus") {
								// Another target taking the foreground clears focus emulation, and only the
								// host can re-assert it. Nothing was measured yet, so measure again.
								await adaptor.ensureFocusReporting();
								step = await runComposed(adaptor, tabStopScript, stopRun, {
									...stopArgs,
									resumed: true,
								});
							}
						} catch (error) {
							if (!(error instanceof ComposedTimeoutError)) {
								throw error;
							}

							// The page never let the script finish its wait. From here on each script is
							// its own call and every wait is the host's, which no page can hold up. The
							// press has had far longer than its settle delay by now, so it is measured
							// as it stands.
							resolved.composed = false;
							stopRun.composed = false;
							stopElement.remembered = false;

							try {
								await adaptor.evaluate(forgetStopElementScript);
							} catch {}

							step = await runComposed(adaptor, tabStopScript, stopRun, stopArgs);
						}
					} catch (error) {
						// A composed script cannot say which of its parts the navigation interrupted. It
						// reads the focused element first, so there is no element to report either way.
						if (stopRun.composed && isContextDestroyedError(error)) {
							await endOnNavigation();
							break;
						}

						throw error;
					}

					if (stopRun.composed && attached.size === 0) {
						break;
					}

					// A native dialog the page raised on this press has already been dismissed by the
					// adaptor; all that is left of it is the count.
					const dialogs = adaptor.takeDismissedDialogs?.() ?? 0;
					stats.dialogsDismissed += dialogs;
					const openedDialog = dialogs > 0;

					if (step.kind === "lostFocus" || step.kind === "needsFocus") {
						end("lostFocus");
						break;
					}

					if (step.kind === "navigation") {
						await endOnNavigation();
						break;
					}

					baselineHref = step.baselineHref;

					if (step.kind === "body") {
						const blurredStop = step.blurredStop;
						const blurred = blurredStop ? blurredStop.blurred === true : false;
						const blurredIndex = blurredStop ? blurredStop.index : null;

						if (blurredIndex !== null) {
							nextMarker = Math.max(nextMarker, blurredIndex + 1);
						}

						// Focus landed on <body>. This is normally "done tabbing", but it
						// is also what F55 focus-removal looks like (an element receives
						// focus and then blurs itself, e.g. `onfocus="this.blur()"`): the
						// in-page observer's focusin history still attributes that stop to
						// the element that briefly held focus, even though nothing is
						// focused now. That case gets one last notification instead of
						// vanishing silently.
						const raw = step.raw;

						if (wantContext && raw?.hasAttributed) {
							const attributedRef = await adaptor.evaluateHandle(attributedHandleScript);

							try {
								const selector = await adaptor.evaluate(getSelector, attributedRef);

								const activeElement: ActiveElementInfo = {
									index: null,
									isBody: false,
									isIframe: false,
									selector,
									html: truncateHtml(raw.attributedHtml ?? ""),
									styles: { element: {}, before: {}, after: {} },
									rect: { x: 0, y: 0, width: 0, height: 0 },
								};

								const contextSignals = toContextDrain(
									raw,
									openedDialog,
									{ selector, html: activeElement.html },
									step.formSelector ?? null,
								);

								mergeCarried(contextSignals, carried);
								carried = {};

								const snapshot: TabStopSnapshot = {
									tabIndex: ++stats.tabStops,
									activeElement,
									contextSignals,
								};

								lastStop = { selector, html: activeElement.html };

								// This synthetic stop has no live focused element (it
								// already blurred itself before this notification is
								// built, by definition of F55), so capabilities that
								// need one (`unfocusedPair`, `baselineStyles`,
								// `obscuring`) have nothing to meaningfully act on.
								// Only consumers that declared `contextSignals` (the
								// capability this whole synthetic-stop mechanism exists
								// to serve) are notified; unlike every other stop in
								// this file, uniform notification is wrong here because
								// there is no element for the other capabilities to
								// read from.
								const recipients = [...attached].filter((consumer) =>
									consumer.capabilities.has("contextSignals"),
								);

								// The blurred element is still in the page, so a
								// `screenshot` declarer can capture it.
								stopElement.ref = attributedRef;
								stopElement.active = true;

								for (const consumer of recipients) {
									await notify(consumer, () => consumer.onTabStop(snapshot, handleFor(consumer)));
								}
							} finally {
								// Guaranteed even if a recipient's onTabStop throws, so the
								// `data-a11y-ctx-attr` DOM marker never survives past this stop.
								stopElement.ref ??= attributedRef;
								await adaptor.evaluate(clearAttributedScript);
								await releaseStopElement();
							}
						} else if (wantContext && raw) {
							// Nobody is notified of this stop, so what the drain had to say about earlier
							// stops, or about no stop at all, waits for the next notification.
							const waiting: Pick<ContextChangeDrain, "late" | "unattributed"> = {};

							mergeCarried(waiting, toCarriedContext(raw, openedDialog));
							mergeCarried(waiting, carried);
							carried = waiting;
						}

						if (blurred) {
							if (blurredIndex !== null && visited.has(blurredIndex)) {
								end("completed", blurredIndex);
								break;
							}

							if (++blurredStops > MAX_BLURRED_STOPS) {
								end("stuck");
								break;
							}

							if (blurredIndex !== null) {
								visited.add(blurredIndex);
							}

							previousIndex = null;

							continue;
						}

						end("completed");
						break;
					}

					blurredStops = 0;

					if (step.kind === "iframe") {
						previousIndex = null;

						if (++iframeStops > MAX_IFRAME_STOPS) {
							const frame = await adaptor.evaluateHandle(activeElementHandleScript);

							try {
								end("stuck", null, {
									selector: await adaptor.evaluate(getSelector, frame),
									html: truncateHtml(step.html),
								});
							} finally {
								await adaptor.disposeRef(frame);
							}

							break;
						}

						continue;
					}

					iframeStops = 0;
					nextMarker = Math.max(nextMarker, step.index + 1);

					if (step.kind === "held") {
						const held = step.held;

						// Focus going nowhere with nothing after it is the end of the tab order in
						// browsers that keep focus on the last element rather than leaving the page.
						if (!held.prevented && !held.followed) {
							end("completed");
							break;
						}

						// The page holding on to focus is a cycle of one. Otherwise focus is moving between
						// a control's own parts (media player buttons, the fields of a date input), unless
						// it never comes out.
						if (held.prevented || ++internalStops > MAX_INTERNAL_STOPS) {
							end("completed", step.index);
							break;
						}

						continue;
					}

					previousIndex = step.index;
					internalStops = 0;

					// A composed script cannot consult the host's record of where it has been, so there a
					// revisit comes back measured like any other stop.
					if (step.kind === "revisit" || visited.has(step.index)) {
						// Focus is back on an element already visited, which ends the session. If it got
						// there because the element this press reached threw it back, that element is
						// not a stop of its own and this is the only chance to report it.
						if (wantContext) {
							try {
								let raw: DrainContextObserverResult | null = null;
								let base: ActiveElementBase | null = null;
								let selector: string | null = null;
								let attributedSelector: string | null = null;
								let formSelector: string | null = null;

								if (step.kind === "stop") {
									raw = step.drainDestroyed ? null : step.raw;
									base = step.base;
									selector = step.selector;
									attributedSelector = step.attributedSelector ?? null;
									formSelector = step.formSelector ?? null;
								} else {
									raw = (await adaptor.evaluate(drainContextObserverScript, MARKER_ATTR)) ?? null;
								}

								if (raw !== null && !raw.hasAttributed) {
									const waiting: Pick<ContextChangeDrain, "late" | "unattributed"> = {};

									mergeCarried(waiting, toCarriedContext(raw, openedDialog));
									mergeCarried(waiting, carried);
									carried = waiting;
								} else if (raw !== null) {
									if (step.kind !== "stop") {
										const attributedRef = await adaptor.evaluateHandle(attributedHandleScript);

										try {
											attributedSelector = await adaptor.evaluate(getSelector, attributedRef);
										} finally {
											await adaptor.disposeRef(attributedRef);
										}

										const activeRef = await adaptor.evaluateHandle(activeElementHandleScript);

										stopElement.ref = activeRef;
										selector = await adaptor.evaluate(getSelector, activeRef);
										base =
											(await adaptor.evaluate(probeActiveElementScript, [], MARKER_ATTR)) ?? null;
									} else {
										stopElement.ref = step.ref ?? undefined;
									}

									if (base !== null && selector !== null && attributedSelector !== null) {
										const contextSignals = toContextDrain(
											raw,
											openedDialog,
											{
												selector: attributedSelector,
												html: truncateHtml(raw.attributedHtml ?? ""),
											},
											formSelector,
										);

										mergeCarried(contextSignals, carried);
										carried = {};

										const snapshot: TabStopSnapshot = {
											tabIndex: ++stats.tabStops,
											activeElement: {
												...base,
												index: step.index,
												html: truncateHtml(base.html),
												selector,
											},
											contextSignals,
										};

										stopElement.pending = null;
										stopElement.active = true;

										// As for an element that dropped focus altogether: only the consumers
										// this notification exists for are told, since the element focus is on
										// has been a stop already.
										for (const consumer of [...attached].filter((candidate) =>
											candidate.capabilities.has("contextSignals"),
										)) {
											await notify(consumer, () =>
												consumer.onTabStop(snapshot, handleFor(consumer)),
											);
										}
									}
								}
							} catch (error) {
								if (!isContextDestroyedError(error)) {
									throw error;
								}
							} finally {
								try {
									await adaptor.evaluate(clearAttributedScript);
								} catch {}

								await releaseStopElement();
							}
						}

						end("completed", step.index);
						break;
					}

					visited.add(step.index);

					stopElement.ref = step.ref ?? undefined;
					stopElement.pending = null;
					stopElement.remembered = step.ref === null;
					stopElement.active = true;

					try {
						const activeElement: ActiveElementInfo = {
							...step.base,
							index: step.index,
							html: truncateHtml(step.base.html),
							selector: step.selector,
						};

						const snapshot: TabStopSnapshot = {
							tabIndex: ++stats.tabStops,
							activeElement,
						};

						if (remainingHas("baselineStyles") && activeElement.index !== null) {
							const baselineStyles = interned.get(activeElement.index);

							if (baselineStyles !== undefined) {
								snapshot.baselineStyles = baselineStyles;
							}
						}

						if (wantContext) {
							const raw = step.raw;

							if (raw !== null && !step.drainDestroyed) {
								snapshot.contextSignals = toContextDrain(
									raw,
									openedDialog,
									step.attributedSelector !== null && step.attributedSelector !== undefined
										? {
												selector: step.attributedSelector,
												html: truncateHtml(raw.attributedHtml ?? ""),
											}
										: null,
									step.formSelector ?? null,
								);
								mergeCarried(snapshot.contextSignals, carried);
								carried = {};
								lastHasAttributed = raw.hasAttributed;
							} else {
								// The page navigated out from under the drain call: the
								// in-page observer's own state (and any DOM markers it
								// set) went with it, so there is nothing left to report
								// besides the navigation itself.
								const signals: ContextChangeSignals = {
									openedWindow: false,
									submittedForm: false,
									focusRemoved: false,
									redirect: null,
									softUrlChange: false,
									navigation: step.drainDestroyed,
									openedDialog,
								};
								snapshot.contextSignals = { signals };
								lastHasAttributed = false;
							}
						}

						lastStop = { selector: activeElement.selector, html: activeElement.html };

						if (step.obscuring !== null) {
							snapshot.obscuring = toObscuredMeasurement(
								step.obscuring,
								step.obscuring.obscurerSelector,
							);
						}

						const recipients = [...attached];

						for (const consumer of recipients) {
							await notify(consumer, () => consumer.onTabStop(snapshot, handleFor(consumer)));
						}

						if (snapshot.contextSignals?.signals.navigation) {
							navigationShown = true;
							end("navigation");
							break;
						}
					} finally {
						try {
							if (pairByStop.current !== null) {
								await pairByStop.current;

								if (contextSignalsWanted) {
									// ensureUnfocusedPair blurred and re-focused the element to
									// capture the unfocused screenshot; drop that noise so the
									// next drain doesn't misread it as a real focus-removal or
									// redirect.
									await adaptor.evaluate(clearContextFocusInsScript);

									if (lastHasAttributed) {
										await adaptor.evaluate(clearAttributedScript);
									}
								}
							}
						} catch {
							// Capture errors already surface through the consumer that
							// awaited; still dispose the handle below.
						}

						await releaseStopElement();
					}
				}
			} catch (error) {
				// A navigation can pull the document out from under any call in the loop, not only the
				// ones that check for it. If the page answers again afterwards from a document without
				// the tab observer, that is what happened; a closed page never answers.
				if (isContextDestroyedError(error) && (await documentWasReplaced())) {
					await endOnNavigation();
				} else {
					failure = error;
				}
			} finally {
				// Consumers hear of the end before the page is torn down, as they always have, and
				// after the context observer has been read for the last time.
				try {
					await flushContext();
				} catch {}

				deliverEnd();

				// One step throwing cannot skip the others or replace the loop error: the script
				// isolates each of them, and a script that cannot run at all is ignored here.
				try {
					await runComposed(
						adaptor,
						sessionEndScript,
						{ composed: resolved.composed },
						{ markerAttr: MARKER_ATTR, wantContext: contextSignalsWanted },
					);
				} catch {}

				stopDismissingDialogs?.();
			}

			if (failure !== undefined) {
				end("failed");
				deliverEnd();
				throw failure;
			}

			stats.durationMs = performance.now() - startedAt;

			const consumerFailure = failures[0];

			if (consumerFailure !== undefined) {
				stats.endReason ??= "failed";
				throw consumerFailure.error;
			}

			return stats;
		},
	};
}
