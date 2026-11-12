import { bufferedClip } from "@a11y-pulse/browser-adaptor";
import { truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import type { TextSpacingAuditAdaptor } from "./adaptor";
import {
	applyOverrideScript,
	collectBaselineScript,
	type DescribePayload,
	describeFindingsScript,
	type ElementDescription,
	FREEZE_CSS,
	findOverlapPairs,
	MAX_TEXT_RECTS,
	OVERRIDE_CSS,
	restoreAndVerifyScript,
} from "./browser-scripts";
import type {
	CandidateSnapshot,
	TextSpacingAxis,
	TextSpacingElementResult,
	TextSpacingFindingKind,
	TextSpacingRect,
	TextSpacingResult,
} from "./result";

export type { CandidateSnapshot } from "./result";

export const DEFAULT_CANDIDATE_LIMIT = 500;
export const DEFAULT_CLIP_TOLERANCE_PX = 2;
export const DEFAULT_SETTLE_MS = 0;
export const DEFAULT_SCREENSHOT_CLIP_BUFFER = 10;
export const DEFAULT_SCREENSHOT_LIMIT = 10;

// A clipping element can be most of the page. Evidence that falls back to it is capped to this.
const MAX_FALLBACK_SCREENSHOT_PX = 1000;

export type TextSpacingOptions = {
	/** Max visible text containers to measure, in document order. Defaults to 500. */
	candidateLimit?: number;
	/** Overflow in px that must be exceeded to count as clipping. Defaults to 2. */
	clipTolerancePx?: number;
	/**
	 * Extra wait once the layout has stopped changing after the overrides are applied, for pages
	 * that react late. Defaults to 0.
	 */
	settleMs?: number;
	/** Padding around a finding's box when clipping its screenshot. Defaults to 10. */
	screenshotClipBuffer?: number;
	/** Max findings to screenshot (each is a real page.screenshot() call). Defaults to 10. */
	screenshotLimit?: number;
};

export type ClassifyOptions = {
	clipTolerancePx?: number;
};

/**
 * A finding before its elements have been described. `index` and `otherIndex` identify candidates;
 * `clipperIndex` identifies the page-side clipping element.
 */
export type ClassifiedFinding = {
	kind: TextSpacingFindingKind;
	index: number;
	clipperIndex: number | null;
	otherIndex: number | null;
	axis?: TextSpacingAxis;
	affectedCount: number;
	metrics: TextSpacingElementResult["metrics"];
	overlapRect?: TextSpacingRect;
};

function mergeAxis(a: TextSpacingAxis | undefined, b: TextSpacingAxis): TextSpacingAxis {
	return a === undefined || a === b ? b : "both";
}

/**
 * Diff baseline vs post-override measurements. Text cut off by the same element is one finding,
 * reported against the text that loses the most. Pure: no browser, no adaptor.
 */
export function classifyCandidates(
	baseline: CandidateSnapshot[],
	after: CandidateSnapshot[],
	options: ClassifyOptions = {},
): ClassifiedFinding[] {
	const clipTolerancePx = options.clipTolerancePx ?? DEFAULT_CLIP_TOLERANCE_PX;
	const afterByIndex = new Map(after.map((candidate) => [candidate.index, candidate]));
	const groups = new Map<string, ClassifiedFinding>();

	for (const before of baseline) {
		if (before.unstable) {
			continue;
		}

		const next = afterByIndex.get(before.index);

		if (!next || next.unstable) {
			continue;
		}

		if (before.truncated) {
			const beforeOverflowPx = before.truncationOverflowPx;
			const afterOverflowPx = next.truncationOverflowPx;

			if (afterOverflowPx - beforeOverflowPx <= clipTolerancePx) {
				continue;
			}

			const key = `truncation:${before.truncatorIndex ?? `candidate-${before.index}`}`;
			const group = groups.get(key);

			if (group) {
				group.affectedCount++;
			} else {
				groups.set(key, {
					kind: "truncation-increased",
					index: before.index,
					clipperIndex: before.truncatorIndex,
					otherIndex: null,
					affectedCount: 1,
					metrics: { beforeOverflowPx, afterOverflowPx },
				});
			}

			continue;
		}

		// Text that was already cut off is not the override's doing, however much more is lost.
		const hitX = before.clippedXPx <= clipTolerancePx && next.clippedXPx > clipTolerancePx;
		const hitY = before.clippedYPx <= clipTolerancePx && next.clippedYPx > clipTolerancePx;

		if (!hitX && !hitY) {
			continue;
		}

		const useY = hitY && (!hitX || next.clippedYPx >= next.clippedXPx);
		const axis: TextSpacingAxis = hitX && hitY ? "both" : hitX ? "horizontal" : "vertical";
		const clipperIndex = useY ? next.clipperYIndex : next.clipperXIndex;
		const metrics = {
			beforeOverflowPx: useY ? before.clippedYPx : before.clippedXPx,
			afterOverflowPx: useY ? next.clippedYPx : next.clippedXPx,
		};
		const key = `clipped:${clipperIndex ?? `candidate-${before.index}`}`;
		const group = groups.get(key);

		if (!group) {
			groups.set(key, {
				kind: "clipped",
				index: before.index,
				clipperIndex,
				otherIndex: null,
				axis,
				affectedCount: 1,
				metrics,
			});
			continue;
		}

		group.affectedCount++;
		group.axis = mergeAxis(group.axis, axis);

		if (metrics.afterOverflowPx > group.metrics.afterOverflowPx) {
			group.index = before.index;
			group.metrics = metrics;
		}
	}

	const findings = [...groups.values()];

	for (const pair of findOverlapPairs(baseline, after)) {
		findings.push({
			kind: "overlap",
			index: pair.index,
			clipperIndex: null,
			otherIndex: pair.otherIndex,
			affectedCount: 1,
			metrics: {
				beforeOverflowPx: 0,
				afterOverflowPx: 0,
				beforeOverlapAreaPx2: pair.beforeAreaPx2,
				afterOverlapAreaPx2: pair.afterAreaPx2,
			},
			overlapRect: pair.rect,
		});
	}

	return findings;
}

/**
 * Diff baseline vs post-override measurements into findings, taking each selector and html from
 * the snapshots. Pure: no browser, no adaptor.
 */
export function classifyTextSpacing(
	baseline: CandidateSnapshot[],
	after: CandidateSnapshot[],
	options: ClassifyOptions = {},
): TextSpacingElementResult[] {
	const byIndex = new Map(baseline.map((candidate) => [candidate.index, candidate]));

	return classifyCandidates(baseline, after, options).map((finding) => {
		const source = byIndex.get(finding.index);
		const result: TextSpacingElementResult = {
			selector: source?.selector ?? "",
			html: source?.html ?? "",
			kind: finding.kind,
			metrics: finding.metrics,
		};

		if (finding.kind === "overlap") {
			result.overlapsWith =
				finding.otherIndex === null ? "" : (byIndex.get(finding.otherIndex)?.selector ?? "");
			result.overlapRect = finding.overlapRect;

			return result;
		}

		if (finding.axis) {
			result.axis = finding.axis;
		}

		result.affectedCount = finding.affectedCount;

		return result;
	});
}

function intersect(a: TextSpacingRect, b: TextSpacingRect): TextSpacingRect | null {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const width = Math.min(a.x + a.width, b.x + b.width) - x;
	const height = Math.min(a.y + a.height, b.y + b.height) - y;

	return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function union(a: TextSpacingRect, b: TextSpacingRect): TextSpacingRect {
	const x = Math.min(a.x, b.x);
	const y = Math.min(a.y, b.y);

	return {
		x,
		y,
		width: Math.max(a.x + a.width, b.x + b.width) - x,
		height: Math.max(a.y + a.height, b.y + b.height) - y,
	};
}

/**
 * The region that shows a finding: both elements of an overlap, or a clipped element where it is
 * still visible, which puts the edge that cuts it off in frame.
 */
function evidenceRegion(
	finding: ClassifiedFinding,
	element: ElementDescription,
	clipper: ElementDescription | undefined,
	other: ElementDescription | undefined,
): TextSpacingRect {
	if (finding.kind === "overlap") {
		return other ? union(element.rect, other.rect) : element.rect;
	}

	if (!clipper) {
		return element.rect;
	}

	const visible = intersect(element.rect, clipper.rect);

	if (visible) {
		return visible;
	}

	// The text has been pushed out of its clipping box altogether, so show the box it left.
	return {
		x: clipper.rect.x,
		y: clipper.rect.y,
		width: Math.min(clipper.rect.width, MAX_FALLBACK_SCREENSHOT_PX),
		height: Math.min(clipper.rect.height, MAX_FALLBACK_SCREENSHOT_PX),
	};
}

function byIndex(descriptions: ElementDescription[]): Map<number, ElementDescription> {
	return new Map(descriptions.map((description) => [description.index, description]));
}

/**
 * Look up the elements behind each finding and screenshot up to `limit` of them while the spacing
 * overrides are still applied (the state that demonstrates the defect). Elements are matched by
 * their index on the page, never by selector, which two elements can share.
 */
async function describeFindings(
	adaptor: TextSpacingAuditAdaptor,
	classified: ClassifiedFinding[],
	clipBuffer: number,
	limit: number,
): Promise<TextSpacingElementResult[]> {
	if (classified.length === 0) {
		return [];
	}

	const elementIndexes = new Set<number>();
	const clipperIndexes = new Set<number>();

	for (const finding of classified) {
		elementIndexes.add(finding.index);

		if (finding.otherIndex !== null) {
			elementIndexes.add(finding.otherIndex);
		}

		if (finding.clipperIndex !== null) {
			clipperIndexes.add(finding.clipperIndex);
		}
	}

	const described: DescribePayload = await adaptor.evaluate(describeFindingsScript, {
		elements: [...elementIndexes],
		clippers: [...clipperIndexes],
	});
	const elements = byIndex(described.elements);
	const clippers = byIndex(described.clippers);
	const scale = adaptor.screenshotClipScale ?? 1;
	const findings: TextSpacingElementResult[] = [];
	let screenshots = 0;

	for (const finding of classified) {
		const element = elements.get(finding.index);

		if (!element) {
			continue;
		}

		const clipper = finding.clipperIndex === null ? undefined : clippers.get(finding.clipperIndex);
		const other = finding.otherIndex === null ? undefined : elements.get(finding.otherIndex);

		// Text nobody can see (a closed menu faded out with `opacity`) cannot be seen to overlap.
		if (finding.kind === "overlap" && (element.visible === false || other?.visible === false)) {
			continue;
		}

		const result: TextSpacingElementResult = {
			selector: element.selector,
			html: truncateHtml(element.html),
			kind: finding.kind,
			metrics: finding.metrics,
			rect: element.rect,
		};

		if (finding.kind === "overlap") {
			result.overlapsWith = other?.selector ?? "";
			result.overlapsWithHtml = other ? truncateHtml(other.html) : undefined;
			result.overlapRect = finding.overlapRect;
		} else {
			if (finding.axis) {
				result.axis = finding.axis;
			}

			result.affectedCount = finding.affectedCount;

			if (clipper) {
				result.clippedBy = clipper.selector;
				result.clippedByHtml = truncateHtml(clipper.html);
			}
		}

		if (screenshots < limit) {
			screenshots++;
			result.screenshot = await adaptor.screenshotClip(
				bufferedClip(
					evidenceRegion(finding, element, clipper, other),
					described.page.width,
					described.page.height,
					clipBuffer,
				),
				scale,
			);
		}

		findings.push(result);
	}

	return findings;
}

/**
 * Apply WCAG 1.4.12 spacing overrides, measure candidate text containers, and restore injected
 * styles. Classification of clipped vs growth-only vs truncation vs overlap is
 * `classifyCandidates`.
 */
export async function runTextSpacingAudit(
	adaptor: TextSpacingAuditAdaptor,
	options: TextSpacingOptions = {},
): Promise<TextSpacingResult> {
	const candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
	const clipTolerancePx = options.clipTolerancePx ?? DEFAULT_CLIP_TOLERANCE_PX;
	const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
	const screenshotClipBuffer = options.screenshotClipBuffer ?? DEFAULT_SCREENSHOT_CLIP_BUFFER;
	const screenshotLimit = options.screenshotLimit ?? DEFAULT_SCREENSHOT_LIMIT;

	let restored = false;
	let findings: TextSpacingElementResult[] = [];
	let candidateCount = 0;
	let truncated = false;

	try {
		const baseline = await adaptor.evaluate(collectBaselineScript, {
			limit: candidateLimit,
			freezeCss: FREEZE_CSS,
			overrideCss: OVERRIDE_CSS,
			maxTextRects: MAX_TEXT_RECTS,
		});
		const after = await adaptor.evaluate(applyOverrideScript, settleMs);

		candidateCount = baseline.candidates.filter((candidate) => !candidate.unstable).length;
		truncated = baseline.limitReached === true;

		// Evidence must be captured here, while the spacing overrides are still applied, not after
		// the restore below.
		findings = await describeFindings(
			adaptor,
			classifyCandidates(baseline.candidates, after.candidates, { clipTolerancePx }),
			screenshotClipBuffer,
			screenshotLimit,
		);
	} finally {
		try {
			restored = (await adaptor.evaluate(restoreAndVerifyScript)).restored;
		} catch {
			restored = false;
		}
	}

	return {
		findings,
		candidateCount,
		truncated,
		restored,
		summary: {
			clipped: findings.filter((finding) => finding.kind === "clipped").length,
			truncationIncreased: findings.filter((finding) => finding.kind === "truncation-increased")
				.length,
			overlaps: findings.filter((finding) => finding.kind === "overlap").length,
		},
	};
}
