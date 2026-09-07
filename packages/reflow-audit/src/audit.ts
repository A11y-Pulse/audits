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
} from "./browser-scripts";
import type { ReflowBucket, ReflowOffender, ReflowResult } from "./result";

export const DEFAULT_SETTLE_DELAY_MS = 50;
export const DEFAULT_SETTLE_ATTEMPTS = 10;
export const DEFAULT_SCREENSHOT_CLIP_BUFFER = 10;
export const DEFAULT_SCREENSHOT_LIMIT = 10;

export type ReflowOptions = {
	/** Delay between layout-fingerprint readings while waiting for the page to settle. */
	settleDelayMs?: number;
	/** Max fingerprint readings before measuring anyway and marking the result unsettled. */
	settleAttempts?: number;
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

async function settle(
	adaptor: ReflowAuditAdaptor,
	delayMs: number,
	attempts: number,
): Promise<boolean> {
	let previous: LayoutFingerprint | null = null;

	for (let i = 0; i < attempts; i++) {
		const current = await adaptor.evaluate(readLayoutFingerprintScript);

		if (previous && fingerprintsEqual(previous, current)) {
			return false;
		}

		previous = current;

		if (i < attempts - 1) {
			await delay(delayMs);
		}
	}

	return true;
}

/**
 * Screenshot up to `limit` offenders. Each clip always spans the full `viewportWidth` starting at
 * x=0, rather than a box around the offender: this frames the crop the same way the audit measured
 * it (a 320px-wide viewport), so an offender that extends past the edge is visibly cut off there
 * instead of being fully visible in a crop that just happens to be wider than the viewport. Each
 * clip is a real `page.screenshot()` call, so the count is bounded; offenders past the limit get
 * `undefined` rather than a truncated array, so index alignment with `offenders` is preserved.
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

	const { height: pageHeight } = await adaptor.evaluate(pageDimensionsScript);
	const scale = adaptor.screenshotClipScale ?? 1;

	const screenshots: Array<Uint8Array | undefined> = [];

	for (let i = 0; i < offenders.length; i++) {
		if (i >= limit) {
			screenshots.push(undefined);
			continue;
		}

		const { rect } = offenders[i]!;
		const y = Math.max(0, rect.y - clipBuffer);
		const bottom = Math.min(pageHeight, rect.y + rect.height + clipBuffer);

		screenshots.push(
			await adaptor.screenshotClip(
				{
					x: 0,
					y,
					width: viewportWidth,
					height: bottom - y,
				},
				scale,
			),
		);
	}

	return screenshots;
}

function bucketFor(measure: ReflowMeasure, unsettled: boolean): ReflowBucket {
	if (unsettled) {
		return "incomplete";
	}

	const overflow = measure.documentOverflowPx;
	const hasElementOverflow = measure.offenders.some(
		(offender) => offender.reason === "element-overflow",
	);
	const hasFixedWidth = measure.offenders.some(
		(offender) => offender.reason === "fixed-width-container",
	);

	if (overflow <= ROUNDING_TOLERANCE) {
		return hasFixedWidth ? "incomplete" : "pass";
	}

	if (overflow <= SCROLLBAR_TOLERANCE) {
		return "incomplete";
	}

	if (hasElementOverflow) {
		return "violation";
	}

	if (measure.explainedByExempt) {
		return "pass";
	}

	return "incomplete";
}

/**
 * Narrow the page to 320 CSS pixels (unless it is already that narrow), wait for layout to settle,
 * and measure whether content requires two-dimensional scrolling. The incoming viewport is restored
 * in a `finally` block even if measurement throws.
 */
export async function runReflowAudit(
	adaptor: ReflowAuditAdaptor,
	options: ReflowOptions = {},
): Promise<ReflowResult> {
	const settleDelayMs = options.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;
	const settleAttempts = options.settleAttempts ?? DEFAULT_SETTLE_ATTEMPTS;
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

		unsettled = await settle(adaptor, settleDelayMs, settleAttempts);
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
			await settle(adaptor, settleDelayMs, settleAttempts);
			restored = true;
		}
	}

	const offenders: ReflowOffender[] = measure.offenders.map((offender, index) => ({
		selector: offender.selector,
		html: truncateHtml(offender.html),
		overflowPx: offender.overflowPx,
		reason: offender.reason,
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
