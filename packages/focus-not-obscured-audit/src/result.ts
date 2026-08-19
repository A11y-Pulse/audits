import type {
	ObscuredMeasurement,
	SessionEndReason,
} from "@a11y-pulse/tab-orchestrator";

import type { ObscuringBucket } from "./classify";

export type FocusNotObscuredElementResult = {
	/** Selector for the focused element (see getSelector). */
	selector: string;

	/** Truncated opening tag; the internal marker attribute is already stripped. */
	html: string;

	/** 1-based tab stop at which this element was reached. */
	tabIndex: number;

	/** The raw obscuring measurement for this tab stop. */
	measurement: ObscuredMeasurement;

	/**
	 * The AA bucket for this element. `"violation"` fails 2.4.11; `"incomplete"`
	 * means the audit could not confirm one way or the other (offscreen, or
	 * fully covered by something of unknown opacity); `"pass"` covers both
	 * unobscured elements and partial/semi-transparent covers, which are not
	 * failures under the Minimum criterion.
	 */
	bucket: ObscuringBucket;
};

export type FocusNotObscuredResult = {
	/** Every focusable element that was checked, in tab order. */
	elements: FocusNotObscuredElementResult[];
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
		 * Why the tab session ended, or `null` when this consumer disconnected
		 * itself (element limit, failed-element limit, or timeout).
		 */
		sessionEnd: SessionEndReason | null;
	};
};
