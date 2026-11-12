import { bufferedClip } from "@a11y-pulse/browser-adaptor";
import { truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import {
	type CandidateSnapshot,
	collectBaselineScript,
	type DescribePayload,
	describeFindingsScript,
	type ElementDescription,
	FREEZE_CSS,
	findOverlapPairs,
	MAX_TEXT_RECTS,
	remeasureScript,
	restoreAndVerifyScript,
} from "@a11y-pulse/text-spacing-audit/measure";
import type { ResizeTextAuditAdaptor } from "./adaptor";
import {
	type LayoutFingerprint,
	readLayoutFingerprintScript,
	readViewportMetaScript,
} from "./browser-scripts";
import type {
	ResizeTextAxis,
	ResizeTextElementResult,
	ResizeTextFindingKind,
	ResizeTextRect,
	ResizeTextResult,
	ResizeTextViewport,
	ViewportMeta,
} from "./result";

export const DEFAULT_CANDIDATE_LIMIT = 500;
export const DEFAULT_CLIP_TOLERANCE_PX = 2;
export const DEFAULT_SETTLE_DELAY_MS = 50;
export const DEFAULT_SETTLE_ATTEMPTS = 20;
export const DEFAULT_MIN_SETTLE_MS = 300;
export const DEFAULT_SCREENSHOT_CLIP_BUFFER = 10;
export const DEFAULT_SCREENSHOT_LIMIT = 10;

/** 200% zoom halves the CSS viewport in both directions. */
export const ZOOM_FACTOR = 2;

// A clipping element can be most of the page. Evidence that falls back to it is capped to this.
const MAX_FALLBACK_SCREENSHOT_PX = 1000;

export type ResizeTextOptions = {
	/** Max visible text containers to measure, in document order. Defaults to 500. */
	candidateLimit?: number;
	/** Overflow in px that must be exceeded to count as clipping. Defaults to 2. */
	clipTolerancePx?: number;
	/** Delay between layout-fingerprint readings while waiting for the page to settle. */
	settleDelayMs?: number;
	/** Max fingerprint readings before measuring anyway and marking the result unsettled. */
	settleAttempts?: number;
	/**
	 * How long the layout must hold still at 200% before it is measured. Long enough by default
	 * (300ms) for a debounced `resize` handler to have swapped layouts.
	 */
	minSettleMs?: number;
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
	kind: ResizeTextFindingKind;
	index: number;
	clipperIndex: number | null;
	otherIndex: number | null;
	axis?: ResizeTextAxis;
	affectedCount: number;
	metrics: ResizeTextElementResult["metrics"];
	overlapRect?: ResizeTextRect;
	/** True when none of the text the finding counts was rendered before the resize. */
	noBaseline?: true;
};

function mergeAxis(a: ResizeTextAxis | undefined, b: ResizeTextAxis): ResizeTextAxis {
	return a === undefined || a === b ? b : "both";
}

function textExtent(candidate: CandidateSnapshot): { width: number; height: number } | null {
	if (candidate.textRects.length === 0) {
		return null;
	}

	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;

	for (const line of candidate.textRects) {
		minX = Math.min(minX, line.x);
		minY = Math.min(minY, line.y);
		maxX = Math.max(maxX, line.x + line.width);
		maxY = Math.max(maxY, line.y + line.height);
	}

	return { width: maxX - minX, height: maxY - minY };
}

type Group = {
	finding: ClassifiedFinding | null;
	/** Text containers the clipper hides entirely. They only count alongside a partly cut one. */
	hidden: number;
};

/**
 * Diff the measurements taken before and at 200% into findings. Pure: no browser, no adaptor.
 *
 * Text is `clipped` when it was whole before, and at 200% a clipping ancestor cuts into it while
 * leaving part of it showing. Text that is hidden outright (an off-canvas menu, a collapsed panel)
 * is a layout putting content away, not text being cut, and is not reported on its own. Text that
 * an ellipsis or line clamp truncates, before or at 200%, is skipped, as is anything that was
 * already cut off. Everything cut by the same element is one finding, against the worst affected
 * text.
 *
 * `after` may hold candidates the baseline does not: text that only the resized layout renders.
 * There is nothing to compare those with, so text among them that is cut into is reported with
 * `noBaseline`, unless the same element also cuts text that was whole before.
 */
export function classifyResizedText(
	baseline: CandidateSnapshot[],
	after: CandidateSnapshot[],
	options: ClassifyOptions = {},
): ClassifiedFinding[] {
	const tolerance = options.clipTolerancePx ?? DEFAULT_CLIP_TOLERANCE_PX;
	const baselineByIndex = new Map(baseline.map((candidate) => [candidate.index, candidate]));
	const groups = new Map<string, Group>();

	for (const next of after) {
		const before = baselineByIndex.get(next.index);

		if (next.unstable || next.truncated || before?.unstable || before?.truncated) {
			continue;
		}

		const extent = textExtent(next);

		if (!extent) {
			continue;
		}

		const hitX = (before?.clippedXPx ?? 0) <= tolerance && next.clippedXPx > tolerance;
		const hitY = (before?.clippedYPx ?? 0) <= tolerance && next.clippedYPx > tolerance;

		if (!hitX && !hitY) {
			continue;
		}

		const hiddenX = hitX && next.clippedXPx >= extent.width - tolerance;
		const hiddenY = hitY && next.clippedYPx >= extent.height - tolerance;
		const useY = hitY && (!hitX || next.clippedYPx >= next.clippedXPx);
		const clipperIndex = useY ? next.clipperYIndex : next.clipperXIndex;
		const key = `${clipperIndex ?? `candidate-${next.index}`}`;
		const group = groups.get(key) ?? { finding: null, hidden: 0 };

		groups.set(key, group);

		if (hiddenX || hiddenY) {
			group.hidden++;
			continue;
		}

		const axis: ResizeTextAxis = hitX && hitY ? "both" : hitX ? "horizontal" : "vertical";
		const metrics = {
			beforeOverflowPx: useY ? (before?.clippedYPx ?? 0) : (before?.clippedXPx ?? 0),
			afterOverflowPx: useY ? next.clippedYPx : next.clippedXPx,
		};

		if (!group.finding) {
			group.finding = {
				kind: "clipped",
				index: next.index,
				clipperIndex,
				otherIndex: null,
				axis,
				affectedCount: 1,
				metrics,
			};

			if (!before) {
				group.finding.noBaseline = true;
			}

			continue;
		}

		group.finding.affectedCount++;
		group.finding.axis = mergeAxis(group.finding.axis, axis);

		if (before) {
			delete group.finding.noBaseline;
		}

		if (metrics.afterOverflowPx > group.finding.metrics.afterOverflowPx) {
			group.finding.index = next.index;
			group.finding.metrics = metrics;
		}
	}

	const findings: ClassifiedFinding[] = [];

	for (const group of groups.values()) {
		if (group.finding) {
			group.finding.affectedCount += group.hidden;
			findings.push(group.finding);
		}
	}

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

function delay(ms: number): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}

	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

function fingerprintsEqual(left: LayoutFingerprint, right: LayoutFingerprint): boolean {
	return (
		left.innerWidth === right.innerWidth &&
		left.scrollWidth === right.scrollWidth &&
		left.scrollHeight === right.scrollHeight &&
		left.clientWidth === right.clientWidth &&
		left.bodyScrollHeight === right.bodyScrollHeight &&
		left.childCount === right.childCount
	);
}

/**
 * Wait until the layout fingerprint has held still for `minStableMs`. Resolves `true` when the
 * layout is still changing after `attempts` readings, meaning it never settled. The same wait the
 * reflow audit uses after its resize.
 */
async function settle(
	adaptor: ResizeTextAuditAdaptor,
	delayMs: number,
	attempts: number,
	minStableMs: number,
): Promise<boolean> {
	let previous: LayoutFingerprint | null = null;
	let stableSince = 0;

	for (let i = 0; ; i++) {
		const current = await adaptor.evaluate(readLayoutFingerprintScript);
		const now = Date.now();
		const stable = previous !== null && fingerprintsEqual(previous, current);

		if (stable && now - stableSince >= minStableMs) {
			return false;
		}

		if (!stable) {
			stableSince = now;
		}

		if (i >= attempts - 1 && !stable) {
			return true;
		}

		previous = current;
		await delay(Math.max(delayMs, i >= attempts - 1 ? 1 : 0));
	}
}

function intersect(a: ResizeTextRect, b: ResizeTextRect): ResizeTextRect | null {
	const x = Math.max(a.x, b.x);
	const y = Math.max(a.y, b.y);
	const width = Math.min(a.x + a.width, b.x + b.width) - x;
	const height = Math.min(a.y + a.height, b.y + b.height) - y;

	return width > 0 && height > 0 ? { x, y, width, height } : null;
}

function union(a: ResizeTextRect, b: ResizeTextRect): ResizeTextRect {
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
): ResizeTextRect {
	if (finding.kind === "overlap") {
		return other ? union(element.rect, other.rect) : element.rect;
	}

	if (!clipper) {
		return element.rect;
	}

	return (
		intersect(element.rect, clipper.rect) ?? {
			x: clipper.rect.x,
			y: clipper.rect.y,
			width: Math.min(clipper.rect.width, MAX_FALLBACK_SCREENSHOT_PX),
			height: Math.min(clipper.rect.height, MAX_FALLBACK_SCREENSHOT_PX),
		}
	);
}

function isHardClip(overflow: string): boolean {
	return overflow === "hidden" || overflow === "clip";
}

/**
 * Whether a finding still stands once its elements have been looked at in the resized layout: not
 * when the element is hidden (by `opacity`, say, which the measurement does not look at), nor when
 * the box said to clip it does not clip, or truncates its text on purpose.
 *
 * An overlap is not judged by `text-overflow` here. The measurement already compares text only as
 * far as its clipping ancestors leave it showing, which leaves out what an ellipsis cuts short
 * (on the element or on a wrapper) and keeps text whose `text-overflow` has nothing to act on.
 */
function standsUp(
	finding: ClassifiedFinding,
	element: ElementDescription,
	clipper: ElementDescription | undefined,
	other: ElementDescription | undefined,
): boolean {
	if (!element.visible) {
		return false;
	}

	if (finding.kind === "overlap") {
		return other?.visible === true;
	}

	if (!clipper) {
		return true;
	}

	if (clipper.truncates || !clipper.visible) {
		return false;
	}

	const clipsX = isHardClip(clipper.overflowX);
	const clipsY = isHardClip(clipper.overflowY);

	if (finding.axis === "horizontal") {
		return clipsX;
	}

	if (finding.axis === "vertical") {
		return clipsY;
	}

	return clipsX || clipsY;
}

function byIndex(descriptions: ElementDescription[]): Map<number, ElementDescription> {
	return new Map(descriptions.map((description) => [description.index, description]));
}

/**
 * Look up the elements behind each finding, drop the findings the resized layout explains, and
 * screenshot up to `limit` of the rest while the page is still at 200%. Elements are matched by
 * their index on the page, never by selector, which two elements can share.
 */
async function describeFindings(
	adaptor: ResizeTextAuditAdaptor,
	classified: ClassifiedFinding[],
	clipBuffer: number,
	limit: number,
): Promise<ResizeTextElementResult[]> {
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
	const findings: ResizeTextElementResult[] = [];
	let screenshots = 0;

	for (const finding of classified) {
		const element = elements.get(finding.index);

		if (!element) {
			continue;
		}

		const clipper = finding.clipperIndex === null ? undefined : clippers.get(finding.clipperIndex);
		const other = finding.otherIndex === null ? undefined : elements.get(finding.otherIndex);

		if (!standsUp(finding, element, clipper, other)) {
			continue;
		}

		const result: ResizeTextElementResult = {
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

			if (finding.noBaseline) {
				result.noBaseline = true;
			}

			if (clipper) {
				result.clippedBy = clipper.selector;
				result.clippedByHtml = truncateHtml(clipper.html);
				result.clippedByRect = clipper.rect;
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

function zoomedViewport(original: ResizeTextViewport): ResizeTextViewport {
	return {
		width: Math.max(1, Math.round(original.width / ZOOM_FACTOR)),
		height: Math.max(1, Math.round(original.height / ZOOM_FACTOR)),
	};
}

/**
 * Measure the page's text, halve the CSS viewport in both directions (what 200% browser zoom does
 * to the layout), let the layout settle, and measure again. Reports text that the resized layout
 * cuts off or lays over other text. The viewport and the page's styles are restored in a `finally`
 * block even if measurement throws.
 */
export async function runResizeTextAudit(
	adaptor: ResizeTextAuditAdaptor,
	options: ResizeTextOptions = {},
): Promise<ResizeTextResult> {
	const candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
	const clipTolerancePx = options.clipTolerancePx ?? DEFAULT_CLIP_TOLERANCE_PX;
	const settleDelayMs = options.settleDelayMs ?? DEFAULT_SETTLE_DELAY_MS;
	const settleAttempts = options.settleAttempts ?? DEFAULT_SETTLE_ATTEMPTS;
	const minSettleMs = options.minSettleMs ?? DEFAULT_MIN_SETTLE_MS;
	const screenshotClipBuffer = options.screenshotClipBuffer ?? DEFAULT_SCREENSHOT_CLIP_BUFFER;
	const screenshotLimit = options.screenshotLimit ?? DEFAULT_SCREENSHOT_LIMIT;
	const originalViewport = await adaptor.getViewport();
	const viewport = zoomedViewport(originalViewport);
	const viewportMeta: ViewportMeta | null = await adaptor.evaluate(readViewportMetaScript);

	let findings: ResizeTextElementResult[] = [];
	let candidateCount = 0;
	let truncated = false;
	let unsettled = false;
	let resized = false;
	let viewportRestored = true;
	let layoutRestored = false;

	try {
		const baseline = await adaptor.evaluate(collectBaselineScript, {
			limit: candidateLimit,
			freezeCss: FREEZE_CSS,
			overrideCss: "",
			maxTextRects: MAX_TEXT_RECTS,
		});

		candidateCount = baseline.candidates.filter((candidate) => !candidate.unstable).length;
		truncated = baseline.limitReached === true;

		resized = true;
		await adaptor.setViewport(viewport);
		unsettled = await settle(adaptor, settleDelayMs, settleAttempts, minSettleMs);

		// The resized layout can render text the full-size one does not (a mobile-only header) and
		// change what clips or truncates the rest, so candidates are collected again under it.
		const after = await adaptor.evaluate(remeasureScript, 0, true);

		truncated = truncated || after.limitReached === true;

		// Evidence must be captured here, while the page is still at 200%, not after the restore
		// below.
		findings = await describeFindings(
			adaptor,
			classifyResizedText(baseline.candidates, after.candidates, { clipTolerancePx }),
			screenshotClipBuffer,
			screenshotLimit,
		);
	} finally {
		if (resized) {
			try {
				await adaptor.setViewport(originalViewport);
				// The page's own resize handlers must have run before its layout is compared.
				await settle(adaptor, settleDelayMs, settleAttempts, minSettleMs);
			} catch {
				viewportRestored = false;
			}
		}

		try {
			layoutRestored = (await adaptor.evaluate(restoreAndVerifyScript)).restored;
		} catch {
			layoutRestored = false;
		}
	}

	return {
		findings,
		candidateCount,
		truncated,
		viewport,
		originalViewport,
		unsettled,
		restored: viewportRestored && layoutRestored,
		viewportMeta,
		summary: {
			clipped: findings.filter((finding) => finding.kind === "clipped").length,
			overlaps: findings.filter((finding) => finding.kind === "overlap").length,
		},
	};
}
