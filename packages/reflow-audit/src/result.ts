import type { Rect } from "@a11y-pulse/browser-adaptor";
import type { ReflowOffenderReason, ReflowOverflowingContent } from "./browser-scripts";

export type ReflowBucket = "pass" | "violation" | "incomplete";

export type { ReflowOffenderReason, ReflowOverflowingContent };

export type ReflowOffender = {
	selector: string;
	html: string;
	overflowPx: number;
	reason: ReflowOffenderReason;
	/**
	 * Box of the offending element, or of its overflowing text for `text-overflow`, in CSS pixels
	 * relative to the document at the measurement viewport.
	 */
	rect: Rect;
	/**
	 * `scrolling-container` only: the outermost content inside the scroller that is wider than it
	 * (the first five), so the thing that fails to reflow is named and not just its container.
	 */
	overflowing?: ReflowOverflowingContent[];
	/**
	 * PNG bytes of the offender's row of the page at the measurement viewport. The clip is the
	 * viewport's width, widened only as far as needed to show an offender that lies wholly beyond
	 * it, on either side. Omitted past `screenshotLimit`.
	 */
	screenshot?: Uint8Array;
};

export type ReflowResult = {
	viewport: { width: number; height: number };
	restored: boolean;
	unsettled: boolean;
	alreadyNarrow: boolean;
	documentOverflowPx: number;
	bucket: ReflowBucket;
	offenders: ReflowOffender[];
};
