import type { ContextChangeFinding } from "./context-change";
import type { ObscuredMeasurement } from "./obscuring";

export type DetectionMethod = "style" | "pixel-diff";

export type FocusElementResult = {
	/** Selector for the focused element (see getSelector). */
	selector: string;

	/** Truncated opening tag; the internal marker attribute is already stripped. */
	html: string;

	/** 1-based tab stop at which this element was reached. */
	tabIndex: number;

	/**
	 * Whether a visible focus indicator was detected. Only meaningful when
	 * `appearanceMeasured` is true; context-only rows set this to false.
	 */
	passed: boolean;

	/** How the indicator was detected, or null when failed / not measured. */
	detectionMethod: DetectionMethod | null;

	/**
	 * Whether focus-appearance (2.4.7) indicator detection ran for this stop.
	 * False for context-only early exits (F55, navigation, focus theft) that
	 * must not inflate `summary.checked` / `passed` / `failed`.
	 */
	appearanceMeasured: boolean;

	/** Focus-not-obscured (2.4.11) measurement, when measured. */
	obscured?: ObscuredMeasurement | null;

	/** Context-change-on-focus (3.2.1) findings for this tab stop, when any. */
	contextChange?: ContextChangeFinding[];
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
		/**
		 * True if the tab loop stopped because a focus-triggered navigation
		 * destroyed the browsing context.
		 */
		abortedForNavigation: boolean;
		obscured: {
			checked: number;
			/** Fully covered by a verified-opaque author overlay (2.4.11 violation). */
			violations: number;
			/** Offscreen after focus, or full cover with unknown opacity. */
			incomplete: number;
		};
		contextChange: {
			checked: number;
			violations: number;
			incomplete: number;
		};
	};
};
