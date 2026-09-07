export type TextSpacingFindingKind = "clipped" | "truncation-increased" | "overlap";

export type TextSpacingRect = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type CandidateSnapshot = {
	index: number;
	selector: string;
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
};

export type TextSpacingElementResult = {
	selector: string;
	html: string;
	kind: TextSpacingFindingKind;
	metrics: { beforeOverflowPx: number; afterOverflowPx: number };
	overlapsWith?: string;
	/**
	 * PNG bytes of the element with WCAG 1.4.12 spacing overrides applied. Omitted past
	 * `screenshotLimit`.
	 */
	screenshot?: Uint8Array;
};

export type TextSpacingResult = {
	findings: TextSpacingElementResult[];
	candidateCount: number;
	restored: boolean;
	summary: { clipped: number; truncationIncreased: number; overlaps: number };
};
