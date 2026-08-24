import { bufferedClip } from "@a11y-pulse/browser-adaptor";
import { truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import type { TextSpacingAuditAdaptor } from "./adaptor";
import {
	collectBaselineScript,
	findOverlapPairs,
	injectOverrideScript,
	pageDimensionsScript,
	remeasureScript,
	restoreAndVerifyScript,
	waitTwoFramesScript,
} from "./browser-scripts";
import type {
	CandidateSnapshot,
	TextSpacingElementResult,
	TextSpacingResult,
} from "./result";

export type { CandidateSnapshot } from "./result";

export const DEFAULT_CANDIDATE_LIMIT = 500;
export const DEFAULT_CLIP_TOLERANCE_PX = 2;
export const DEFAULT_SETTLE_MS = 200;
export const DEFAULT_SCREENSHOT_CLIP_BUFFER = 10;
export const DEFAULT_SCREENSHOT_LIMIT = 10;

export type TextSpacingOptions = {
	/** Max visible text containers to measure, in document order. Defaults to 500. */
	candidateLimit?: number;
	/** Overflow in px that must be exceeded to count as clipping. Defaults to 2. */
	clipTolerancePx?: number;
	/** Extra wait after two animation frames for layout to settle. Defaults to 200. */
	settleMs?: number;
	/** Padding around a finding's box when clipping its screenshot. Defaults to 10. */
	screenshotClipBuffer?: number;
	/** Max findings to screenshot (each is a real page.screenshot() call). Defaults to 10. */
	screenshotLimit?: number;
};

export type ClassifyOptions = {
	clipTolerancePx?: number;
};

function delay(ms: number): Promise<void> {
	if (ms <= 0) {
		return Promise.resolve();
	}

	return new Promise((resolve) => {
		setTimeout(resolve, ms);
	});
}

async function settle(
	adaptor: TextSpacingAuditAdaptor,
	settleMs: number,
): Promise<void> {
	await adaptor.evaluate(waitTwoFramesScript);
	await delay(settleMs);
}

function axisOverflow(scroll: number, client: number): number {
	return Math.max(0, scroll - client);
}

function clips(overflow: string): boolean {
	return overflow === "hidden" || overflow === "clip";
}

function elementOverflow(metrics: CandidateSnapshot): number {
	return Math.max(
		axisOverflow(metrics.scrollWidth, metrics.clientWidth),
		axisOverflow(metrics.scrollHeight, metrics.clientHeight),
	);
}

function clippedFinding(
	before: CandidateSnapshot,
	after: CandidateSnapshot,
	clipTolerancePx: number,
): TextSpacingElementResult | null {
	const clipsX = clips(before.clipOverflowX);
	const clipsY = clips(before.clipOverflowY);

	if (!clipsX && !clipsY) {
		return null;
	}

	let beforeOverflowPx = 0;
	let afterOverflowPx = 0;
	let hit = false;

	if (clipsX) {
		const beforePx = axisOverflow(
			before.clipScrollWidth,
			before.clipClientWidth,
		);
		const afterPx = axisOverflow(after.clipScrollWidth, after.clipClientWidth);

		if (beforePx <= clipTolerancePx && afterPx > clipTolerancePx) {
			hit = true;
			beforeOverflowPx = Math.max(beforeOverflowPx, beforePx);
			afterOverflowPx = Math.max(afterOverflowPx, afterPx);
		}
	}

	if (clipsY) {
		const beforePx = axisOverflow(
			before.clipScrollHeight,
			before.clipClientHeight,
		);
		const afterPx = axisOverflow(
			after.clipScrollHeight,
			after.clipClientHeight,
		);

		if (beforePx <= clipTolerancePx && afterPx > clipTolerancePx) {
			hit = true;
			beforeOverflowPx = Math.max(beforeOverflowPx, beforePx);
			afterOverflowPx = Math.max(afterOverflowPx, afterPx);
		}
	}

	if (!hit) {
		return null;
	}

	return {
		selector: before.selector,
		html: before.html,
		kind: "clipped",
		metrics: { beforeOverflowPx, afterOverflowPx },
	};
}

/**
 * Diff baseline vs post-override metrics. Pure: no browser, no adaptor.
 */
export function classifyTextSpacing(
	baseline: CandidateSnapshot[],
	after: CandidateSnapshot[],
	options: ClassifyOptions = {},
): TextSpacingElementResult[] {
	const clipTolerancePx = options.clipTolerancePx ?? DEFAULT_CLIP_TOLERANCE_PX;
	const afterByIndex = new Map(
		after.map((candidate) => [candidate.index, candidate]),
	);
	const findings: TextSpacingElementResult[] = [];

	for (const before of baseline) {
		if (before.unstable) {
			continue;
		}

		const next = afterByIndex.get(before.index);

		if (!next || next.unstable) {
			continue;
		}

		if (before.truncated) {
			const beforeOverflowPx = elementOverflow(before);
			const afterOverflowPx = elementOverflow(next);

			if (afterOverflowPx - beforeOverflowPx > clipTolerancePx) {
				findings.push({
					selector: before.selector,
					html: before.html,
					kind: "truncation-increased",
					metrics: { beforeOverflowPx, afterOverflowPx },
				});
			}

			continue;
		}

		const clipped = clippedFinding(before, next, clipTolerancePx);

		if (clipped) {
			findings.push(clipped);
		}
	}

	for (const pair of findOverlapPairs(baseline, after)) {
		const source = baseline.find(
			(candidate) => candidate.selector === pair.selector,
		);

		findings.push({
			selector: pair.selector,
			html: source?.html ?? "",
			kind: "overlap",
			metrics: { beforeOverflowPx: 0, afterOverflowPx: 0 },
			overlapsWith: pair.overlapsWith,
		});
	}

	return findings;
}

/**
 * Screenshot up to `limit` findings, showing the element with spacing overrides
 * still applied (the state that demonstrates the defect), clipped to its `after`
 * box plus `clipBuffer`. A finding whose selector no longer matches an `after`
 * candidate, or past the limit, gets `undefined` rather than being dropped, so
 * index alignment with `findings` is preserved.
 */
async function captureFindingScreenshots(
	adaptor: TextSpacingAuditAdaptor,
	findings: TextSpacingElementResult[],
	afterCandidates: CandidateSnapshot[],
	clipBuffer: number,
	limit: number,
): Promise<Array<Uint8Array | undefined>> {
	if (findings.length === 0) {
		return [];
	}

	const { width: pageWidth, height: pageHeight } =
		await adaptor.evaluate(pageDimensionsScript);
	const afterBySelector = new Map(
		afterCandidates.map((candidate) => [candidate.selector, candidate]),
	);
	const scale = adaptor.screenshotClipScale ?? 1;

	const screenshots: Array<Uint8Array | undefined> = [];

	for (let i = 0; i < findings.length; i++) {
		const candidate = afterBySelector.get(findings[i]!.selector);

		if (i >= limit || !candidate) {
			screenshots.push(undefined);
			continue;
		}

		const clip = bufferedClip(
			candidate.rect,
			pageWidth,
			pageHeight,
			clipBuffer,
		);
		screenshots.push(await adaptor.screenshotClip(clip, scale));
	}

	return screenshots;
}

/**
 * Apply WCAG 1.4.12 spacing overrides, measure candidate text containers, and
 * restore injected styles. Classification of clipped vs growth-only vs
 * truncation vs overlap is `classifyTextSpacing`.
 */
export async function runTextSpacingAudit(
	adaptor: TextSpacingAuditAdaptor,
	options: TextSpacingOptions = {},
): Promise<TextSpacingResult> {
	const candidateLimit = options.candidateLimit ?? DEFAULT_CANDIDATE_LIMIT;
	const clipTolerancePx = options.clipTolerancePx ?? DEFAULT_CLIP_TOLERANCE_PX;
	const settleMs = options.settleMs ?? DEFAULT_SETTLE_MS;
	const screenshotClipBuffer =
		options.screenshotClipBuffer ?? DEFAULT_SCREENSHOT_CLIP_BUFFER;
	const screenshotLimit = options.screenshotLimit ?? DEFAULT_SCREENSHOT_LIMIT;

	let restored = false;
	let findings: TextSpacingElementResult[] = [];
	let candidateCount = 0;

	try {
		const baseline = await adaptor.evaluate(
			collectBaselineScript,
			candidateLimit,
		);

		await adaptor.evaluate(injectOverrideScript);
		await settle(adaptor, settleMs);

		const after = await adaptor.evaluate(remeasureScript);
		candidateCount = baseline.candidates.filter(
			(candidate) => !candidate.unstable,
		).length;
		const classified = classifyTextSpacing(
			baseline.candidates,
			after.candidates,
			{ clipTolerancePx },
		);

		// Screenshots must be captured here, while the spacing overrides are
		// still applied, not after the restore below.
		const screenshots = await captureFindingScreenshots(
			adaptor,
			classified,
			after.candidates,
			screenshotClipBuffer,
			screenshotLimit,
		);

		findings = classified.map((finding, index) => ({
			...finding,
			html: truncateHtml(finding.html),
			screenshot: screenshots[index],
		}));
	} finally {
		try {
			const verify = await adaptor.evaluate(restoreAndVerifyScript);
			await settle(adaptor, settleMs);
			restored = verify.restored;
		} catch {
			restored = false;
		}
	}

	return {
		findings,
		candidateCount,
		restored,
		summary: {
			clipped: findings.filter((finding) => finding.kind === "clipped").length,
			truncationIncreased: findings.filter(
				(finding) => finding.kind === "truncation-increased",
			).length,
			overlaps: findings.filter((finding) => finding.kind === "overlap").length,
		},
	};
}
