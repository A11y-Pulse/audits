import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { getSelector } from "@a11y-pulse/browser-adaptor/dom";
import {
	type BaseAuditOptions,
	captureContextScreenshot,
	clearObscurerScript,
	createAuditSelfDisconnect,
	createTabOrchestrator,
	DEFAULT_ELEMENT_LIMIT,
	DEFAULT_FAILED_ELEMENT_LIMIT,
	DEFAULT_SCREENSHOT_SETTLE_DELAY,
	DEFAULT_TIMEOUT,
	type MeasureObscuringResult,
	measureObscuringScript,
	OBSCURER_ATTR,
	OBSCURING_RECHECK_DELAY_MS,
	obscurerHandleScript,
	resetFocusStartScript,
	type TabConsumer,
	toObscuredMeasurement,
} from "@a11y-pulse/tab-orchestrator";
import {
	hasTopPinnedContentScript,
	restoreScrollScript,
	scrolledElementScript,
	scrollToTopEdgeScript,
} from "./browser-scripts";
import { classifyObscuring } from "./classify";
import type { FocusNotObscuredElementResult, FocusNotObscuredResult } from "./result";

export const DEFAULT_SCREENSHOT_LIMIT = 10;

export const DEFAULT_SCROLLED_TO_TOP_LIMIT = 10;

export type FocusNotObscuredOptions = BaseAuditOptions & {
	/**
	 * Max obscured/incomplete elements to screenshot (each is a real page.screenshot() call).
	 * Defaults to 10.
	 */
	screenshotLimit?: number;

	/**
	 * Max elements to re-measure after scrolling each to the top edge of the viewport, which is
	 * what finds elements hidden under a sticky header. Spread evenly over the elements that passed.
	 * Only runs on a page that has content pinned to the top. Defaults to 10; 0 turns the check off.
	 */
	scrolledToTopLimit?: number;
};

type ResolvedOptions = Required<FocusNotObscuredOptions>;

function resolveOptions(options: FocusNotObscuredOptions): ResolvedOptions {
	return {
		elementLimit: options.elementLimit ?? DEFAULT_ELEMENT_LIMIT,
		screenshotSettleDelay: options.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
		failedElementLimit: options.failedElementLimit ?? DEFAULT_FAILED_ELEMENT_LIMIT,
		timeout: options.timeout ?? DEFAULT_TIMEOUT,
		screenshotLimit: options.screenshotLimit ?? DEFAULT_SCREENSHOT_LIMIT,
		scrolledToTopLimit: options.scrolledToTopLimit ?? DEFAULT_SCROLLED_TO_TOP_LIMIT,
	};
}

function emptyResult(): FocusNotObscuredResult {
	return {
		elements: [],
		summary: {
			checked: 0,
			passed: 0,
			failed: 0,
			reachedLimit: false,
			reachedFailedElementLimit: false,
			timedOut: false,
			sessionEnd: null,
			scrolledToTopChecked: 0,
		},
	};
}

function recount(result: FocusNotObscuredResult): void {
	const failed = result.elements.filter((element) => element.bucket === "violation").length;
	result.summary.checked = result.elements.length;
	result.summary.failed = failed;
	result.summary.passed = result.elements.length - failed;
}

/** At most `limit` of `items`, spread evenly from the first to the last. */
function spread<T>(items: T[], limit: number): T[] {
	if (items.length <= limit) {
		return items;
	}

	if (limit === 1) {
		return items.slice(0, 1);
	}

	const picked = new Set<T>();

	for (let i = 0; i < limit; i++) {
		picked.add(items[Math.round((i * (items.length - 1)) / (limit - 1))] as T);
	}

	return [...picked];
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export type FocusNotObscuredAudit = TabConsumer & {
	result: FocusNotObscuredResult;

	/**
	 * Re-measure a sample of the elements that passed, each scrolled to the top edge of the
	 * viewport. Tabbing forwards leaves an element in the middle or at the bottom of the viewport,
	 * so the tab pass alone never puts one under a sticky header; moving focus up the page does.
	 * Run it once the tab session has ended, on the same page. An element found hidden this way
	 * becomes a violation with `foundBy: "scrolled-to-top"`. Scroll positions are put back.
	 */
	checkScrolledToTop(adaptor: BrowserAdaptor): Promise<void>;
};

/**
 * Tab through focusable elements and report whether each is entirely hidden behind other content
 * (WCAG 2.4.11 Focus Not Obscured (Minimum)). Attach to a `createTabOrchestrator` session, or use
 * `runFocusNotObscuredAudit` to run as the sole consumer.
 */
export function createFocusNotObscuredAudit(
	options: FocusNotObscuredOptions = {},
): FocusNotObscuredAudit {
	const resolved = resolveOptions(options);
	const result = emptyResult();
	let checked = 0;
	let failures = 0;
	let screenshotsTaken = 0;
	const selfDisconnect = createAuditSelfDisconnect();
	/** Elements on fixed or sticky content, which scrolling cannot move under anything. */
	const pinned = new WeakSet<FocusNotObscuredElementResult>();

	const measureScrolled = async (
		adaptor: BrowserAdaptor,
		element: FocusNotObscuredElementResult,
	): Promise<void> => {
		if (!(await adaptor.evaluate(scrollToTopEdgeScript, element.selector))) {
			return;
		}

		const handle = await adaptor.evaluateHandle(scrolledElementScript);

		try {
			result.summary.scrolledToTopChecked++;

			let measured: MeasureObscuringResult = await adaptor.evaluate(
				measureObscuringScript,
				handle,
				OBSCURER_ATTR,
			);

			// A header that hides itself as the page scrolls down gets the time to do so.
			if (measured.fullyObscured && measured.opacity !== "semi-transparent") {
				await sleep(OBSCURING_RECHECK_DELAY_MS);
				measured = await adaptor.evaluate(measureObscuringScript, handle, OBSCURER_ATTR);
			}

			let coverSelector: string | null = null;

			if (measured.hasObscurer) {
				const cover = await adaptor.evaluateHandle(obscurerHandleScript);

				try {
					coverSelector = await adaptor.evaluate(getSelector, cover);
				} finally {
					await adaptor.disposeRef(cover);
				}

				await adaptor.evaluate(clearObscurerScript, OBSCURER_ATTR);
			}

			const measurement = toObscuredMeasurement(measured, coverSelector);
			const bucket = classifyObscuring(measurement);

			// Only a cover is news here: the tab pass already measured the element where it was.
			if (bucket === "pass" || !measurement.fullyObscured) {
				return;
			}

			element.bucket = bucket;
			element.measurement = measurement;
			element.foundBy = "scrolled-to-top";

			if (screenshotsTaken < resolved.screenshotLimit) {
				element.screenshot = await captureContextScreenshot(adaptor, handle);
				screenshotsTaken++;
			}
		} finally {
			await adaptor.disposeRef(handle);
			await adaptor.evaluate(restoreScrollScript);
		}
	};

	return {
		result,
		async checkScrolledToTop(adaptor) {
			if (resolved.scrolledToTopLimit <= 0) {
				return;
			}

			const candidates = result.elements.filter(
				(element) =>
					element.bucket === "pass" &&
					!element.measurement.offscreen &&
					!element.measurement.notPainted &&
					!pinned.has(element),
			);

			if (candidates.length === 0 || !(await adaptor.evaluate(hasTopPinnedContentScript))) {
				return;
			}

			try {
				for (const element of spread(candidates, resolved.scrolledToTopLimit)) {
					await measureScrolled(adaptor, element);
				}
			} finally {
				recount(result);
				// Scrolling moves where the browser starts tabbing from. Put that back at the top, as the
				// tab session left it, for whatever runs on this page next.
				await adaptor.evaluate(resetFocusStartScript);
			}
		},
		capabilities: new Set(["obscuring", "screenshot"] as const),
		onSessionStart(session) {
			selfDisconnect.armTimeout(resolved.timeout, session, () => {
				result.summary.timedOut = true;
			});
		},
		async onTabStop(snapshot, session) {
			checked++;

			const measurement = snapshot.obscuring;

			if (measurement === undefined) {
				// Should not happen: this consumer declares the "obscuring" capability, so the orchestrator
				// always populates it.
				return;
			}

			const bucket = classifyObscuring(measurement);

			// Pass elements need no evidence; only screenshot the elements that are actually worth a
			// human looking at, and only up to the limit, since each capture is a real page.screenshot()
			// call.
			// The capture is a strip of the viewport with the element's box outlined: a clip of the
			// element alone would show nothing but whatever covers it.
			const screenshot =
				bucket !== "pass" && screenshotsTaken < resolved.screenshotLimit
					? await (session.screenshotContext?.() ?? session.screenshotClip())
					: undefined;

			if (screenshot) {
				screenshotsTaken++;
			}

			const element: FocusNotObscuredElementResult = {
				selector: snapshot.activeElement.selector,
				html: snapshot.activeElement.html,
				tabIndex: snapshot.tabIndex,
				measurement,
				bucket,
				screenshot,
			};

			if (snapshot.activeElement.pinned) {
				pinned.add(element);
			}

			result.elements.push(element);

			if (bucket === "violation") {
				failures++;
			}

			recount(result);

			if (resolved.failedElementLimit > 0 && failures >= resolved.failedElementLimit) {
				result.summary.reachedFailedElementLimit = true;
				selfDisconnect.disconnect(session);

				return;
			}

			if (checked >= resolved.elementLimit) {
				result.summary.reachedLimit = true;
				selfDisconnect.disconnect(session);
			}
		},
		onSessionEnd(reason) {
			selfDisconnect.clear();

			if (!selfDisconnect.disconnectedSelf) {
				result.summary.sessionEnd = reason;
			}
		},
	};
}

/**
 * Tab through focusable elements and report whether each is entirely hidden behind other content.
 * Builds a private tab session, drives the loop, and hands back this consumer's result.
 */
export async function runFocusNotObscuredAudit(
	adaptor: BrowserAdaptor,
	options: FocusNotObscuredOptions = {},
): Promise<FocusNotObscuredResult> {
	const resolved = resolveOptions(options);
	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: resolved.screenshotSettleDelay,
		markerLimit: resolved.elementLimit,
	});
	const audit = createFocusNotObscuredAudit(options);
	orchestrator.attach(audit);
	await orchestrator.run();
	await audit.checkScrolledToTop(adaptor);

	return audit.result;
}
