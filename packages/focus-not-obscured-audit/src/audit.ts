import {
	type BrowserAdaptor,
	createTabOrchestrator,
	type TabConsumer,
	type TabSessionHandle,
} from "@a11y-pulse/tab-orchestrator";
import { classifyObscuring } from "./classify";
import type { FocusNotObscuredResult } from "./result";

export const DEFAULT_ELEMENT_LIMIT = 1024;
export const DEFAULT_SCREENSHOT_SETTLE_DELAY = 33; // ~2 frames at 60fps
export const DEFAULT_FAILED_ELEMENT_LIMIT = 0; // 0 = never finish early
export const DEFAULT_TIMEOUT = 0; // 0 = no timeout

export type FocusNotObscuredOptions = {
	/** Max focusable elements to tab through */
	elementLimit?: number;

	/** How long to wait (in ms) after each Tab for the page to settle before measuring */
	screenshotSettleDelay?: number;

	/**
	 * Finish the audit early once this many elements have failed, leaving the
	 * remaining elements unchecked. Useful as a fail-fast signal when you only
	 * need to know that a page has focus problems, not their full extent. 0
	 * (the default) means no early finish.
	 */
	failedElementLimit?: number;

	/**
	 * Limit how long (in ms) the audit runs before returning the results it has
	 * gathered so far.
	 */
	timeout?: number;
};

type ResolvedOptions = Required<FocusNotObscuredOptions>;

function resolveOptions(options: FocusNotObscuredOptions): ResolvedOptions {
	return {
		elementLimit: options.elementLimit ?? DEFAULT_ELEMENT_LIMIT,
		screenshotSettleDelay:
			options.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
		failedElementLimit:
			options.failedElementLimit ?? DEFAULT_FAILED_ELEMENT_LIMIT,
		timeout: options.timeout ?? DEFAULT_TIMEOUT,
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
		},
	};
}

function recount(result: FocusNotObscuredResult): void {
	const failed = result.elements.filter(
		(element) => element.bucket === "violation",
	).length;
	result.summary.checked = result.elements.length;
	result.summary.failed = failed;
	result.summary.passed = result.elements.length - failed;
}

/**
 * Tab through focusable elements and report whether each is entirely hidden
 * behind other content (WCAG 2.4.11 Focus Not Obscured (Minimum)). Attach to
 * a `createTabOrchestrator` session, or use `runFocusNotObscuredAudit` to run
 * as the sole consumer.
 */
export function createFocusNotObscuredAudit(
	options: FocusNotObscuredOptions = {},
): TabConsumer & { result: FocusNotObscuredResult } {
	const resolved = resolveOptions(options);
	const result = emptyResult();
	let checked = 0;
	let failures = 0;
	let timer: ReturnType<typeof setTimeout> | undefined;
	let disconnectedSelf = false;

	const clearTimer = (): void => {
		if (timer !== undefined) {
			clearTimeout(timer);
			timer = undefined;
		}
	};

	const disconnectSelf = (session: TabSessionHandle): void => {
		disconnectedSelf = true;
		clearTimer();
		session.disconnect();
	};

	return {
		result,
		capabilities: new Set(["obscuring"] as const),
		onSessionStart(session) {
			if (resolved.timeout > 0) {
				timer = setTimeout(() => {
					timer = undefined;
					result.summary.timedOut = true;
					disconnectSelf(session);
				}, resolved.timeout);
			}
		},
		onTabStop(snapshot, session) {
			checked++;

			const measurement = snapshot.obscuring;
			if (measurement === undefined) {
				// Should not happen: this consumer declares the "obscuring"
				// capability, so the orchestrator always populates it.
				return;
			}

			const bucket = classifyObscuring(measurement);

			result.elements.push({
				selector: snapshot.activeElement.selector,
				html: snapshot.activeElement.html,
				tabIndex: snapshot.tabIndex,
				measurement,
				bucket,
			});

			if (bucket === "violation") {
				failures++;
			}

			recount(result);

			if (
				resolved.failedElementLimit > 0 &&
				failures >= resolved.failedElementLimit
			) {
				result.summary.reachedFailedElementLimit = true;
				disconnectSelf(session);
				return;
			}

			if (checked >= resolved.elementLimit) {
				result.summary.reachedLimit = true;
				disconnectSelf(session);
			}
		},
		onSessionEnd(reason) {
			clearTimer();
			if (!disconnectedSelf) {
				result.summary.sessionEnd = reason;
			}
		},
	};
}

/**
 * Tab through focusable elements and report whether each is entirely hidden
 * behind other content. Builds a private tab session, drives the loop, and
 * hands back this consumer's result.
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
	return audit.result;
}
