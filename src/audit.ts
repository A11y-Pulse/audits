import type { FocusAppearanceAuditAdaptor } from "./adaptor";
import {
	activeElementHandleScript,
	baselineScript,
	blurScript,
	clearMarkersScript,
	elementRectScript,
	focusScript,
	isCenterObscuredScript,
	pageDimensionsScript,
	probeActiveElementScript,
	scrollToCenterScript,
} from "./browser-scripts";
import {
	alignedRegionsDiffer,
	bufferedClip,
	type Rect,
	type StyleSnapshot,
	stylesIndicateFocus,
} from "./detection";
import { FOCUS_STYLE_PROPERTIES } from "./focus-style";
import { getSelector } from "./get-selector";
import type {
	DetectionMethod,
	FocusAppearanceResult,
	FocusElementResult,
} from "./result";
import { truncateHtml } from "./truncate-html";

export const DEFAULT_ELEMENT_LIMIT = 1024;
export const DEFAULT_SCREENSHOT_SETTLE_DELAY = 33; // ~2 frames at 60fps
export const DEFAULT_SCREENSHOT_CLIP_BUFFER = 10;
export const DEFAULT_SCREENSHOT_DIFF_THRESHOLD = 4;
export const DEFAULT_FAILED_ELEMENT_LIMIT = 0; // 0 = never finish early
export const DEFAULT_TIMEOUT = 0; // 0 = no timeout

const MARKER_ATTR = "data-a11y-focus-idx";

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

export type ActiveElementInfo = {
	/** The element's marker index, or null if it was not in the baseline set. */
	index: number | null;
	isBody: boolean;
	/** The focused element is an <iframe>; see ActiveElementBase. */
	isIframe: boolean;
	selector: string;
	html: string;
	styles: StyleSnapshot;
	rect: Rect;
};

/** A focusable element's unfocused baseline: its styles and page-relative rect. */
export type BaselineEntry = {
	styles: StyleSnapshot;
	rect: Rect;
};

/** The browser-coupled seams the loop drives. Mocked in unit tests. */
export type FocusProbe = {
	captureBaseline(): Promise<Map<number, BaselineEntry>>;
	hasFocus(): Promise<boolean>;
	pressTab(): Promise<void>;
	settle(): Promise<void>;
	probeActiveElement(): Promise<ActiveElementInfo | null>;
	detectIndicator(
		info: ActiveElementInfo,
		baseline: Map<number, BaselineEntry>,
	): Promise<DetectionMethod | null>;
	clearMarkers(): Promise<void>;
};

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

/**
 * Tab through focusable elements and report whether each shows a visible focus
 * indicator. Enables focus reporting up front, then drives the loop.
 */
export async function runFocusAppearanceAudit(
	adaptor: FocusAppearanceAuditAdaptor,
	options: FocusAppearanceOptions = {},
): Promise<FocusAppearanceResult> {
	const resolved = resolveOptions(options);

	await adaptor.ensureFocusReporting();

	const probe = createAdaptorProbe(adaptor, resolved);

	return runFocusLoop(probe, resolved);
}

/** The engine-neutral tab loop. Exported for unit testing with a fake probe. */
export async function runFocusLoop(
	probe: FocusProbe,
	options: ResolvedOptions,
): Promise<FocusAppearanceResult> {
	const baseline = await probe.captureBaseline();
	const elements: FocusElementResult[] = [];
	const visited = new Set<number>();

	let i = 0;
	let failures = 0;
	let reachedLimit = false;
	let reachedFailedElementLimit = false;
	let timedOut = false;
	let aborted = false;

	// Captured at the instant the timeout fires so the returned results can't be
	// mutated by the loop still unwinding in the background.
	let timedOutElements: FocusElementResult[] | null = null;

	async function tabThroughElements(): Promise<void> {
		try {
			for (; i < options.elementLimit; i++) {
				if (aborted || !(await probe.hasFocus())) {
					break;
				}

				await probe.pressTab();
				await probe.settle();

				const info = await probe.probeActiveElement();

				if (info === null || info.isBody) {
					break;
				}

				if (info.isIframe) {
					// Tab moved focus into an embedded document. An <iframe> is a
					// container, not a control: WCAG attaches the focus-appearance
					// requirement to the focusable controls inside the frame (a
					// separate document, audited as its own page), not to the frame
					// itself. The parent's document.activeElement also reports the
					// same frame for every internal tab stop, so recording it would
					// both raise false positives and log one duplicate per inner
					// control. Keep tabbing so focus advances through and out of it.
					continue;
				}

				if (info.index !== null) {
					if (visited.has(info.index)) {
						break;
					}

					visited.add(info.index);
				}

				const method = await probe.detectIndicator(info, baseline);

				elements.push({
					selector: info.selector,
					html: info.html,
					tabIndex: i + 1,
					passed: method !== null,
					detectionMethod: method,
				});

				if (method === null) {
					failures++;
				}

				if (
					options.failedElementLimit > 0 &&
					failures >= options.failedElementLimit
				) {
					reachedFailedElementLimit = true;

					break;
				}
			}

			reachedLimit = i === options.elementLimit;
		} finally {
			await probe.clearMarkers();
		}
	}

	if (options.timeout > 0) {
		const loop = tabThroughElements();
		let timer: ReturnType<typeof setTimeout> | undefined;

		try {
			await Promise.race([
				loop,
				new Promise<void>((resolve) => {
					timer = setTimeout(() => {
						aborted = true;
						timedOut = true;
						timedOutElements = [...elements];

						resolve();
					}, options.timeout);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}

		if (timedOut) {
			// The loop keeps unwinding in the background after we return (it breaks
			// at the next iteration); swallow any late failure so it can't surface
			// as an unhandled rejection.
			loop.catch(() => {});
		}
	} else {
		await tabThroughElements();
	}

	const finalElements = timedOutElements ?? elements;
	const passed = finalElements.filter((e) => e.passed).length;

	return {
		elements: finalElements,
		summary: {
			checked: finalElements.length,
			passed,
			failed: finalElements.length - passed,
			reachedLimit,
			reachedFailedElementLimit,
			timedOut,
		},
	};
}

function createAdaptorProbe(
	adaptor: FocusAppearanceAuditAdaptor,
	options: ResolvedOptions,
): FocusProbe {
	return {
		async captureBaseline() {
			const payload = await adaptor.evaluate(
				baselineScript,
				FOCUS_STYLE_PROPERTIES as unknown as string[],
				MARKER_ATTR,
				Math.max(options.elementLimit, options.baselineElementLimit),
			);

			// Entries reference interned snapshots by index; the Map values share
			// the snapshot objects, which are only ever read.
			return new Map(
				payload.entries.map((e) => {
					const styles = payload.styles[e.styleIndex];

					if (!styles) {
						// A dangling index means the payload violated its own invariant;
						// degrading to the pixel diff here would silently hide the bug.
						throw new Error(
							`Baseline entry ${e.index} references missing style index ${e.styleIndex}`,
						);
					}

					return [e.index, { styles, rect: e.rect }] as const;
				}),
			);
		},

		hasFocus() {
			return adaptor.evaluate(() => document.hasFocus());
		},

		pressTab() {
			return adaptor.pressTab();
		},

		settle() {
			return new Promise((resolve) =>
				setTimeout(resolve, options.screenshotSettleDelay),
			);
		},

		async probeActiveElement() {
			const base = await adaptor.evaluate(
				probeActiveElementScript,
				FOCUS_STYLE_PROPERTIES as unknown as string[],
				MARKER_ATTR,
			);

			const html = truncateHtml(base.html);

			if (base.isBody) {
				return { ...base, html, selector: "" };
			}

			const handle = await adaptor.evaluateHandle(activeElementHandleScript);

			try {
				const selector = await adaptor.evaluate(getSelector, handle);

				return { ...base, html, selector };
			} finally {
				await adaptor.disposeRef(handle);
			}
		},

		async detectIndicator(info, baseline) {
			const baselineEntry =
				info.index !== null ? baseline.get(info.index) : undefined;

			if (!options.skipStyleCheck) {
				if (
					baselineEntry &&
					stylesIndicateFocus(baselineEntry.styles, info.styles)
				) {
					return "style";
				}
			}

			const differs = await fallbackPixelDiff(adaptor, options);

			return differs ? "pixel-diff" : null;
		},

		async clearMarkers() {
			await adaptor.evaluate(clearMarkersScript, MARKER_ATTR);
		},
	};
}

async function fallbackPixelDiff(
	adaptor: FocusAppearanceAuditAdaptor,
	options: ResolvedOptions,
): Promise<boolean> {
	// Hold a handle so we can blur and re-focus the SAME element
	// (document.activeElement becomes <body> after blur).
	const handle = await adaptor.evaluateHandle(activeElementHandleScript);

	try {
		// Tab scrolls an element just barely into view at the viewport edge, which
		// is exactly where fixed overlays (cookie banners, sticky footers) sit. If
		// something covers the element there, both screenshots would show the
		// overlay and no indicator could ever be detected — centre the element in
		// the viewport first, then give the scroll a moment to settle.
		if (await adaptor.evaluate(isCenterObscuredScript, handle)) {
			await adaptor.evaluate(scrollToCenterScript, handle);

			await new Promise((resolve) =>
				setTimeout(resolve, options.screenshotSettleDelay),
			);
		}

		const { width: pageWidth, height: pageHeight } =
			await adaptor.evaluate(pageDimensionsScript);

		const focusedRect = await adaptor.evaluate(elementRectScript, handle);
		const focusedClip = bufferedClip(
			focusedRect,
			pageWidth,
			pageHeight,
			options.screenshotClipBuffer,
		);

		// Capture the focused state first, while focus is genuine: re-focusing the
		// element afterwards cannot always restore it (the host of a closed shadow
		// root cannot push focus back inside), so the focused frame must be taken
		// before blurring.
		const focused = await adaptor.screenshotClip(focusedClip);

		await adaptor.evaluate(blurScript, handle);

		// Measure the unfocused rect after blurring rather than reusing a stale
		// baseline rect: a :focus rule may have moved the element, and a
		// fixed-position element's page-relative rect changes with every scroll.
		const unfocusedRect = await adaptor.evaluate(elementRectScript, handle);
		const unfocusedClip = bufferedClip(
			unfocusedRect,
			pageWidth,
			pageHeight,
			options.screenshotClipBuffer,
		);

		const unfocused = await adaptor.screenshotClip(unfocusedClip);

		// Restore focus so the next Tab advances from this element rather than
		// restarting traversal. (A closed-shadow host can't be re-focused into the
		// root; the loop still progresses because Tab re-enters from there.)
		await adaptor.evaluate(focusScript, handle);

		// Each screenshot is framed around its own state's rect, so compare them
		// aligned on where the element sits within each clip.
		return alignedRegionsDiffer(
			Buffer.from(focused),
			{ x: focusedRect.x - focusedClip.x, y: focusedRect.y - focusedClip.y },
			Buffer.from(unfocused),
			{
				x: unfocusedRect.x - unfocusedClip.x,
				y: unfocusedRect.y - unfocusedClip.y,
			},
			options.screenshotDiffThreshold,
		);
	} finally {
		await adaptor.disposeRef(handle);
	}
}
