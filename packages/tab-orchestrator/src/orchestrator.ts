import type { BrowserAdaptor } from "./adaptor";
import {
	activeElementHandleScript,
	baselineScript,
	clearMarkersScript,
	probeActiveElementScript,
} from "./browser-scripts";
import { FOCUS_STYLE_PROPERTIES } from "./focus-style";
import { getSelector } from "./get-selector";
import { truncateHtml } from "./truncate-html";
import type {
	ActiveElementInfo,
	SessionEndReason,
	StyleSnapshot,
	TabConsumer,
	TabSessionHandle,
	TabStopSnapshot,
} from "./types";

export const DEFAULT_SCREENSHOT_SETTLE_DELAY = 33;
export const DEFAULT_SCREENSHOT_CLIP_BUFFER = 10;
export const DEFAULT_MARKER_LIMIT = 1024;
export const MARKER_ATTR = "data-a11y-focus-idx";

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
			const markerLimit = Math.max(
				options.markerLimit ?? DEFAULT_MARKER_LIMIT,
				options.baselineElementLimit ?? 0,
			);
			const styleProps = [...FOCUS_STYLE_PROPERTIES];

			let settleTimer: ReturnType<typeof setTimeout> | undefined;
			let resolveSettle: (() => void) | undefined;

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
				async ensureUnfocusedPair() {
					if (!consumer.capabilities.has("unfocusedPair")) {
						throw new Error("Consumer did not declare unfocusedPair");
					}
					throw new Error("unfocusedPair capture not implemented");
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

				for (const consumer of [...attached]) {
					await consumer.onSessionStart?.(handleFor(consumer));
				}

				const visited = new Set<number>();
				let tabIndex = 0;

				while (attached.size > 0) {
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
					let selector = "";
					try {
						selector = await adaptor.evaluate(getSelector, ref);
					} finally {
						await adaptor.disposeRef(ref);
					}

					const activeElement: ActiveElementInfo = {
						...base,
						html: truncateHtml(base.html),
						selector,
					};

					const snapshot: TabStopSnapshot = {
						tabIndex: ++tabIndex,
						activeElement,
					};

					const wantsBaseline = [...attached].some((consumer) =>
						consumer.capabilities.has("baselineStyles"),
					);
					if (wantsBaseline && activeElement.index !== null) {
						const baselineStyles = interned.get(activeElement.index);
						if (baselineStyles !== undefined) {
							snapshot.baselineStyles = baselineStyles;
						}
					}

					const recipients = [...attached];
					for (const consumer of recipients) {
						await consumer.onTabStop(snapshot, handleFor(consumer));
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
