import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import {
	type BaseAuditOptions,
	createAuditSelfDisconnect,
	createTabOrchestrator,
	DEFAULT_ELEMENT_LIMIT,
	DEFAULT_FAILED_ELEMENT_LIMIT,
	DEFAULT_SCREENSHOT_SETTLE_DELAY,
	DEFAULT_TIMEOUT,
	type LateContextChange,
	type TabConsumer,
	type UnattributedContextChange,
} from "@a11y-pulse/tab-orchestrator";
import { type ContextChangeFinding, classifyContextSignals } from "./classify";
import type { ContextChangeOnFocusElementResult, ContextChangeOnFocusResult } from "./result";

export const DEFAULT_SCREENSHOT_LIMIT = 10;

export type ContextChangeOnFocusOptions = BaseAuditOptions & {
	/**
	 * Max elements with findings to screenshot (each is a real page.screenshot() call). Defaults
	 * to 10.
	 */
	screenshotLimit?: number;
};

type ResolvedOptions = Required<ContextChangeOnFocusOptions>;

function resolveOptions(options: ContextChangeOnFocusOptions): ResolvedOptions {
	return {
		elementLimit: options.elementLimit ?? DEFAULT_ELEMENT_LIMIT,
		screenshotSettleDelay: options.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
		failedElementLimit: options.failedElementLimit ?? DEFAULT_FAILED_ELEMENT_LIMIT,
		timeout: options.timeout ?? DEFAULT_TIMEOUT,
		screenshotLimit: options.screenshotLimit ?? DEFAULT_SCREENSHOT_LIMIT,
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
 * Tab through focusable elements and report whether focusing any of them triggers a context change
 * (WCAG 3.2.1 On Focus): a new window, an auto-submitted form, focus being removed or redirected
 * outside the intended element's subtree, a native dialog, or a navigation. Attach to a `createTabOrchestrator`
 * session, or use `runContextChangeOnFocusAudit` to run as the sole consumer.
 */
export function createContextChangeOnFocusAudit(
	options: ContextChangeOnFocusOptions = {},
): TabConsumer & { result: ContextChangeOnFocusResult } {
	const resolved = resolveOptions(options);
	const result = emptyResult();
	let checked = 0;
	let screenshotsTaken = 0;
	const selfDisconnect = createAuditSelfDisconnect();
	// Elements already reported, so that a change a timer makes after focus has moved on is added to
	// the element that set the timer rather than to whichever one happens to be focused.
	const byIndex = new Map<number, ContextChangeOnFocusElementResult>();
	const seenUnattributed = new Set<string>();
	const byHtml = new Map<string, ContextChangeOnFocusElementResult>();
	let lastTabIndex = 0;

	/** Add what a timer did to the element that set it, which focus has since left. */
	const absorbLate = (changes: LateContextChange[] | undefined, tabIndex: number): void => {
		for (const change of changes ?? []) {
			const delayed = classifyContextSignals(change.signals, change.details).map((finding) => ({
				...finding,
				delayed: true,
			}));

			if (delayed.length === 0) {
				continue;
			}

			let owner =
				(change.index === null ? undefined : byIndex.get(change.index)) ?? byHtml.get(change.html);

			if (owner === undefined) {
				owner = {
					selector: "",
					html: change.html,
					tabIndex,
					findings: [],
					failed: false,
				};
				result.elements.push(owner);
				byHtml.set(change.html, owner);
			}

			owner.findings.push(...delayed);
			owner.failed = owner.findings.some((finding) => finding.bucket === "violation");
		}
	};

	/**
	 * Keep what the page did that no focused element can be shown to have caused. It is evidence
	 * that something changed context during the pass, not that focusing anything did, so it is for
	 * review and is reported once however often the page repeated it.
	 */
	const absorbUnattributed = (changes: UnattributedContextChange[] | undefined): void => {
		for (const change of changes ?? []) {
			for (const finding of classifyContextSignals(change.signals, change.details)) {
				const unattributed: ContextChangeFinding = { ...finding, bucket: "incomplete" };
				const key = JSON.stringify([finding.kind, finding.url, finding.from, finding.to]);

				if (seenUnattributed.has(key)) {
					continue;
				}

				seenUnattributed.add(key);
				result.unattributed ??= [];
				result.unattributed.push(unattributed);
			}
		}
	};

	return {
		result,
		capabilities: new Set(["contextSignals", "screenshot"] as const),
		onSessionStart(session) {
			selfDisconnect.armTimeout(resolved.timeout, session, () => {
				result.summary.timedOut = true;
			});
		},
		async onTabStop(snapshot, session) {
			checked++;

			const drain = snapshot.contextSignals;

			if (drain === undefined) {
				// Should not happen: this consumer declares the "contextSignals" capability, so the
				// orchestrator always populates it.
				return;
			}

			lastTabIndex = snapshot.tabIndex;
			absorbLate(drain.late, snapshot.tabIndex);
			absorbUnattributed(drain.unattributed);

			const findings = classifyContextSignals(drain.signals, drain.details);
			const failed = findings.some((finding) => finding.bucket === "violation");

			// Focus that was dropped or passed on is the doing of the element that received it, which
			// is no longer the focused one when it was passed on.
			const attributed = drain.details?.attributed;
			const focused = snapshot.activeElement;
			const gaveFocusAway =
				attributed !== undefined &&
				(drain.signals.focusRemoved || drain.signals.redirect !== null) &&
				attributed.selector !== focused.selector;

			if (gaveFocusAway) {
				for (const finding of findings) {
					if (
						finding.kind === "focus-redirected-outside" ||
						finding.kind === "focus-redirected-same-subtree"
					) {
						finding.redirectedTo = { selector: focused.selector, html: focused.html };
					}
				}
			}

			// A navigation that went ahead leaves nothing of the original page to capture.
			let screenshot: Uint8Array | undefined;

			if (
				findings.length > 0 &&
				!drain.signals.navigation &&
				screenshotsTaken < resolved.screenshotLimit
			) {
				try {
					screenshot = await session.screenshotClip(gaveFocusAway ? "attributed" : "focused");
				} catch (error) {
					// The element that gave focus away may have left the page since; the one focus went
					// to is still worth showing. Any other capture failure is the session's to report.
					if (!gaveFocusAway) {
						throw error;
					}

					screenshot = await session.screenshotClip();
				}
			}

			if (screenshot) {
				screenshotsTaken++;
			}

			const element: ContextChangeOnFocusElementResult = {
				selector: gaveFocusAway ? attributed.selector : focused.selector,
				html: gaveFocusAway ? attributed.html : focused.html,
				tabIndex: snapshot.tabIndex,
				findings,
				failed,
				screenshot,
			};

			result.elements.push(element);

			if (!gaveFocusAway && focused.index !== null) {
				byIndex.set(focused.index, element);
			}

			byHtml.set(element.html, element);

			recount(result);

			if (resolved.failedElementLimit > 0 && result.summary.failed >= resolved.failedElementLimit) {
				result.summary.reachedFailedElementLimit = true;
				selfDisconnect.disconnect(session);

				return;
			}

			if (checked >= resolved.elementLimit) {
				result.summary.reachedLimit = true;
				selfDisconnect.disconnect(session);
			}
		},
		onSessionEnd(reason, detail) {
			selfDisconnect.clear();

			// What the last elements of the tab order deferred to a timer, which the session waited
			// for, and anything else the observer still had to report.
			absorbLate(detail?.contextSignals?.late, lastTabIndex);
			absorbUnattributed(detail?.contextSignals?.unattributed);
			recount(result);

			if (!selfDisconnect.disconnectedSelf) {
				result.summary.sessionEnd = reason;

				// The page went before the element that sent it could be read. What is known is the
				// element tabbed from, and where the page ended up.
				if (reason === "navigation" && detail?.navigation) {
					result.navigation = detail.navigation;
				}
			}
		},
	};
}

/**
 * Tab through focusable elements and report whether focusing any of them triggers a context change.
 * Builds a private tab session, drives the loop, and hands back this consumer's result.
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
