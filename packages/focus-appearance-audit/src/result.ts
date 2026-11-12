import type { BaseAuditSummary } from "@a11y-pulse/tab-orchestrator";

import type { StyleSnapshot } from "./detection";

/**
 * How a focus indicator was detected.
 *
 * - `style`: computed styles changed on focus (on the element, or see `indicatorOn`).
 * - `pixel-diff`: the focused and unfocused screenshots differ.
 * - `caret`: nothing changed except that a text field shows its text caret. See `needsReview`.
 */
export type DetectionMethod = "style" | "pixel-diff" | "caret";

/**
 * Why a result is neither a clear pass nor a clear failure.
 *
 * - `caret`: the only visible sign of focus is the blinking text caret of a text field.
 * - `obstructed`: something else on the page covered the element while it was measured, so the
 *   screenshots could not show whether it has an indicator.
 * - `shared-indicator`: the only change on focus is on an ancestor or label that holds other tab
 *   stops too (a `:focus-within` input group), which shows that focus is somewhere inside it but
 *   not on which element.
 * - `animating`: an animation was running on an ancestor or label while the element was measured,
 *   so the differences seen may be the animation and not a focus indicator.
 */
export type NeedsReviewReason = "caret" | "obstructed" | "shared-indicator" | "animating";

/**
 * How an indicator was detected, or the evidence captured when none was found.
 */
export type IndicatorDetection =
	| { method: DetectionMethod }
	| {
			method: null;
			focusedScreenshot: Uint8Array;
			unfocusedScreenshot: Uint8Array;
			focusedStyles: StyleSnapshot;
			unfocusedStyles: StyleSnapshot;
	  };

/** Evidence captured when no focus indicator was detected. */
export type FocusFailureEvidence = {
	/** PNG of the element (and clip padding) while focused. */
	focusedScreenshot: Uint8Array;
	/** PNG of the same clip region after blur. */
	unfocusedScreenshot: Uint8Array;
	/** Allowlisted computed styles while focused. */
	focusedStyles: StyleSnapshot;
	/**
	 * Allowlisted computed styles in the unfocused baseline. Empty when the element was not in the
	 * baseline set (e.g. reached via Tab but unmarked).
	 */
	unfocusedStyles: StyleSnapshot;
};
export type ColorOnlyChange = {
	/** Which colour changed: the text, the border, the outline or the background. */
	property: "color" | "border-color" | "outline-color" | "background-color";
	unfocusedColor: string;
	focusedColor: string;
	/**
	 * Null when either colour is translucent or not in `rgb()` notation, so cannot be measured. For a
	 * background that is see-through in one state, the colour behind the element stands in for it
	 * when that is known (see `backgroundColor`).
	 */
	contrastRatio: number | null;
	/**
	 * The background the colours are seen against, when it could be told: the element's own
	 * background colour, or else the nearest opaque one behind it. For a background change it is
	 * only present when one of the two colours is see-through, as the colour that shows through.
	 */
	backgroundColor?: string;
	/**
	 * PNGs of the element while focused and after blur. Only captured when `contrastRatio` is under
	 * `MIN_LIGHTNESS_CONTRAST` or null.
	 */
	evidence?: { focusedScreenshot: Uint8Array; unfocusedScreenshot: Uint8Array };
};

/**
 * How well a detected focus indicator stands out from the colours next to it (WCAG 1.4.11 Non-text
 * Contrast). Separate from whether an indicator exists: it never changes `passed`.
 */
export type IndicatorContrast = {
	/**
	 * The contrast ratio between the indicator and the colour next to it, or null when it could not
	 * be determined (see `reason`). Where the indicator has more than one neighbour (a border lies
	 * between the element's fill and its surroundings), this is the higher ratio: standing out from
	 * one of them is enough to be seen.
	 */
	ratio: number | null;

	/**
	 * The contrast between the indicator's colour and how the same part looked without focus, when
	 * that part was already drawn (a recoloured border or background) or was read from pixels. For
	 * information only: 1.4.11 does not ask for it, and it never decides a result.
	 */
	stateChangeRatio?: number;

	/**
	 * How the colours were found: from computed styles, or from the pixels that differ between the
	 * focused and unfocused screenshots.
	 */
	method: "style" | "pixels";

	/** The part of the indicator that was measured, for `method: "style"`. */
	property?: "outline" | "border" | "box-shadow" | "background-color";

	/** The indicator's colour. */
	indicatorColor?: string;

	/** The colour the indicator was compared with. */
	adjacentColor?: string;

	/**
	 * What `adjacentColor` is: the background around the element (`surroundings`), the element's own
	 * fill (`own-background`: for an inset shadow, an outline with a negative `outline-offset`, or a
	 * border that stands out from the fill more than from the surroundings), or the unchanged pixels
	 * next to the changed ones in the focused screenshot (`adjacent-pixels`).
	 */
	comparedAgainst?: "surroundings" | "own-background" | "adjacent-pixels";

	/**
	 * Why the ratio is null.
	 *
	 * - `translucent`: a colour is translucent or not in `rgb()` notation, or the shadow is a soft glow.
	 * - `background-image`: the indicator sits on the element's background image or gradient.
	 * - `background-unresolved`: a background image, gradient or translucent colour is behind the
	 *   element, or the element is positioned over other content, and the screenshots did not settle it.
	 * - `too-small`: too few pixels changed to take a colour from.
	 * - `noisy`: the changed pixels, or the pixels next to them, have no single dominant colour.
	 * - `transitioning`: the indicator was still animating in when it measured under 3:1, so the
	 *   colours seen are not its final ones.
	 */
	reason?:
		| "translucent"
		| "background-image"
		| "background-unresolved"
		| "too-small"
		| "noisy"
		| "transitioning";

	/**
	 * PNGs of the element while focused and after blur. Only captured when the ratio is under
	 * `MIN_INDICATOR_CONTRAST`, for elements within `screenshotLimit`.
	 */
	evidence?: { focusedScreenshot: Uint8Array; unfocusedScreenshot: Uint8Array };
};

export type FocusElementResult = {
	/** Selector for the focused element (see getSelector). */
	selector: string;

	/** Truncated opening tag; the internal marker attribute is already stripped. */
	html: string;

	/** 1-based tab stop at which this element was reached. */
	tabIndex: number;

	/**
	 * Whether a visible focus indicator was detected. Read together with `needsReview`: a result
	 * that needs review is not a clear pass or failure whichever way this is set.
	 */
	passed: boolean;

	/** How the indicator was detected, or null when none was. */
	detectionMethod: DetectionMethod | null;

	/**
	 * Present when a person should look at this element. `caret` comes with `passed: true`; the other
	 * reasons come with `passed: false`.
	 */
	needsReview?: NeedsReviewReason;

	/**
	 * The painted properties that changed on focus, for `detectionMethod: "style"`. Pseudo-element
	 * properties are prefixed, e.g. `::after background-color`.
	 */
	changedProperties?: string[];

	/**
	 * Present when the style change was found on something other than the element: an ancestor (a
	 * `:focus-within` wrapper) or one of its labels.
	 */
	indicatorOn?: { kind: "ancestor" | "label"; html: string };

	/**
	 * What the screenshots were taken of when it was not the element: the element draws nothing
	 * itself (the hidden input of a custom checkbox, radio or switch), so its label or nearest
	 * visible ancestor was compared instead.
	 */
	measuredOn?: "label" | "parent";

	/** Present when no indicator was detected, for the first `screenshotLimit` such elements. */
	failureEvidence?: FocusFailureEvidence;

	/** Present when the only painted change on focus is one colour. */
	colorOnly?: ColorOnlyChange;

	/**
	 * The contrast of the detected indicator against the colours next to it, when it is one that can
	 * be measured: an outline, border, box-shadow or background fill, or a difference found in the
	 * screenshots. Absent for the browser's default focus ring.
	 */
	indicatorContrast?: IndicatorContrast;
};

export type FocusAppearanceSummary = BaseAuditSummary & {
	/** Elements whose result needs a person to look at it. Counted in neither `passed` nor `failed`. */
	needsReview: number;

	/**
	 * Elements whose indicator was measured at under `MIN_INDICATOR_CONTRAST` (3:1) against the
	 * colours next to it. An element whose only focus change is one colour, with a measured
	 * `colorOnly.contrastRatio`, is judged by that instead and is not counted here.
	 */
	lowContrastIndicators: number;

	/** Whether elements past `screenshotLimit` were recorded without their screenshots. */
	reachedScreenshotLimit: boolean;
};

export type FocusAppearanceResult = {
	/** Every focusable element that was checked, in tab order. */
	elements: FocusElementResult[];
	summary: FocusAppearanceSummary;
};
