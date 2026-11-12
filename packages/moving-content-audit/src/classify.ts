import type { CollectedRegion } from "./browser-scripts";

export type MotionKind = "video" | "marquee" | "css-animation" | "web-animation" | "script";

export type DetectedBy = "media-element" | "element" | "animation-api" | "dom-observation";

export type MovingContentFinding =
	/** Failed: a large region kept moving and nothing pauses it. */
	| "no-pause-control"
	/** Passed: a control that pauses, stops or hides the movement was found. */
	| "pause-control"
	/** Passed: the video has the browser's own controls. */
	| "native-controls"
	/** Review: the movement only pauses while hovered, which a keyboard user cannot do. */
	| "pauses-on-hover"
	/** Review: the movement pauses while focus is inside it. */
	| "pauses-on-focus"
	/** Review: the region is small enough that it may be decoration. */
	| "small-region"
	/** Review: the animation changes colour or shading, not position, size or visibility. */
	| "subtle-animation"
	/** Review: the region changed late in the window but was not seen to keep changing. */
	| "changed-once"
	/** Review: only a pseudo-element is animated, and its size could not be read. */
	| "pseudo-element"
	/** Review: the `<marquee>` stops by itself after a set number of loops. */
	| "finite-loop"
	/** Review: the video started during the window, or its length is unknown. */
	| "uncertain-playback";

export type Verdict = "failed" | "needsReview" | "passed";

export type Classification = {
	verdict: Verdict;
	finding: MovingContentFinding;
	motion: MotionKind;
	detectedBy: DetectedBy;
	observedMs: number;
};

export type ClassifyOptions = {
	/** How long the page was observed for. */
	observedMs: number;
	/** WCAG's limit: movement that stops within this long is allowed. */
	durationLimitMs: number;
	/** Regions at least this large can fail. */
	largeRegionArea: number;
	/**
	 * Changes further apart than this belong to separate bursts of movement. Defaults to a tenth of
	 * the window.
	 */
	quietGapMs?: number;
};

/** The quiet gap used when none is given, as a fraction of the observation window. */
export const QUIET_GAP_FRACTION = 0.1;

// Movement has to be seen this far into the window to count as still going.
const LATE_FRACTION = 0.6;

// One unbroken burst of movement counts as sustained when it lasts this much of the window.
const CONTINUOUS_FRACTION = 0.4;

// Properties whose animation moves, resizes, shows or hides something. An animation of anything
// else (colour, shadow, filter) is reported for review.
const MOTION_PROPERTY =
	/transform|translate|rotate|scale|^left$|^top$|^right$|^bottom$|inset|margin|padding|backgroundPosition|background-position|offset|width|height|opacity|visibility|clip|strokeDash|stroke-dash|^d$|^x$|^y$/i;

type Evidence = {
	motion: MotionKind;
	detectedBy: DetectedBy;
	/** Null when the evidence is strong. */
	doubt: MovingContentFinding | null;
	observedMs: number;
};

function videoEvidence(region: CollectedRegion, options: ClassifyOptions): Evidence | null {
	const video = region.video;

	if (!video) {
		return null;
	}

	const knownShort =
		!video.endless && video.durationS !== null && video.durationS * 1000 <= options.durationLimitMs;

	if (knownShort) {
		return null;
	}

	const certain =
		video.playingAtStart && video.advanced && (video.endless || video.durationS !== null);

	return {
		motion: "video",
		detectedBy: "media-element",
		doubt: certain ? null : "uncertain-playback",
		observedMs: options.observedMs,
	};
}

function marqueeEvidence(region: CollectedRegion, options: ClassifyOptions): Evidence | null {
	if (!region.marquee) {
		return null;
	}

	return {
		motion: "marquee",
		detectedBy: "element",
		doubt: region.marquee.loop > 0 ? "finite-loop" : null,
		observedMs: options.observedMs,
	};
}

function animationEvidence(region: CollectedRegion, options: ClassifyOptions): Evidence | null {
	if (region.animations.length === 0) {
		return null;
	}

	// An animation on the element itself, or on a pseudo-element known to be large, moves the
	// region. One on a pseudo-element of unknown size may be a cursor or a dot.
	const onRegion = region.animations.filter(
		(animation) =>
			animation.pseudoElement === null ||
			(animation.pseudoArea !== null && animation.pseudoArea >= options.largeRegionArea),
	);
	const moves = onRegion.some((animation) =>
		animation.properties.some((property) => MOTION_PROPERTY.test(property)),
	);

	return {
		motion: region.animations.some((animation) => animation.css)
			? "css-animation"
			: "web-animation",
		detectedBy: "animation-api",
		doubt: onRegion.length === 0 ? "pseudo-element" : moves ? null : "subtle-animation",
		observedMs: options.observedMs,
	};
}

/** Group sorted times into bursts: runs with no gap longer than `quietGapMs`. */
function burstsOf(times: readonly number[], quietGapMs: number): number[][] {
	const bursts: number[][] = [];

	for (const time of times) {
		const current = bursts.at(-1);

		if (current && time - current.at(-1)! <= quietGapMs) {
			current.push(time);
		} else {
			bursts.push([time]);
		}
	}

	return bursts;
}

function observationEvidence(region: CollectedRegion, options: ClassifyOptions): Evidence | null {
	const window = Math.max(options.observedMs, 1);
	const times = [...region.times].sort((a, b) => a - b);
	const last = times.at(-1);

	// Movement that stopped before the last part of the window had settled.
	if (last === undefined || last < window * LATE_FRACTION) {
		return null;
	}

	const bursts = burstsOf(times, options.quietGapMs ?? window * QUIET_GAP_FRACTION);
	const latest = bursts.at(-1)!;
	// Sustained movement comes back after a pause, like a carousel turning, or runs on without one,
	// like a ticker. A single short burst is one thing happening once: a banner sliding in, a slot
	// resizing, or one turn of a slow carousel.
	const sustained =
		bursts.length >= 2 || latest.at(-1)! - latest[0]! >= window * CONTINUOUS_FRACTION;

	if (!sustained) {
		// One sample is a single snap. And one burst from content that only arrived during the
		// window is that content settling in.
		if (latest.length < 2 || region.appeared) {
			return null;
		}
	}

	return {
		motion: "script",
		detectedBy: "dom-observation",
		doubt: sustained ? null : "changed-once",
		observedMs: Math.round(last),
	};
}

/**
 * Decide which list a moving region belongs in, or return null when the page facts do not show it
 * moving past the observation window.
 */
export function classifyRegion(
	region: CollectedRegion,
	options: ClassifyOptions,
): Classification | null {
	const all = [
		videoEvidence(region, options),
		marqueeEvidence(region, options),
		animationEvidence(region, options),
		observationEvidence(region, options),
	].filter((evidence): evidence is Evidence => evidence !== null);

	// Strong evidence first; within each, the order above.
	const evidence = all.find(({ doubt }) => doubt === null) ?? all[0];

	if (!evidence) {
		return null;
	}

	const { motion, detectedBy, observedMs } = evidence;
	const verdict = (verdict: Verdict, finding: MovingContentFinding): Classification => ({
		verdict,
		finding,
		motion,
		detectedBy,
		observedMs,
	});

	if (region.control) {
		return verdict("passed", "pause-control");
	}

	if (motion === "video" && region.video?.controls) {
		return verdict("passed", "native-controls");
	}

	if (evidence.doubt) {
		return verdict("needsReview", evidence.doubt);
	}

	if (motion === "css-animation" && region.pausesOn.includes("focus")) {
		return verdict("needsReview", "pauses-on-focus");
	}

	if (motion === "css-animation" && region.pausesOn.includes("hover")) {
		return verdict("needsReview", "pauses-on-hover");
	}

	if (region.rect.width * region.rect.height < options.largeRegionArea) {
		return verdict("needsReview", "small-region");
	}

	return verdict("failed", "no-pause-control");
}
