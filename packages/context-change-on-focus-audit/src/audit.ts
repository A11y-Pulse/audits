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
import { classifyContextSignals } from "./classify";
import type { ContextChangeOnFocusResult } from "./result";

export type ContextChangeOnFocusOptions = BaseAuditOptions;

type ResolvedOptions = Required<ContextChangeOnFocusOptions>;

function resolveOptions(options: ContextChangeOnFocusOptions): ResolvedOptions {
	return {
		elementLimit: options.elementLimit ?? DEFAULT_ELEMENT_LIMIT,
		screenshotSettleDelay:
			options.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
		failedElementLimit:
			options.failedElementLimit ?? DEFAULT_FAILED_ELEMENT_LIMIT,
		timeout: options.timeout ?? DEFAULT_TIMEOUT,
	};
}

function emptyResult(): ContextChangeOnFocusResult {
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

function recount(result: ContextChangeOnFocusResult): void {
	const failed = result.elements.filter((element) => element.failed).length;
	result.summary.checked = result.elements.length;
	result.summary.failed = failed;
	result.summary.passed = result.elements.length - failed;
}

/**
 * Tab through focusable elements and report whether focusing any of them
 * triggers a context change (WCAG 3.2.1 On Focus): a new window, an
 * auto-submitted form, focus being removed or redirected outside the
 * intended element's subtree, or a navigation. Attach to a
 * `createTabOrchestrator` session, or use `runContextChangeOnFocusAudit` to
 * run as the sole consumer.
 */
export function createContextChangeOnFocusAudit(
	options: ContextChangeOnFocusOptions = {},
): TabConsumer & { result: ContextChangeOnFocusResult } {
	const resolved = resolveOptions(options);
	const result = emptyResult();
	let checked = 0;
	let failures = 0;
	const selfDisconnect = createAuditSelfDisconnect();

	return {
		result,
		capabilities: new Set(["contextSignals"] as const),
		onSessionStart(session) {
			selfDisconnect.armTimeout(resolved.timeout, session, () => {
				result.summary.timedOut = true;
			});
		},
		onTabStop(snapshot, session) {
			checked++;

			const drain = snapshot.contextSignals;
			if (drain === undefined) {
				// Should not happen: this consumer declares the "contextSignals"
				// capability, so the orchestrator always populates it.
				return;
			}

			const findings = classifyContextSignals(drain.signals);
			const failed = findings.some((finding) => finding.bucket === "violation");

			result.elements.push({
				selector: snapshot.activeElement.selector,
				html: snapshot.activeElement.html,
				tabIndex: snapshot.tabIndex,
				findings,
				failed,
			});

			if (failed) {
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
 * Tab through focusable elements and report whether focusing any of them
 * triggers a context change. Builds a private tab session, drives the loop,
 * and hands back this consumer's result.
 */
export async function runContextChangeOnFocusAudit(
	adaptor: BrowserAdaptor,
	options: ContextChangeOnFocusOptions = {},
): Promise<ContextChangeOnFocusResult> {
	const resolved = resolveOptions(options);
	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: resolved.screenshotSettleDelay,
		markerLimit: resolved.elementLimit,
	});
	const audit = createContextChangeOnFocusAudit(options);
	orchestrator.attach(audit);
	await orchestrator.run();
	return audit.result;
}
