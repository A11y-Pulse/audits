import { releaseStashedElements, stashedElementSelectors } from "@a11y-pulse/browser-adaptor";
import { truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import {
	type BaseAuditOptions,
	createAuditSelfDisconnect,
	createTabOrchestrator,
	DEFAULT_ELEMENT_LIMIT,
	DEFAULT_SCREENSHOT_SETTLE_DELAY,
	DEFAULT_TIMEOUT,
	type TabConsumer,
} from "@a11y-pulse/tab-orchestrator";
import type { ElementInspection, UnreachableControlsAdaptor } from "./adaptor";
import { type CollectedCandidates, collectCandidatesScript } from "./browser-scripts";
import { type Classified, classifyCandidates } from "./classify";
import type { UnreachableControlsResult } from "./result";

export const DEFAULT_CANDIDATE_LIMIT = 500;
export const DEFAULT_FINDING_LIMIT = 50;

/** How many `blanket-listener` elements are listed: enough to show the pattern. */
export const BLANKET_LISTENER_SAMPLE = 5;

const STASH_KEY = "__a11yPulseUnreachableControls";

export type UnreachableControlsOptions = Omit<BaseAuditOptions, "failedElementLimit"> & {
	/**
	 * Max elements examined as possible controls. Elements with a sign of being one (a handler
	 * property, a widget role, a pointer cursor) are taken first.
	 */
	candidateLimit?: number;

	/** Max findings reported across `unreachable` and `missingRole`. */
	findingLimit?: number;
};

type ResolvedOptions = Required<UnreachableControlsOptions>;

function resolveOptions(options: UnreachableControlsOptions): ResolvedOptions {
	return {
		elementLimit: options.elementLimit ?? DEFAULT_ELEMENT_LIMIT,
		screenshotSettleDelay: options.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
		timeout: options.timeout ?? DEFAULT_TIMEOUT,
		candidateLimit: options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT,
		findingLimit: options.findingLimit ?? DEFAULT_FINDING_LIMIT,
	};
}

function emptyResult(): UnreachableControlsResult {
	return {
		outcome: "clean",
		unreachable: [],
		missingRole: [],
		listenersInspected: false,
		truncated: false,
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

type Stop = { selector: string; tabIndex: number };

/**
 * Record which elements take focus during a tab session, then scan the page for elements that
 * behave as controls but never took focus (WCAG 2.1.1 Keyboard), and for elements that took focus
 * and behave as controls but expose no role (WCAG 4.1.2 Name, Role, Value). Attach to a
 * `createTabOrchestrator` session, then call `analyse` once the session has run. Or use
 * `runUnreachableControlsAudit` to run as the sole consumer.
 */
export function createUnreachableControlsAudit(
	options: UnreachableControlsOptions = {},
): TabConsumer & {
	result: UnreachableControlsResult;
	/**
	 * Scan the page and judge it against the recorded stops. `startHref` is the page's URL before
	 * the session, so a navigation the session did not notice still makes the result inconclusive.
	 */
	analyse(
		adaptor: UnreachableControlsAdaptor,
		startHref?: string,
	): Promise<UnreachableControlsResult>;
} {
	const resolved = resolveOptions(options);
	const result = emptyResult();
	const stops: Stop[] = [];
	const selfDisconnect = createAuditSelfDisconnect();

	const inconclusive = (
		reason: NonNullable<UnreachableControlsResult["inconclusiveReason"]>,
	): UnreachableControlsResult => {
		result.outcome = "inconclusive";
		result.inconclusiveReason = reason;
		result.unreachable = [];
		result.missingRole = [];

		return result;
	};

	return {
		result,
		capabilities: new Set(),
		onSessionStart(session) {
			selfDisconnect.armTimeout(resolved.timeout, session, () => {
				result.summary.timedOut = true;
			});
		},
		onTabStop(snapshot, session) {
			stops.push({ selector: snapshot.activeElement.selector, tabIndex: snapshot.tabIndex });
			result.summary.checked = stops.length;

			if (stops.length >= resolved.elementLimit) {
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
			// A pass that stopped short has not shown which elements Tab reaches, and may have left
			// the page somewhere else, so nothing found afterwards can be trusted.
			if (result.summary.timedOut) {
				return inconclusive("timeout");
			}

			if (result.summary.reachedLimit) {
				return inconclusive("element-limit");
			}

			if (result.summary.sessionEnd !== "completed") {
				return inconclusive("session-ended-early");
			}

			const inspects = typeof adaptor.inspectElements === "function";

			try {
				let collected: CollectedCandidates;

				try {
					collected = await adaptor.evaluate(
						collectCandidatesScript,
						stops.map((stop) => stop.selector),
						STASH_KEY,
						resolved.candidateLimit,
						inspects,
					);
				} catch {
					return inconclusive("scan-failed");
				}

				if (startHref !== undefined && collected.href !== startHref) {
					return inconclusive("navigated");
				}

				const { candidates } = collected;
				let inspections: ElementInspection[] | null = null;

				if (inspects && candidates.length > 0) {
					try {
						inspections =
							(await adaptor.inspectElements?.(
								STASH_KEY,
								candidates.length,
								candidates
									.filter((candidate) => candidate.kind === "focused")
									.map((candidate) => candidate.index),
							)) ?? null;
					} catch {
						inspections = null;
					}
				}

				const classified = classifyCandidates(candidates, inspections);
				const blanket = classified.filter((item) => item.reason === "blanket-listener");
				const others = classified.filter((item) => item.reason !== "blanket-listener");

				// Strongest evidence first, so the limit cuts what says least about the page.
				const reported = [
					...others.filter((item) => item.verdict === "failed"),
					...others.filter((item) => item.verdict === "review"),
					...blanket.slice(0, BLANKET_LISTENER_SAMPLE),
				]
					.slice(0, Math.max(0, resolved.findingLimit))
					.sort((a, b) => a.index - b.index);
				let selectors: string[];

				try {
					selectors = await stashedElementSelectors(
						adaptor,
						STASH_KEY,
						reported.map((item) => item.index),
					);
				} catch {
					return inconclusive("scan-failed");
				}

				const describe = (item: Classified, position: number) => {
					const candidate = candidates[item.index];

					return {
						selector: selectors[position] ?? "",
						html: truncateHtml(candidate?.html ?? ""),
						text: candidate?.text ?? "",
						verdict: item.verdict,
						signals: item.signals,
					};
				};

				reported.forEach((item, position) => {
					if (item.finding === "unreachable") {
						result.unreachable.push({ ...describe(item, position), reason: item.reason });

						return;
					}

					const focusedAt = candidates[item.index]?.focusedAt ?? null;

					result.missingRole.push({
						...describe(item, position),
						reason: item.reason,
						computedRole: item.computedRole,
						tabIndex: (focusedAt === null ? undefined : stops[focusedAt]?.tabIndex) ?? 0,
					});
				});

				result.missingRole.sort((a, b) => a.tabIndex - b.tabIndex);
				result.listenersInspected = inspections !== null;
				result.truncated = collected.truncated || reported.length < classified.length;
				result.summary.failed = reported.filter((item) => item.verdict === "failed").length;
				result.outcome = reported.length > 0 ? "findings" : "clean";

				return result;
			} finally {
				try {
					await releaseStashedElements(adaptor, STASH_KEY);
				} catch {
					// The page is gone, and the stash with it.
				}
			}
		},
	};
}

/**
 * Tab through the page, then report controls the keyboard never reached and focused controls that
 * expose no role. Builds a private tab session, drives the loop, and hands back this consumer's
 * result.
 */
export async function runUnreachableControlsAudit(
	adaptor: UnreachableControlsAdaptor,
	options: UnreachableControlsOptions = {},
): Promise<UnreachableControlsResult> {
	const resolved = resolveOptions(options);
	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: resolved.screenshotSettleDelay,
		markerLimit: resolved.elementLimit,
	});
	const audit = createUnreachableControlsAudit(options);
	orchestrator.attach(audit);
	const startHref = await adaptor.evaluate(() => location.href);
	await orchestrator.run();

	return audit.analyse(adaptor, startHref);
}
