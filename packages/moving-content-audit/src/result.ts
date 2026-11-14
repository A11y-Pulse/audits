import type { Rect } from "@a11y-pulse/browser-adaptor";
import type { DetectedBy, MotionKind, MovingContentFinding } from "./classify";

export type MovingContentAnimation = {
	/** The `animation-name`, the animation's `id`, or null when it has neither. */
	name: string | null;
	/** Whether the animation repeats forever. */
	infinite: boolean;
	/** How long the animation runs across all its iterations, or null when it is infinite. */
	activeDurationMs: number | null;
	/** The CSS properties whose value changes over the animation. */
	properties: string[];
	/** The pseudo-element the animation runs on, such as `::after`, or null for the element. */
	pseudoElement: string | null;
};

export type MovingContentPauseControl = {
	/** Selector for the control (see getSelector). */
	selector: string;
	/** Truncated opening tag. */
	html: string;
	/** The control's label, as far as the audit read it. */
	name: string;
	/**
	 * `name`: a nearby button labelled pause, stop, play or hide. `attribute`: a nearby unlabelled
	 * control whose class or id says pause or stop. `page-control`: a control anywhere on the page
	 * that turns animation off.
	 */
	foundBy: "name" | "attribute" | "page-control";
};

export type MovingContentRegion = {
	/** Selector for the moving region (see getSelector). */
	selector: string;

	/** Truncated opening tag. */
	html: string;

	/** The visible part of the region, in document coordinates. */
	rect: Rect;

	/** What is moving. `script` is movement driven by a script changing the page. */
	motion: MotionKind;

	/**
	 * How the movement was found: `animation-api` from the page's running animations,
	 * `dom-observation` from watching elements change position, `element` for `<marquee>` and
	 * `media-element` for a playing `<video>`.
	 */
	detectedBy: DetectedBy;

	/** Why the region is in the list it is in. */
	finding: MovingContentFinding;

	/** How long into the observation window the region was last seen moving. */
	observedMs: number;

	/** The long-running animations on the region, for `css-animation` and `web-animation`. */
	animations: MovingContentAnimation[];

	/** The control found that can pause, stop or hide the movement, or null. */
	pauseControl: MovingContentPauseControl | null;

	/** States in which a stylesheet rule pauses the region's CSS animation. */
	pausesOn: ("hover" | "focus")[];

	/**
	 * Whether a `prefers-reduced-motion` rule applies to the region's CSS animation. Null when the
	 * movement is not a CSS animation, so the audit cannot tell. Supporting evidence only: the
	 * setting does not replace a way to pause.
	 */
	reducedMotion: boolean | null;

	/**
	 * PNG bytes of the region at the end of the observation window. Only captured for failed and
	 * needs-review regions, and omitted past `screenshotLimit`.
	 */
	screenshot?: Uint8Array;

	/** PNG bytes of the region `screenshotInterval` later, to compare with `screenshot`. */
	laterScreenshot?: Uint8Array;
};

export type MovingContentResult = {
	/** Large regions that kept moving past the observation window with no way to pause found. */
	failed: MovingContentRegion[];

	/** Moving regions where the evidence is weaker, for a human to check. */
	needsReview: MovingContentRegion[];

	/** Moving regions with a control that pauses, stops or hides them. */
	passed: MovingContentRegion[];

	/** How long the page was observed for. */
	observedMs: number;

	/** Full counts. */
	summary: {
		/** Moving regions examined, up to `regionLimit`. */
		checked: number;
		failed: number;
		needsReview: number;
		passed: number;
		/** Moving regions past `regionLimit`, which were not examined. */
		unchecked: number;
		/** Moving content the audit leaves alone. */
		ignored: {
			/** Progress indicators, status messages and busy regions. */
			essential: number;
			/** Regions smaller than `minRegionArea`. */
			tooSmall: number;
		};
	};
};
