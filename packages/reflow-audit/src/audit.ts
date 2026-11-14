import { truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import type { ReflowAuditAdaptor } from "./adaptor";
import {
	type LayoutFingerprint,
	MIN_REFLOW_HEIGHT,
	measureReflowScript,
	pageDimensionsScript,
	REFLOW_WIDTH,
	type ReflowMeasure,
	type ReflowMeasureOffender,
	ROUNDING_TOLERANCE,
	readLayoutFingerprintScript,
	SCROLLBAR_TOLERANCE,
	scrollWindowToScript,
} from "./browser-scripts";
import type { ReflowBucket, ReflowOffender, ReflowResult } from "./result";

export const DEFAULT_SETTLE_DELAY_MS = 50;
export const DEFAULT_SETTLE_ATTEMPTS = 20;
export const DEFAULT_MIN_SETTLE_MS = 300;
/** Widest evidence clip: the 1280px layout that 320px stands in for at 400% zoom. */
export const MAX_SCREENSHOT_WIDTH = 1280;
export const DEFAULT_SCREENSHOT_CLIP_BUFFER = 10;
export const DEFAULT_SCREENSHOT_LIMIT = 10;

export type ReflowOptions = {
	/** Delay between layout-fingerprint readings while waiting for the page to settle. */
	settleDelayMs?: number;
	/** Max fingerprint readings before measuring anyway and marking the result unsettled. */
	settleAttempts?: number;
	/**
	 * How long the layout fingerprint must hold still before measuring. Long enough by default (300ms)
	 * for a debounced `resize` handler to have swapped in the narrow layout.
	 */
	minSettleMs?: number;
	/**
	 * Vertical padding above/below an offender's row when clipping its screenshot. Defaults to 10.
	 */
	screenshotClipBuffer?: number;
	/** Max offenders to screenshot (each is a real page.screenshot() call). Defaults to 10. */
	screenshotLimit?: number;
};

function delay(ms: number): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}

	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function fingerprintsEqual(left: LayoutFingerprint, right: LayoutFingerprint): boolean {
	return (
		left.scrollWidth === right.scrollWidth &&
		left.clientWidth === right.clientWidth &&
		left.bodyScrollWidth === right.bodyScrollWidth &&
		left.bodyClientWidth === right.bodyClientWidth &&
		left.childCount === right.childCount
	);
}

/**
 * Wait until the layout fingerprint has held still for `minStableMs`. Resolves `true` when the
 * layout is still changing after `attempts` readings, meaning it never settled. A fingerprint that
 * is holding still when the attempts run out is given the rest of its window, so the wait is bounded
 * by `attempts * delayMs + minStableMs`.
 */
async function settle(
	adaptor: ReflowAuditAdaptor,
	delayMs: number,
	attempts: number,
	minStableMs: number,
): Promise<boolean> {
	let previous: LayoutFingerprint | null = null;
	let stableSince = 0;

	for (let i = 0; ; i++) {
		const current = await adaptor.evaluate(readLayoutFingerprintScript);
		const now = Date.now();
		const stable = previous !== null && fingerprintsEqual(previous, current);

		if (stable && now - stableSince >= minStableMs) {
			return false;
		}

		if (!stable) {
			stableSince = now;
		}

		if (i >= attempts - 1 && !stable) {
			return true;
		}

		previous = current;
		await delay(Math.max(delayMs, i >= attempts - 1 ? 1 : 0));
	}
}

/**
 * Screenshot up to `limit` offenders. Each clip starts at x=0 and spans the `viewportWidth`, rather
 * than a box around the offender: this frames the crop the same way the audit measured it (a
 * 320px-wide viewport), so an offender that extends past the edge is visibly cut off there. Only an
 * offender that lies wholly beyond the viewport, and so would not appear at all, widens the clip to
 * reach it: rightwards, or leftwards into negative x on a right-to-left page, whose overflow lies
 * that way (see `captureLeftwards`). Offender rects are document coordinates, as `screenshotClip`
 * expects. Each clip is a
 * real `page.screenshot()` call, so the count is bounded; offenders past the limit get `undefined`
 * rather than a truncated array, so index alignment with `offenders` is preserved.
 */
async function captureOffenderScreenshots(
	adaptor: ReflowAuditAdaptor,
	offenders: ReflowMeasureOffender[],
	viewportWidth: number,
	clipBuffer: number,
	limit: number,
): Promise<Array<Uint8Array | undefined>> {
	if (offenders.length === 0) {
		return [];
	}

	const page = await adaptor.evaluate(pageDimensionsScript);
	const scale = adaptor.screenshotClipScale ?? 1;

	const screenshots: Array<Uint8Array | undefined> = [];

	for (let i = 0; i < offenders.length; i++) {
		if (i >= limit) {
			screenshots.push(undefined);
			continue;
		}

		const { rect } = offenders[i]!;
		const y = Math.max(0, Math.min(rect.y - clipBuffer, page.height - 1));
		const bottom = Math.max(y + 1, Math.min(page.height, rect.y + rect.height + clipBuffer));
		let x = 0;
		let width = viewportWidth;

		if (rect.x >= viewportWidth) {
			width = Math.max(
				viewportWidth,
				Math.min(Math.ceil(rect.x + rect.width), page.width, MAX_SCREENSHOT_WIDTH),
			);
		} else if (rect.x + rect.width <= 0) {
			// The page's scrollable width reaches leftwards from the viewport's right edge.
			x = Math.min(
				0,
				Math.max(
					Math.floor(rect.x),
					viewportWidth - page.width,
					viewportWidth - MAX_SCREENSHOT_WIDTH,
				),
			);
			width = viewportWidth - x;
		}

		const height = bottom - y;

		screenshots.push(
			x < 0
				? await captureLeftwards(
						adaptor,
						{ x, y, width, height },
						{ x: 0, y, width: viewportWidth, height },
						scale,
					)
				: await adaptor.screenshotClip({ x, y, width, height }, scale),
		);
	}

	return screenshots;
}

/**
 * Capture a clip that starts left of the document origin, where a right-to-left page keeps its
 * overflow. Chromium only renders that area while the window is scrolled into it, so the window is
 * scrolled to the clip's edge for the capture and put back afterwards. An engine that refuses a clip
 * at negative x gets the ordinary viewport-wide clip instead, so evidence is never the reason an
 * audit fails.
 */
async function captureLeftwards(
	adaptor: ReflowAuditAdaptor,
	clip: { x: number; y: number; width: number; height: number },
	fallback: { x: number; y: number; width: number; height: number },
	scale: number,
): Promise<Uint8Array> {
	const previous = await adaptor.evaluate(scrollWindowToScript, clip.x, null);
	let screenshot: Uint8Array | undefined;

	try {
		screenshot = await adaptor.screenshotClip(clip, scale);
	} catch {
		// Fall through to the fallback clip, taken once the scroll position is back.
	} finally {
		await adaptor.evaluate(scrollWindowToScript, previous.x, previous.y);
	}

	return screenshot ?? adaptor.screenshotClip(fallback, scale);
}

const SCROLLING_REASONS = new Set<ReflowMeasureOffender["reason"]>([
	"element-overflow",
	"text-overflow",
]);

function bucketFor(measure: ReflowMeasure, unsettled: boolean): ReflowBucket {
	if (unsettled) {
		return "incomplete";
	}

	const overflow = measure.documentOverflowPx;

	// Nothing scrolls sideways, but content that is cut off or parked in a sideways scroller may
	// still be out of reach: that needs a person to look.
	if (overflow <= ROUNDING_TOLERANCE) {
		return measure.offenders.length > 0 ? "incomplete" : "pass";
	}

	if (overflow <= SCROLLBAR_TOLERANCE) {
		return "incomplete";
	}

	if (measure.offenders.some((offender) => SCROLLING_REASONS.has(offender.reason))) {
		return "violation";
	}

	const needsReview = measure.offenders.some(
		(offender) => offender.reason !== "fixed-width-container",
	);

	return measure.explainedByExempt && !needsReview ? "pass" : "incomplete";
}

/**
 * Narrow the page to 320 CSS pixels (unless it is already that narrow), wait for layout to settle,
 * and measure whether content requires two-dimensional scrolling. The incoming viewport is restored
 * in a `finally` block even if measurement throws. An already-narrow page is measured as soon as
 * its layout holds still, with no resize to wait out.
 */
export async function runReflowAudit(
	adaptor: ReflowAuditAdaptor,
	options: ReflowOptions = {},
): Promise<ReflowResult> {
	const settleDelayMs = options.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;
	const settleAttempts = options.settleAttempts ?? DEFAULT_SETTLE_ATTEMPTS;
	const minSettleMs = options.minSettleMs ?? DEFAULT_MIN_SETTLE_MS;
	const screenshotClipBuffer = options.screenshotClipBuffer ?? DEFAULT_SCREENSHOT_CLIP_BUFFER;
	const screenshotLimit = options.screenshotLimit ?? DEFAULT_SCREENSHOT_LIMIT;
	const original = await adaptor.getViewport();
	const alreadyNarrow = original.width <= REFLOW_WIDTH;
	const measureViewport = alreadyNarrow
		? { ...original }
		: {
				width: REFLOW_WIDTH,
				height: Math.max(original.height, MIN_REFLOW_HEIGHT),
			};

	let restored = alreadyNarrow;
	let unsettled = false;
	let measure: ReflowMeasure = {
		documentOverflowPx: 0,
		explainedByExempt: false,
		offenders: [],
	};

	let screenshots: Array<Uint8Array | undefined> = [];

	try {
		if (!alreadyNarrow) {
			await adaptor.setViewport(measureViewport);
		}

		unsettled = await settle(
			adaptor,
			settleDelayMs,
			settleAttempts,
			alreadyNarrow ? 0 : minSettleMs,
		);
		measure = await adaptor.evaluate(measureReflowScript);

		// Screenshots must be captured here, at the narrow measurement viewport and before the
		// offending elements' rects go stale, not after the viewport restore below.
		screenshots = await captureOffenderScreenshots(
			adaptor,
			measure.offenders,
			measureViewport.width,
			screenshotClipBuffer,
			screenshotLimit,
		);
	} finally {
		if (!alreadyNarrow) {
			await adaptor.setViewport(original);
			restored = true;
		}
	}

	const offenders: ReflowOffender[] = measure.offenders.map((offender, index) => ({
		selector: offender.selector,
		html: truncateHtml(offender.html),
		overflowPx: offender.overflowPx,
		reason: offender.reason,
		rect: offender.rect,
		...(offender.overflowing
			? {
					overflowing: offender.overflowing.map((content) => ({
						...content,
						html: truncateHtml(content.html),
					})),
				}
			: {}),
		screenshot: screenshots[index],
	}));

	return {
		viewport: measureViewport,
		restored,
		unsettled,
		alreadyNarrow,
		documentOverflowPx: measure.documentOverflowPx,
		bucket: bucketFor(measure, unsettled),
		offenders,
	};
}
