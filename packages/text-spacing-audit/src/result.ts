export type TextSpacingFindingKind = "clipped" | "truncation-increased" | "overlap";

export type TextSpacingAxis = "horizontal" | "vertical" | "both";

/** A box in document coordinates (CSS px from the top left of the page, not of the viewport). */
export type TextSpacingRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type CandidateSnapshot = {
	index: number;
	/** Empty in snapshots taken by the audit, which only looks selectors up for findings. */
	selector: string;
	/** Empty in snapshots taken by the audit, as for `selector`. */
	html: string;
	scrollWidth: number;
	scrollHeight: number;
	clientWidth: number;
	clientHeight: number;
	rect: TextSpacingRect;
	overflowX: string;
	overflowY: string;
	clipScrollWidth: number;
	clipScrollHeight: number;
	clipClientWidth: number;
	clipClientHeight: number;
	clipOverflowX: string;
	clipOverflowY: string;
	truncated: boolean;
	unstable: boolean;
	fontSize: number;
	position: string;
	/** One box per rendered line of the element's own text, capped per element. */
	textRects: TextSpacingRect[];
	/**
	 * Those lines as far as the element's clipping and scrolling ancestors leave them showing. Lines
	 * hidden altogether are left out.
	 */
	visibleTextRects?: TextSpacingRect[];
	/** How far the element's text extends past what its clipping ancestors leave visible. */
	clippedXPx: number;
	clippedYPx: number;
	/** Page-side index of the ancestor (or the element itself) clipping on each axis, if any. */
	clipperXIndex: number | null;
	clipperYIndex: number | null;
	/** Page-side index of the element whose ellipsis or line clamp already truncates this text. */
	truncatorIndex: number | null;
	/** Scroll overflow of that truncating element. */
	truncationOverflowPx: number;
};

export type TextSpacingElementResult = {
	selector: string;
	html: string;
	kind: TextSpacingFindingKind;
	/**
	 * `clipped`: how far the text extends past its clipping box. `truncation-increased`: scroll
	 * overflow of the truncating element. `overlap`: both zero; see the overlap areas.
	 */
	metrics: {
		beforeOverflowPx: number;
		afterOverflowPx: number;
		/** `overlap` only: area the two elements' text shared before and after, in px². */
		beforeOverlapAreaPx2?: number;
		afterOverlapAreaPx2?: number;
	};
	/** The element's box with spacing applied. */
	rect?: TextSpacingRect;
	/** `clipped` only: the direction in which text is cut off. */
	axis?: TextSpacingAxis;
	/**
	 * `clipped` and `truncation-increased`: selector of the element doing the clipping. It is the
	 * finding's own element when that clips its own text.
	 */
	clippedBy?: string;
	clippedByHtml?: string;
	/**
	 * `clipped` and `truncation-increased`: how many text containers the same clipping element cuts
	 * off. They are reported once, against the worst affected.
	 */
	affectedCount?: number;
	overlapsWith?: string;
	overlapsWithHtml?: string;
	/** `overlap` only: the largest region the two elements' text shares. */
	overlapRect?: TextSpacingRect;
	/**
	 * PNG bytes of the finding with WCAG 1.4.12 spacing overrides applied: the element where it is
	 * cut off, or both overlapping elements. Omitted past `screenshotLimit`.
	 */
	screenshot?: Uint8Array;
};

export type TextSpacingResult = {
	findings: TextSpacingElementResult[];
	candidateCount: number;
	/** True when the page has more text containers than `candidateLimit`, so some went unmeasured. */
	truncated: boolean;
	restored: boolean;
	summary: { clipped: number; truncationIncreased: number; overlaps: number };
};
