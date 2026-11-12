export type ResizeTextFindingKind = "clipped" | "overlap";

export type ResizeTextAxis = "horizontal" | "vertical" | "both";

/** A box in document coordinates (CSS px from the top left of the page, not of the viewport). */
export type ResizeTextRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type ResizeTextViewport = { width: number; height: number };

/** The page's `<meta name="viewport">`, and whether it stops the user zooming to 200%. */
export type ViewportMeta = {
	content: string;
	html: string;
	/** False when `user-scalable` is `no` or `0`. */
	userScalable: boolean;
	/** The `maximum-scale` value, or null when the tag does not set one. */
	maximumScale: number | null;
	/** True when `user-scalable` is off or `maximum-scale` is below 2. */
	blocksZoom: boolean;
};

export type ResizeTextElementResult = {
	selector: string;
	html: string;
	kind: ResizeTextFindingKind;
	/**
	 * `clipped`: how far the text extends past its clipping box, before and at 200%. `overlap`: both
	 * zero; see the overlap areas.
	 */
	metrics: {
		beforeOverflowPx: number;
		afterOverflowPx: number;
		/** `overlap` only: area the two elements' text shared before and at 200%, in px². */
		beforeOverlapAreaPx2?: number;
		afterOverlapAreaPx2?: number;
	};
	/** The element's box at 200%. */
	rect: ResizeTextRect;
	/** `clipped` only: the direction in which text is cut off. */
	axis?: ResizeTextAxis;
	/**
	 * `clipped` only: selector, markup and box of the element doing the clipping. It is the finding's
	 * own element when that clips its own text.
	 */
	clippedBy?: string;
	clippedByHtml?: string;
	clippedByRect?: ResizeTextRect;
	/**
	 * `clipped` only: how many text containers the same clipping element cuts off or hides at 200%.
	 * They are reported once, against the worst affected that is still partly visible.
	 */
	affectedCount?: number;
	/**
	 * `clipped` only: true when the text was not rendered before the resize (a header that only the
	 * narrow layout shows), so there was no full-size measurement to compare with. The text is cut
	 * into at 200%, but it may be cut the same way wherever that layout is used.
	 */
	noBaseline?: true;
	overlapsWith?: string;
	overlapsWithHtml?: string;
	/** `overlap` only: the largest region the two elements' text shares. */
	overlapRect?: ResizeTextRect;
	/**
	 * PNG bytes of the finding at 200%: the element where it is cut off, or both overlapping
	 * elements. Omitted past `screenshotLimit`.
	 */
	screenshot?: Uint8Array;
};

export type ResizeTextResult = {
	findings: ResizeTextElementResult[];
	candidateCount: number;
	/**
	 * True when the page has more text containers than `candidateLimit`, at full size or at 200%, so
	 * some went unmeasured.
	 */
	truncated: boolean;
	/** The viewport the page was measured at: half the width and height it arrived with. */
	viewport: ResizeTextViewport;
	originalViewport: ResizeTextViewport;
	/** True when the layout was still changing at 200% when it was measured. */
	unsettled: boolean;
	/** True when the viewport was put back and the page's layout returned to what it was. */
	restored: boolean;
	/** Null when the page has no viewport meta tag. */
	viewportMeta: ViewportMeta | null;
	summary: { clipped: number; overlaps: number };
};
