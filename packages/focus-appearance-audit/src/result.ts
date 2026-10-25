import type { BaseAuditSummary } from "@a11y-pulse/tab-orchestrator";

import type { StyleSnapshot } from "./detection";

export type DetectionMethod = "style" | "pixel-diff";

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
	unfocusedColor: string;
	focusedColor: string;
	/** Null when either colour is translucent or not in `rgb()` notation, so cannot be measured. */
	contrastRatio: number | null;
	/**
	 * PNGs of the element while focused and after blur. Only captured when `contrastRatio` is under
	 * `MIN_LIGHTNESS_CONTRAST` or null.
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

	/** Whether a visible focus indicator was detected. */
	passed: boolean;

	/** How the indicator was detected, or null when the element failed. */
	detectionMethod: DetectionMethod | null;

	/** Present only when `passed` is false. */
	failureEvidence?: FocusFailureEvidence;

	/** Present when the only painted change on focus is the text colour. */
	colorOnly?: ColorOnlyChange;
};

export type FocusAppearanceResult = {
	/** Every focusable element that was checked, in tab order. */
	elements: FocusElementResult[];
	summary: BaseAuditSummary;
};
