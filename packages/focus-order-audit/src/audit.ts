import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import {
	type BaseAuditOptions,
	createAuditSelfDisconnect,
	createTabOrchestrator,
	DEFAULT_ELEMENT_LIMIT,
	DEFAULT_SCREENSHOT_SETTLE_DELAY,
	DEFAULT_TIMEOUT,
	type TabConsumer,
} from "@a11y-pulse/tab-orchestrator";
import { findDisorder, type SequenceStop } from "./analyse";
import { type PageContext, pageContextScript } from "./browser-scripts";
import type { FocusOrderElement, FocusOrderResult } from "./result";

export type FocusOrderOptions = Omit<BaseAuditOptions, "failedElementLimit">;

type ResolvedOptions = Required<FocusOrderOptions>;

function resolveOptions(options: FocusOrderOptions): ResolvedOptions {
	return {
		elementLimit: options.elementLimit ?? DEFAULT_ELEMENT_LIMIT,
		screenshotSettleDelay: options.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
		timeout: options.timeout ?? DEFAULT_TIMEOUT,
	};
}

function emptyResult(): FocusOrderResult {
	return {
		outcome: "no-focusable",
		transitions: [],
		positiveTabindex: false,
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

function element({ selector, html, tabIndex }: SequenceStop): FocusOrderElement {
	return { selector, html, tabIndex };
}

/**
 * Record the tab sequence with each element's position, and report a page whose focus repeatedly
 * jumps a long way against the reading order (a review prompt for WCAG 2.4.3 Focus Order). Attach to
 * a `createTabOrchestrator` session, then call `analyse` once the session has run. Or use
 * `runFocusOrderAudit` to run as the sole consumer.
 */
export function createFocusOrderAudit(options: FocusOrderOptions = {}): TabConsumer & {
	result: FocusOrderResult;
	/**
	 * Judge the recorded sequence. `startHref` is the page's URL before the session, so a navigation
	 * the session did not notice still makes the result inconclusive.
	 */
	analyse(adaptor: BrowserAdaptor, startHref?: string): Promise<FocusOrderResult>;
} {
	const resolved = resolveOptions(options);
	const result = emptyResult();
	const sequence: SequenceStop[] = [];
	const selfDisconnect = createAuditSelfDisconnect();

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
			sequence.push({
				tabIndex: snapshot.tabIndex,
				selector: activeElement.selector,
				html: activeElement.html,
				rect: activeElement.rect,
				excluded: activeElement.pinned === true || activeElement.inDialog === true,
			});
			result.summary.checked = sequence.length;

			if (sequence.length >= resolved.elementLimit) {
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
		async analyse(adaptor, startHref) {
			if (sequence.length === 0) {
				return result;
			}

			// A navigation leaves the stops measured on one page and nothing to judge them against.
			if (result.summary.sessionEnd === "navigation" || result.summary.sessionEnd === "failed") {
				result.outcome = "inconclusive";

				return result;
			}

			let context: PageContext;

			try {
				context = await adaptor.evaluate(pageContextScript);
			} catch {
				result.outcome = "inconclusive";

				return result;
			}

			const { positiveTabindex, href, ...page } = context;

			if (startHref !== undefined && href !== startHref) {
				result.outcome = "inconclusive";

				return result;
			}

			// A sequence cut short by a limit or timeout is analysed as far as it got.
			const disorder = findDisorder(sequence, page);

			result.positiveTabindex = positiveTabindex;
			result.transitions = disorder.map(({ kind, from, to }) => ({
				kind,
				from: element(from),
				to: element(to),
			}));
			result.outcome = disorder.length > 0 ? "disordered" : "unremarkable";
			result.summary.failed = disorder.length > 0 ? 1 : 0;

			return result;
		},
	};
}

/**
 * Tab through focusable elements and report a page whose focus repeatedly jumps a long way against
 * the reading order. Builds a private tab session, drives the loop, and hands back this consumer's
 * result.
 */
export async function runFocusOrderAudit(
	adaptor: BrowserAdaptor,
	options: FocusOrderOptions = {},
): Promise<FocusOrderResult> {
	const resolved = resolveOptions(options);
	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: resolved.screenshotSettleDelay,
		markerLimit: resolved.elementLimit,
	});
	const audit = createFocusOrderAudit(options);
	orchestrator.attach(audit);
	const startHref = await adaptor.evaluate(() => location.href);
	await orchestrator.run();

	return audit.analyse(adaptor, startHref);
}
