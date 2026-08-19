import {
	type BrowserAdaptor,
	createTabOrchestrator,
	type TabConsumer,
	type TabSessionHandle,
} from "@a11y-pulse/tab-orchestrator";
import {
	alignedRegionsDiffer,
	omitIdleStyleSnapshot,
	stylesIndicateFocus,
} from "./detection";
import type { FocusAppearanceResult, FocusElementResult } from "./result";

export const DEFAULT_ELEMENT_LIMIT = 1024;
export const DEFAULT_SCREENSHOT_SETTLE_DELAY = 33; // ~2 frames at 60fps
export const DEFAULT_SCREENSHOT_CLIP_BUFFER = 10;
export const DEFAULT_SCREENSHOT_DIFF_THRESHOLD = 4;
export const DEFAULT_FAILED_ELEMENT_LIMIT = 0; // 0 = never finish early
export const DEFAULT_TIMEOUT = 0; // 0 = no timeout

export type FocusAppearanceOptions = {
	/** Max focusable elements to tab through */
	elementLimit?: number;

	/**
	 * The audit calculates the baseline styles for focusable elements up-front, before it begins
	 * tabbing through elements. `elementLimit` controls how many elements the audit will tab
	 * through, however not all focusable elements are tabbable, for example elements inside menus
	 * or hidden containers. The baseline element limit therefore ensures enough focusable elements
	 * have a baseline snapshot. The effective baseline budget is `max(elementLimit,
	 * baselineElementLimit)`, so it also acts as a floor. Defaults to `elementLimit * 2`.
	 */
	baselineElementLimit?: number;

	/** How long to wait (in ms) after each Tab for focus styles/transitions to settle */
	screenshotSettleDelay?: number;

	/** Padding around the element box for the pixel-diff screenshot */
	screenshotClipBuffer?: number;

	/** Number of pixels that must differ to consider an indicator present. Minimum 1; default 4. */
	screenshotDiffThreshold?: number;

	/**
	 * Whether to skip the style check and perform a pixel diff for every element. Warning: this
	 * will cause the audit to be much slower, but may reduce false positives in some rare cases
	 */
	skipStyleCheck?: boolean;

	/**
	 * Finish the audit early once this many elements have failed, leaving the remaining elements
	 * unchecked. Useful as a fail-fast signal when you only need to know that a page has focus
	 * problems, not their full extent. 0 (the default) means no early finish.
	 */
	failedElementLimit?: number;

	/**
	 * Limit how long (in ms) the audit runs before returning the results it has
	 * gathered so far.
	 */
	timeout?: number;
};

type ResolvedOptions = Required<FocusAppearanceOptions>;

function resolveOptions(options: FocusAppearanceOptions): ResolvedOptions {
	const elementLimit = options.elementLimit ?? DEFAULT_ELEMENT_LIMIT;

	return {
		elementLimit,
		baselineElementLimit: options.baselineElementLimit ?? elementLimit * 2,
		screenshotSettleDelay:
			options.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
		screenshotClipBuffer:
			options.screenshotClipBuffer ?? DEFAULT_SCREENSHOT_CLIP_BUFFER,
		// Floor at 1: regionsDiffer uses `diffPixels >= threshold`, so a threshold
		// of 0 would report every region (even identical ones) as differing.
		screenshotDiffThreshold: Math.max(
			1,
			options.screenshotDiffThreshold ?? DEFAULT_SCREENSHOT_DIFF_THRESHOLD,
		),
		skipStyleCheck: options.skipStyleCheck ?? false,
		failedElementLimit:
			options.failedElementLimit ?? DEFAULT_FAILED_ELEMENT_LIMIT,
		timeout: options.timeout ?? DEFAULT_TIMEOUT,
	};
}

function emptyResult(): FocusAppearanceResult {
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

function recount(result: FocusAppearanceResult): void {
	const passed = result.elements.filter((element) => element.passed).length;
	result.summary.checked = result.elements.length;
	result.summary.passed = passed;
	result.summary.failed = result.elements.length - passed;
}

/**
 * Tab through focusable elements and report whether each shows a visible focus
 * indicator. Attach to a `createTabOrchestrator` session, or use
 * `runFocusAppearanceAudit` to run as the sole consumer.
 */
export function createFocusAppearanceAudit(
	options: FocusAppearanceOptions = {},
): TabConsumer & { result: FocusAppearanceResult } {
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
		capabilities: new Set(
			resolved.skipStyleCheck
				? (["unfocusedPair"] as const)
				: (["baselineStyles", "unfocusedPair"] as const),
		),
		onSessionStart(session) {
			if (resolved.timeout > 0) {
				timer = setTimeout(() => {
					timer = undefined;
					result.summary.timedOut = true;
					disconnectSelf(session);
				}, resolved.timeout);
			}
		},
		async onTabStop(snapshot, session) {
			checked++;

			const focused = snapshot.activeElement.styles;
			let detection: FocusElementResult["detectionMethod"] = null;
			let failureEvidence: FocusElementResult["failureEvidence"];

			if (
				!resolved.skipStyleCheck &&
				snapshot.baselineStyles &&
				stylesIndicateFocus(snapshot.baselineStyles, focused)
			) {
				detection = "style";
			} else {
				const pair = await session.ensureUnfocusedPair();
				const differs = alignedRegionsDiffer(
					Buffer.from(pair.focusedScreenshot),
					{
						x: (pair.focusedRect.x - pair.focusedClip.x) * pair.scale,
						y: (pair.focusedRect.y - pair.focusedClip.y) * pair.scale,
					},
					Buffer.from(pair.unfocusedScreenshot),
					{
						x: (pair.unfocusedRect.x - pair.unfocusedClip.x) * pair.scale,
						y: (pair.unfocusedRect.y - pair.unfocusedClip.y) * pair.scale,
					},
					resolved.screenshotDiffThreshold * pair.scale * pair.scale,
				);

				if (differs) {
					detection = "pixel-diff";
				} else {
					failureEvidence = {
						focusedScreenshot: pair.focusedScreenshot,
						unfocusedScreenshot: pair.unfocusedScreenshot,
						focusedStyles: omitIdleStyleSnapshot(focused),
						unfocusedStyles: omitIdleStyleSnapshot(pair.unfocusedStyles),
					};
				}
			}

			result.elements.push({
				selector: snapshot.activeElement.selector,
				html: snapshot.activeElement.html,
				tabIndex: snapshot.tabIndex,
				passed: detection !== null,
				detectionMethod: detection,
				...(failureEvidence !== undefined ? { failureEvidence } : {}),
			});

			if (detection === null) {
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
 * Tab through focusable elements and report whether each shows a visible focus
 * indicator. Enables focus reporting up front, then drives the loop.
 */
export async function runFocusAppearanceAudit(
	adaptor: BrowserAdaptor,
	options: FocusAppearanceOptions = {},
): Promise<FocusAppearanceResult> {
	const resolved = resolveOptions(options);
	const orchestrator = createTabOrchestrator(adaptor, {
		screenshotSettleDelay: options.screenshotSettleDelay,
		screenshotClipBuffer: options.screenshotClipBuffer,
		markerLimit: resolved.elementLimit,
		baselineElementLimit: resolved.baselineElementLimit,
	});
	const audit = createFocusAppearanceAudit(options);
	orchestrator.attach(audit);
	await orchestrator.run();
	return audit.result;
}
