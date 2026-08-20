import {
	type BaseAuditOptions,
	type BrowserAdaptor,
	createAuditSelfDisconnect,
	createTabOrchestrator,
	DEFAULT_ELEMENT_LIMIT,
	DEFAULT_FAILED_ELEMENT_LIMIT,
	DEFAULT_SCREENSHOT_SETTLE_DELAY,
	DEFAULT_TIMEOUT,
	type TabConsumer,
} from "@a11y-pulse/tab-orchestrator";
import { classifyObscuring } from "./classify";
import type { FocusNotObscuredResult } from "./result";

export type FocusNotObscuredOptions = BaseAuditOptions;

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
	const selfDisconnect = createAuditSelfDisconnect();

	return {
		result,
		capabilities: new Set(["obscuring"] as const),
		onSessionStart(session) {
			selfDisconnect.armTimeout(resolved.timeout, session, () => {
				result.summary.timedOut = true;
			});
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
