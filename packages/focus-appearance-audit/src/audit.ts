import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import {
	type BaseAuditOptions,
	createAuditSelfDisconnect,
	createTabOrchestrator,
	DEFAULT_ELEMENT_LIMIT,
	DEFAULT_FAILED_ELEMENT_LIMIT,
	DEFAULT_SCREENSHOT_SETTLE_DELAY,
	DEFAULT_TIMEOUT,
	type TabConsumer,
} from "@a11y-pulse/tab-orchestrator";
import {
	alignedRegionsDiffer,
	changedStyleProperties,
	colorOnlyChange,
	isUnpainted,
	MIN_LIGHTNESS_CONTRAST,
	omitIdleStyleSnapshot,
} from "./detection";
import {
	FAINT_CHANGE_THRESHOLD,
	hasDefaultRing,
	MIN_INDICATOR_CONTRAST,
	pixelIndicatorContrast,
	styleIndicatorContrast,
} from "./indicator-contrast";
import type { ColorOnlyChange, FocusAppearanceResult, FocusElementResult } from "./result";

/**
 * Whether an element's indicator counts as low contrast: measured at under 3:1 against the colours
 * next to it. An element whose only focus change is one colour is judged on that change instead,
 * where it could be measured, so that it is not counted twice.
 */
export function hasLowContrastIndicator(element: FocusElementResult): boolean {
	const contrast = element.indicatorContrast;

	return (
		contrast !== undefined &&
		contrast.ratio !== null &&
		contrast.ratio < MIN_INDICATOR_CONTRAST &&
		(element.colorOnly === undefined || element.colorOnly.contrastRatio === null)
	);
}

export const DEFAULT_SCREENSHOT_CLIP_BUFFER = 10;
export const DEFAULT_SCREENSHOT_DIFF_THRESHOLD = 4;
export const DEFAULT_SCREENSHOT_LIMIT = 50;

export type FocusAppearanceOptions = BaseAuditOptions & {
	/**
	 * How many focusable elements to snapshot baseline styles for, before tabbing starts. Runs ahead
	 * of `elementLimit` because not every focusable element is tabbable (menus, hidden containers),
	 * and acts as a floor: the effective budget is `max(elementLimit, baselineElementLimit)`.
	 * Defaults to `elementLimit * 2`.
	 */
	baselineElementLimit?: number;

	/** Padding around the element box for the pixel-diff screenshot */
	screenshotClipBuffer?: number;

	/** Number of pixels that must differ to consider an indicator present. Minimum 1; default 4. */
	screenshotDiffThreshold?: number;

	/**
	 * Whether to skip the style check and perform a pixel diff for every element. Warning: this will
	 * cause the audit to be much slower, but may reduce false positives in some rare cases
	 */
	skipStyleCheck?: boolean;

	/**
	 * How many elements keep their focused and unfocused screenshots as evidence (failures, elements
	 * needing review and colour-only changes together). Every element is still checked; past the limit
	 * only the screenshots are dropped. Default 50; 0 keeps none.
	 */
	screenshotLimit?: number;
};

type ResolvedOptions = Required<FocusAppearanceOptions>;

function resolveOptions(options: FocusAppearanceOptions): ResolvedOptions {
	const elementLimit = options.elementLimit ?? DEFAULT_ELEMENT_LIMIT;

	return {
		elementLimit,
		baselineElementLimit: options.baselineElementLimit ?? elementLimit * 2,
		screenshotSettleDelay: options.screenshotSettleDelay ?? DEFAULT_SCREENSHOT_SETTLE_DELAY,
		screenshotClipBuffer: options.screenshotClipBuffer ?? DEFAULT_SCREENSHOT_CLIP_BUFFER,
		// Floor at 1: regionsDiffer uses `diffPixels >= threshold`, so a threshold of 0 would report
		// every region (even identical ones) as differing.
		screenshotDiffThreshold: Math.max(
			1,
			options.screenshotDiffThreshold ?? DEFAULT_SCREENSHOT_DIFF_THRESHOLD,
		),
		skipStyleCheck: options.skipStyleCheck ?? false,
		screenshotLimit: Math.max(0, options.screenshotLimit ?? DEFAULT_SCREENSHOT_LIMIT),
		failedElementLimit: options.failedElementLimit ?? DEFAULT_FAILED_ELEMENT_LIMIT,
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
			needsReview: 0,
			lowContrastIndicators: 0,
			reachedLimit: false,
			reachedScreenshotLimit: false,
			reachedFailedElementLimit: false,
			timedOut: false,
			sessionEnd: null,
		},
	};
}

function recount(result: FocusAppearanceResult): void {
	const needsReview = result.elements.filter((element) => element.needsReview !== undefined);
	const passed = result.elements.filter((element) => element.passed && !element.needsReview);
	result.summary.checked = result.elements.length;
	result.summary.passed = passed.length;
	result.summary.needsReview = needsReview.length;
	result.summary.failed = result.elements.length - passed.length - needsReview.length;
	result.summary.lowContrastIndicators = result.elements.filter(hasLowContrastIndicator).length;
}

type Box = { x: number; y: number };

/** Where an element sits within its screenshot clip, in device pixels. */
function anchorOf(rect: Box, clip: Box, scale: number): { x: number; y: number } {
	return { x: (rect.x - clip.x) * scale, y: (rect.y - clip.y) * scale };
}

/**
 * Tab through focusable elements and report whether each shows a visible focus indicator. Attach to
 * a `createTabOrchestrator` session, or use `runFocusAppearanceAudit` to run as the sole consumer.
 */
export function createFocusAppearanceAudit(
	options: FocusAppearanceOptions = {},
): TabConsumer & { result: FocusAppearanceResult } {
	const resolved = resolveOptions(options);
	const result = emptyResult();
	let checked = 0;
	let failures = 0;
	let screenshotsKept = 0;
	const selfDisconnect = createAuditSelfDisconnect();

	return {
		result,
		capabilities: new Set(
			resolved.skipStyleCheck
				? (["unfocusedPair"] as const)
				: (["baselineStyles", "unfocusedPair"] as const),
		),
		onSessionStart(session) {
			selfDisconnect.armTimeout(resolved.timeout, session, () => {
				result.summary.timedOut = true;
			});
		},
		async onTabStop(snapshot, session) {
			checked++;

			const focused = snapshot.activeElement.styles;
			const element: FocusElementResult = {
				selector: snapshot.activeElement.selector,
				html: snapshot.activeElement.html,
				tabIndex: snapshot.tabIndex,
				passed: false,
				detectionMethod: null,
			};

			/** Whether this element may keep screenshots, counting it against the limit if so. */
			const keepScreenshots = (): boolean => {
				if (screenshotsKept >= resolved.screenshotLimit) {
					result.summary.reachedScreenshotLimit = true;

					return false;
				}

				screenshotsKept++;

				return true;
			};

			// An element that draws nothing itself cannot show its own focus styles, whatever they
			// compute to (a hidden checkbox still gets the default outline). Its focus has to be seen on
			// something else, which only the screenshots can tell.
			const changed =
				!resolved.skipStyleCheck &&
				snapshot.baselineStyles &&
				!isUnpainted(snapshot.activeElement.rect, focused)
					? changedStyleProperties(snapshot.baselineStyles, focused)
					: [];

			if (changed.length > 0 && snapshot.baselineStyles) {
				element.detectionMethod = "style";
				element.changedProperties = changed;

				let contrast = styleIndicatorContrast(
					snapshot.baselineStyles,
					focused,
					changed,
					snapshot.activeElement.backdrop,
				);

				if (
					contrast !== undefined &&
					contrast.ratio === null &&
					(contrast.reason === "background-unresolved" || contrast.reason === "background-image")
				) {
					// The colours behind the element cannot be told from styles (it sits over an image, or
					// is positioned over other content). The screenshots show what is really painted there.
					const pair = await session.ensureUnfocusedPair();
					const fromPixels = pixelIndicatorContrast(
						pair.focusedScreenshot,
						anchorOf(pair.focusedRect, pair.focusedClip, pair.scale),
						pair.unfocusedScreenshot,
						anchorOf(pair.unfocusedRect, pair.unfocusedClip, pair.scale),
						pair.scale,
					);

					if (fromPixels.ratio !== null) {
						contrast = fromPixels;
					}
				}

				if (contrast !== undefined) {
					element.indicatorContrast = contrast;
				}

				const colorOnly: ColorOnlyChange | null = colorOnlyChange(
					snapshot.baselineStyles,
					focused,
					snapshot.activeElement.backdrop,
				);

				if (colorOnly !== null) {
					element.colorOnly = colorOnly;

					if (
						colorOnly.contrastRatio === null ||
						colorOnly.contrastRatio < MIN_LIGHTNESS_CONTRAST
					) {
						const pair = await session.ensureUnfocusedPair();

						if (
							colorOnly.backgroundColor === undefined &&
							colorOnly.property !== "background-color" &&
							pair.background
						) {
							colorOnly.backgroundColor = pair.background;
						}

						if (keepScreenshots()) {
							colorOnly.evidence = {
								focusedScreenshot: pair.focusedScreenshot,
								unfocusedScreenshot: pair.unfocusedScreenshot,
							};
						}
					}
				}
			} else {
				const pair = await session.ensureUnfocusedPair();
				const focusedAnchor = anchorOf(pair.focusedRect, pair.focusedClip, pair.scale);
				const unfocusedAnchor = anchorOf(pair.unfocusedRect, pair.unfocusedClip, pair.scale);
				const differs = alignedRegionsDiffer(
					Buffer.from(pair.focusedScreenshot),
					focusedAnchor,
					Buffer.from(pair.unfocusedScreenshot),
					unfocusedAnchor,
					resolved.screenshotDiffThreshold * pair.scale * pair.scale,
				);

				if (pair.clipTarget === "label" || pair.clipTarget === "parent") {
					element.measuredOn = pair.clipTarget;
				}

				// A wrapper styled with :focus-within, or a label styled from its input's focus, draws the
				// indicator outside the element's own clip.
				const around = resolved.skipStyleCheck
					? []
					: (pair.context ?? [])
							.map((entry) => ({
								entry,
								changed: changedStyleProperties(entry.unfocusedStyles, entry.focusedStyles),
							}))
							.filter((candidate) => candidate.changed.length > 0);

				// Only a wrapper or label that is this element's alone says which element has focus, and
				// one with an animation running differs between any two reads.
				const own = around.find(({ entry }) => !entry.shared && !entry.animating);
				const shared = around.some(({ entry }) => entry.shared && !entry.animating);
				// The screenshots are taken a moment apart, so an animation in them is a difference too.
				const animating = (pair.context ?? []).some((entry) => entry.animating);

				if (differs && !animating && !shared) {
					element.detectionMethod = "pixel-diff";

					// The browser's own ring is not the author's to answer for, as on the style path. It
					// only shows when the element draws something itself.
					if (pair.unpainted || !hasDefaultRing(focused.element)) {
						element.indicatorContrast = pixelIndicatorContrast(
							pair.focusedScreenshot,
							focusedAnchor,
							pair.unfocusedScreenshot,
							unfocusedAnchor,
							pair.scale,
						);
					}
				} else if (own) {
					element.detectionMethod = "style";
					element.changedProperties = own.changed;
					element.indicatorOn = { kind: own.entry.kind, html: own.entry.html };

					// What is behind the wrapper or label is not read, so the screenshots, read finely
					// enough to pick up a change too faint to have counted above, say what the styles cannot.
					const contrast = styleIndicatorContrast(
						own.entry.unfocusedStyles,
						own.entry.focusedStyles,
						own.changed,
						undefined,
					);

					if (contrast !== undefined) {
						const fromPixels =
							contrast.ratio === null
								? pixelIndicatorContrast(
										pair.focusedScreenshot,
										focusedAnchor,
										pair.unfocusedScreenshot,
										unfocusedAnchor,
										pair.scale,
										FAINT_CHANGE_THRESHOLD,
									)
								: null;

						element.indicatorContrast = fromPixels?.ratio != null ? fromPixels : contrast;
					}
				} else {
					if (shared) {
						// Something changes, but on a wrapper that other tab stops share: it does not show
						// which of them has focus.
						element.needsReview = "shared-indicator";
					} else if (animating) {
						// Whether or not the two reads happened to differ: with an animation running they
						// cannot show that nothing changes on focus either.
						element.needsReview = "animating";
					} else if (pair.caretHidden) {
						// The text caret is the only sign of focus. It is hidden in the screenshots, so it is
						// reported the same way on every engine, for a person to judge.
						element.detectionMethod = "caret";
						element.needsReview = "caret";
					} else if (pair.obstructed) {
						element.needsReview = "obstructed";
					}

					if (element.detectionMethod === null && keepScreenshots()) {
						element.failureEvidence = {
							focusedScreenshot: pair.focusedScreenshot,
							unfocusedScreenshot: pair.unfocusedScreenshot,
							focusedStyles: omitIdleStyleSnapshot(focused),
							unfocusedStyles: omitIdleStyleSnapshot(pair.unfocusedStyles),
						};
					}
				}
			}

			let contrast = element.indicatorContrast;

			if (
				contrast !== undefined &&
				snapshot.activeElement.animating &&
				(contrast.ratio === null
					? contrast.method === "pixels"
					: contrast.ratio < MIN_INDICATOR_CONTRAST)
			) {
				// Caught part-way through a transition: the colours read are not the ones it settles on.
				contrast = { ...contrast, ratio: null, reason: "transitioning" };
				element.indicatorContrast = contrast;
			}

			if (
				contrast !== undefined &&
				contrast.ratio !== null &&
				contrast.ratio < MIN_INDICATOR_CONTRAST &&
				keepScreenshots()
			) {
				// Cached for the stop: a pair the detection above already took is reused.
				const pair = await session.ensureUnfocusedPair();

				contrast.evidence = {
					focusedScreenshot: pair.focusedScreenshot,
					unfocusedScreenshot: pair.unfocusedScreenshot,
				};
			}

			element.passed = element.detectionMethod !== null;
			result.elements.push(element);

			if (!element.passed && element.needsReview === undefined) {
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
 * Tab through focusable elements and report whether each shows a visible focus indicator. Enables
 * focus reporting up front, then drives the loop.
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
