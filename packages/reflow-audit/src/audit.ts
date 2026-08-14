import type { ReflowAuditAdaptor } from "./adaptor";
import {
	type LayoutFingerprint,
	MIN_REFLOW_HEIGHT,
	measureReflowScript,
	REFLOW_WIDTH,
	type ReflowMeasure,
	ROUNDING_TOLERANCE,
	readLayoutFingerprintScript,
	SCROLLBAR_TOLERANCE,
} from "./browser-scripts";
import type { ReflowBucket, ReflowOffender, ReflowResult } from "./result";
import { truncateHtml } from "./truncate-html";

export const DEFAULT_SETTLE_DELAY_MS = 50;
export const DEFAULT_SETTLE_ATTEMPTS = 10;

export type ReflowOptions = {
	/** Delay between layout-fingerprint readings while waiting for the page to settle. */
	settleDelayMs?: number;
	/** Max fingerprint readings before measuring anyway and marking the result unsettled. */
	settleAttempts?: number;
};

function delay(ms: number): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}

	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function fingerprintsEqual(
	left: LayoutFingerprint,
	right: LayoutFingerprint,
): boolean {
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
 * Narrow the page to 320 CSS pixels (unless it is already that narrow), wait for
 * layout to settle, and measure whether content requires two-dimensional scrolling.
 * The incoming viewport is restored in a `finally` block even if measurement throws.
 */
export async function runReflowAudit(
	adaptor: ReflowAuditAdaptor,
	options: ReflowOptions = {},
): Promise<ReflowResult> {
	const settleDelayMs = options.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;
	const settleAttempts = options.settleAttempts ?? DEFAULT_SETTLE_ATTEMPTS;
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

	try {
		if (!alreadyNarrow) {
			await adaptor.setViewport(measureViewport);
		}

		unsettled = await settle(adaptor, settleDelayMs, settleAttempts);
		measure = await adaptor.evaluate(measureReflowScript);
	} finally {
		if (!alreadyNarrow) {
			await adaptor.setViewport(original);
			await settle(adaptor, settleDelayMs, settleAttempts);
			restored = true;
		}
	}

	const offenders: ReflowOffender[] = measure.offenders.map((offender) => ({
		...offender,
		html: truncateHtml(offender.html),
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
