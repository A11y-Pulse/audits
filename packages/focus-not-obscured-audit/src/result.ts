import type { BaseAuditSummary, ObscuredMeasurement } from "@a11y-pulse/tab-orchestrator";

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
	 * The AA bucket for this element. `"violation"` fails 2.4.11; `"incomplete"` means the audit
	 * could not confirm one way or the other (offscreen, or fully covered by something of unknown
	 * opacity); `"pass"` covers both unobscured elements and partial/semi-transparent covers, which
	 * are not failures under the Minimum criterion.
	 */
	bucket: ObscuringBucket;

	/**
	 * How a hidden element was found. Absent when it was hidden where the browser left it on being
	 * tabbed to. `"scrolled-to-top"` when it passed there, but is hidden once scrolled to the top
	 * edge of the viewport, which is where the browser puts it when focus moves up the page to it
	 * (Shift+Tab). `measurement` and `screenshot` then describe the scrolled position.
	 */
	foundBy?: "scrolled-to-top";

	/**
	 * PNG bytes of a strip the width of the viewport around this element, with the element's box
	 * outlined so it can be located behind whatever covers it. Only captured for a non-"pass"
	 * bucket, and omitted past `screenshotLimit`.
	 */
	screenshot?: Uint8Array;
};

export type FocusNotObscuredResult = {
	/** Every focusable element that was checked, in tab order. */
	elements: FocusNotObscuredElementResult[];
	summary: BaseAuditSummary & {
		/** Elements re-measured after being scrolled to the top edge of the viewport. */
		scrolledToTopChecked: number;
	};
};
