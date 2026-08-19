import type { BrowserAdaptor, ElementRef } from "./adaptor";
import {
	type ActiveElementBase,
	activeElementHandleScript,
	attributedHandleScript,
	baselineScript,
	clearAttributedScript,
	clearContextFocusInsScript,
	clearMarkersScript,
	clearObscurerScript,
	type DrainContextObserverResult,
	drainContextObserverScript,
	installContextObserverScript,
	locationHrefScript,
	measureObscuringScript,
	obscurerHandleScript,
	probeActiveElementScript,
} from "./browser-scripts";
import { FOCUS_STYLE_PROPERTIES } from "./focus-style";
import { getSelector } from "./get-selector";
import { truncateHtml } from "./truncate-html";
import type {
	ActiveElementInfo,
	Capability,
	ContextChangeSignals,
	SessionEndReason,
	StyleSnapshot,
	TabConsumer,
	TabSessionHandle,
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
function isContextDestroyedError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return /Execution context was destroyed|Target closed|frame was detached|navigat/i.test(
		message,
	);
}

/**
 * Outcome of the early, pre-isBody navigation check. `navigation: true`
 * means a full navigation was detected (via href diff or a destroyed-context
 * error) and the caller must end the session without proceeding any
 * further. Otherwise `raw` carries a drain payload already fetched while
 * resolving a soft URL change (so the later full drain can reuse it instead
 * of reading back state the first call already reset), or `null` when the
 * href was unchanged and nothing has been drained yet for this stop.
 */
type ContextNavigationOutcome =
	| { navigation: true }
	| { navigation: false; raw: DrainContextObserverResult | null };

export const DEFAULT_SCREENSHOT_SETTLE_DELAY = 33;
export const DEFAULT_SCREENSHOT_CLIP_BUFFER = 10;
export const DEFAULT_MARKER_LIMIT = 1024;
export const MARKER_ATTR = "data-a11y-focus-idx";
export const OBSCURER_ATTR = "data-a11y-obscurer";

export type TabSessionOptions = {
	screenshotSettleDelay?: number;
	screenshotClipBuffer?: number;
	markerLimit?: number;
	baselineElementLimit?: number;
};

export type TabOrchestrator = {
	attach(consumer: TabConsumer): void;
	run(): Promise<void>;
};

export function createTabOrchestrator(
	adaptor: BrowserAdaptor,
	options: TabSessionOptions = {},
): TabOrchestrator {
	const consumers: TabConsumer[] = [];
	let started = false;
	let ran = false;

	return {
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

			if (consumers.length === 0) {
				return;
			}

			const attached = new Set(consumers);
			const screenshotSettleDelay =
				options.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY;
			const screenshotClipBuffer =
				options.screenshotClipBuffer ?? DEFAULT_SCREENSHOT_CLIP_BUFFER;
			const markerLimit = Math.max(
				options.markerLimit ?? DEFAULT_MARKER_LIMIT,
				options.baselineElementLimit ?? 0,
			);
			const styleProps = [...FOCUS_STYLE_PROPERTIES];
			const resolved = {
				screenshotSettleDelay,
				screenshotClipBuffer,
				styleProps,
			};

			let settleTimer: ReturnType<typeof setTimeout> | undefined;
			let resolveSettle: (() => void) | undefined;
			const pairByStop = { current: null as Promise<UnfocusedPair> | null };
			let activeHandle: ElementRef | undefined;
			let lastHasAttributed = false;
			// Captured when observers are installed and re-armed after every
			// detected soft URL change, so repeated soft navigations across stops
			// compare against the most recent href rather than the original load.
			let baselineHref: string | null = null;

			const remainingHas = (capability: Capability): boolean =>
				[...attached].some((c) => c.capabilities.has(capability));

			// Decided once from who is attached at session start; never re-checked,
			// so the observer stays installed even after every declarer disconnects
			// (session-lifetime setup is never uninstalled, only skipped per-stop).
			const contextSignalsWanted = remainingHas("contextSignals");

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
					if (activeHandle === undefined) {
						throw new Error("unfocusedPair capture not implemented");
					}
					pairByStop.current ??= captureUnfocusedPair(
						adaptor,
						resolved,
						activeHandle,
					);
					return pairByStop.current;
				},
			});

			const end = (reason: SessionEndReason): void => {
				for (const consumer of attached) {
					consumer.onSessionEnd?.(reason);
				}
				attached.clear();
			};

			/**
			 * Primary navigation detection layer: compares `location.href` against
			 * `baselineHref` on every stop, since a full navigation destroys the
			 * in-page observer's execution context before it can self-report
			 * anything (`drainContextObserverScript`'s own `navigation` field is
			 * always `false`). A destroyed context can also simply throw instead
			 * of returning a changed href (e.g. the navigation completes between
			 * the href read and the drain read), which is treated the same way.
			 *
			 * Must run before the caller's `isBody`/"done tabbing" exit check: a
			 * freshly-navigated page's `document.activeElement` defaults to
			 * `document.body` unless the new page autofocuses something, so
			 * without this proactive check a silent navigation would otherwise be
			 * misclassified as `"completed"`.
			 *
			 * Deliberately cheap on the common (non-navigating) path: it only
			 * reads `location.href` and does not call `drainContextObserverScript`
			 * unless the href actually changed, so a stop that ends the session
			 * via the isBody exit right after this check still drains at most
			 * once overall (at the later, full-mapping call site).
			 */
			async function checkContextNavigation(): Promise<ContextNavigationOutcome> {
				let href: string;
				try {
					href = await adaptor.evaluate(locationHrefScript);
				} catch (error) {
					if (!isContextDestroyedError(error)) {
						throw error;
					}
					return { navigation: true };
				}

				if (baselineHref === null || href === baselineHref) {
					return { navigation: false, raw: null };
				}

				// Document navigated (or soft URL change). Prefer the observer's
				// own soft-nav flag when the execution context survived;
				// otherwise treat it as a full navigation.
				let raw: DrainContextObserverResult | null = null;
				try {
					raw = await adaptor.evaluate(drainContextObserverScript, MARKER_ATTR);
				} catch {
					raw = null;
				}

				if (raw === null || !raw.softUrlChange) {
					return { navigation: true };
				}

				baselineHref = href;
				return { navigation: false, raw };
			}

			let failure: unknown;
			try {
				await adaptor.ensureFocusReporting();

				const payload = await adaptor.evaluate(
					baselineScript,
					styleProps,
					MARKER_ATTR,
					markerLimit,
				);
				const interned = new Map<number, StyleSnapshot>();
				for (const entry of payload.entries) {
					const styles = payload.styles[entry.styleIndex];
					if (styles !== undefined) {
						interned.set(entry.index, styles);
					}
				}

				if (contextSignalsWanted) {
					baselineHref = await adaptor.evaluate(locationHrefScript);
					await adaptor.evaluate(installContextObserverScript);
				}

				for (const consumer of [...attached]) {
					await consumer.onSessionStart?.(handleFor(consumer));
				}

				const visited = new Set<number>();
				let tabIndex = 0;

				while (attached.size > 0) {
					pairByStop.current = null;
					lastHasAttributed = false;

					const hasFocus = await adaptor.evaluate(() => document.hasFocus());
					if (!hasFocus) {
						end("lostFocus");
						break;
					}

					await adaptor.pressTab();
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

					let base: ActiveElementBase | null;
					try {
						base = await adaptor.evaluate(
							probeActiveElementScript,
							styleProps,
							MARKER_ATTR,
						);
					} catch (error) {
						if (
							remainingHas("contextSignals") &&
							isContextDestroyedError(error)
						) {
							// Mid-flight navigation destroyed the execution context
							// before the probe could even run: there is no active
							// element to report, so end directly (mirrors the
							// isBody/"done tabbing" exit below, which also ends
							// without a snapshot when there is nothing to notify).
							end("navigation");
							break;
						}
						throw error;
					}

					// Primary navigation detection layer, run before the isBody exit:
					// a silently-navigated page's evaluate() calls succeed against the
					// new document (Puppeteer/CDP targets whichever context is live at
					// call time), so a hard nav can surface as an ordinary `isBody: true`
					// probe result with no thrown error at all.
					let contextNav: ContextNavigationOutcome | null = null;
					if (remainingHas("contextSignals")) {
						const outcome = await checkContextNavigation();
						if (outcome.navigation) {
							end("navigation");
							break;
						}
						contextNav = outcome;
					}

					if (base === null || base.isBody) {
						// Focus landed on <body>. This is normally "done tabbing", but it
						// is also what F55 focus-removal looks like (an element receives
						// focus and then blurs itself, e.g. `onfocus="this.blur()"`): the
						// in-page observer's focusin history still attributes that stop to
						// the element that briefly held focus, even though nothing is
						// focused now. Drain before ending so that case gets one last
						// notification instead of vanishing silently.
						if (remainingHas("contextSignals")) {
							let raw: DrainContextObserverResult;
							try {
								raw =
									contextNav?.raw ??
									(await adaptor.evaluate(
										drainContextObserverScript,
										MARKER_ATTR,
									));
							} catch (error) {
								if (!isContextDestroyedError(error)) {
									throw error;
								}
								// Mirrors the probe's own destroyed-context catch above:
								// there is no attributed element left to report, so end
								// directly with "navigation" rather than "completed" (a
								// navigation signal always ends the session that way).
								end("navigation");
								break;
							}

							if (raw.hasAttributed) {
								const attributedRef = await adaptor.evaluateHandle(
									attributedHandleScript,
								);
								let selector: string;
								try {
									selector = await adaptor.evaluate(getSelector, attributedRef);
								} finally {
									await adaptor.disposeRef(attributedRef);
								}

								const activeElement: ActiveElementInfo = {
									index: null,
									isBody: false,
									isIframe: false,
									selector,
									html: truncateHtml(raw.attributedHtml ?? ""),
									styles: { element: {}, before: {}, after: {} },
									rect: { x: 0, y: 0, width: 0, height: 0 },
								};

								const snapshot: TabStopSnapshot = {
									tabIndex: ++tabIndex,
									activeElement,
									contextSignals: {
										signals: {
											openedWindow: raw.openedWindow,
											submittedForm: raw.submittedForm,
											focusRemoved: raw.focusRemoved,
											redirect: raw.redirect,
											softUrlChange: raw.softUrlChange,
											navigation: raw.navigation,
										},
									},
								};

								const recipients = [...attached];
								for (const consumer of recipients) {
									await consumer.onTabStop(snapshot, handleFor(consumer));
								}

								await adaptor.evaluate(clearAttributedScript);
							}
						}

						end("completed");
						break;
					}

					if (base.isIframe) {
						continue;
					}

					if (base.index !== null) {
						if (visited.has(base.index)) {
							end("completed");
							break;
						}
						visited.add(base.index);
					}

					const ref = await adaptor.evaluateHandle(activeElementHandleScript);
					activeHandle = ref;
					try {
						const selector = await adaptor.evaluate(getSelector, ref);

						const activeElement: ActiveElementInfo = {
							...base,
							html: truncateHtml(base.html),
							selector,
						};

						const snapshot: TabStopSnapshot = {
							tabIndex: ++tabIndex,
							activeElement,
						};

						if (
							remainingHas("baselineStyles") &&
							activeElement.index !== null
						) {
							const baselineStyles = interned.get(activeElement.index);
							if (baselineStyles !== undefined) {
								snapshot.baselineStyles = baselineStyles;
							}
						}

						if (remainingHas("contextSignals")) {
							let signals: ContextChangeSignals;
							try {
								// Reuse the drain already fetched above while resolving
								// a soft URL change (checkContextNavigation), if any;
								// re-draining here would read back state that call
								// already reset (focusIns, softUrlChange, etc.) and
								// silently lose whatever it was reporting. Otherwise
								// (the common case: href unchanged, nothing drained
								// yet) do the one drain this stop needs.
								const raw =
									contextNav?.raw ??
									(await adaptor.evaluate(
										drainContextObserverScript,
										MARKER_ATTR,
									));
								signals = {
									openedWindow: raw.openedWindow,
									submittedForm: raw.submittedForm,
									focusRemoved: raw.focusRemoved,
									redirect: raw.redirect,
									softUrlChange: raw.softUrlChange,
									navigation: raw.navigation,
								};
								lastHasAttributed = raw.hasAttributed;
							} catch (error) {
								if (!isContextDestroyedError(error)) {
									throw error;
								}
								// The page navigated out from under the drain call: the
								// in-page observer's own state (and any DOM markers it
								// set) went with it, so there is nothing left to report
								// besides the navigation itself.
								signals = {
									openedWindow: false,
									submittedForm: false,
									focusRemoved: false,
									redirect: null,
									softUrlChange: false,
									navigation: true,
								};
								lastHasAttributed = false;
							}

							snapshot.contextSignals = { signals };
						}

						if (remainingHas("obscuring")) {
							let raw = await adaptor.evaluate(
								measureObscuringScript,
								ref,
								OBSCURER_ATTR,
							);
							if (raw.fullyObscured) {
								await new Promise((resolve) => setTimeout(resolve, 250));
								raw = await adaptor.evaluate(
									measureObscuringScript,
									ref,
									OBSCURER_ATTR,
								);
							}

							let obscuredBy: { selector: string; html: string } | null = null;
							if (raw.hasObscurer) {
								const obscurer =
									await adaptor.evaluateHandle(obscurerHandleScript);
								try {
									const obscurerSelector = await adaptor.evaluate(
										getSelector,
										obscurer,
									);
									obscuredBy = {
										selector: obscurerSelector,
										html: truncateHtml(raw.obscuredByHtml ?? ""),
									};
								} finally {
									await adaptor.disposeRef(obscurer);
								}
							}

							snapshot.obscuring = {
								coveredFraction: raw.coveredFraction,
								fullyObscured: raw.fullyObscured,
								offscreen: raw.offscreen,
								opacity: raw.opacity,
								obscuredBy,
							};

							await adaptor.evaluate(clearObscurerScript, OBSCURER_ATTR);
						}

						const recipients = [...attached];
						for (const consumer of recipients) {
							await consumer.onTabStop(snapshot, handleFor(consumer));
						}

						if (snapshot.contextSignals?.signals.navigation) {
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
						activeHandle = undefined;
						await adaptor.disposeRef(ref);
					}
				}
			} catch (error) {
				failure = error;
			} finally {
				try {
					await adaptor.evaluate(clearMarkersScript, MARKER_ATTR);
				} catch {
					// Isolate teardown so a marker-clear throw cannot replace the loop error.
				}
			}

			if (failure !== undefined) {
				end("failed");
				throw failure;
			}
		},
	};
}
