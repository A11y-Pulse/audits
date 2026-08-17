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
	 * Allowlisted computed styles in the unfocused baseline. Empty when the
	 * element was not in the baseline set (e.g. reached via Tab but unmarked).
	 */
	unfocusedStyles: StyleSnapshot;
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
};

export type FocusAppearanceResult = {
	/** Every focusable element that was checked, in tab order. */
	elements: FocusElementResult[];
	summary: {
		checked: number;
		passed: number;
		failed: number;
		/** True if the element limit was hit before tabbing finished. */
		reachedLimit: boolean;
		/** True if the audit stopped early after hitting `failedElementLimit`. */
		reachedFailedElementLimit: boolean;
		/**
		 * True if the audit returned early because `timeout` elapsed. The results
		 * are whatever had been gathered when the deadline hit.
		 */
		timedOut: boolean;
	};
};
