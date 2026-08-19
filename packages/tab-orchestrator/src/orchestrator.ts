import type { BrowserAdaptor, ElementRef } from "./adaptor";
import {
	activeElementHandleScript,
	baselineScript,
	clearAttributedScript,
	clearContextFocusInsScript,
	clearMarkersScript,
	clearObscurerScript,
	drainContextObserverScript,
	installContextObserverScript,
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

const EMPTY_CONTEXT_SIGNALS: ContextChangeSignals = {
	openedWindow: false,
	submittedForm: false,
	focusRemoved: false,
	redirect: null,
	softUrlChange: false,
	navigation: false,
};

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

					const base = await adaptor.evaluate(
						probeActiveElementScript,
						styleProps,
						MARKER_ATTR,
					);
					if (base === null || base.isBody) {
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
								const raw = await adaptor.evaluate(
									drainContextObserverScript,
									MARKER_ATTR,
								);
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
								signals = { ...EMPTY_CONTEXT_SIGNALS, navigation: true };
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
