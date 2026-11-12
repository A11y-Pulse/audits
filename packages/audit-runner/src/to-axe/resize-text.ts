import type { ResizeTextElementResult, ResizeTextResult } from "@a11y-pulse/resize-text-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	evidenceCheck,
	inconclusiveOutput,
	toResult,
} from "./audit-output";

export const RESIZE_TEXT_AUDIT_ID = "resize-text";

export const RESIZE_TEXT_EVIDENCE_CHECK_ID = "resize-text-evidence";

const METADATA: AuditMetadata = {
	id: RESIZE_TEXT_AUDIT_ID,
	help: "Text must remain readable when the page is zoomed to 200%",
	description:
		"Ensures that text is not cut off and does not overlap other text when the page is zoomed to 200%, as WCAG 1.4.4 requires.",
	helpUrl: "https://github.com/A11y-Pulse/audits/tree/main/packages/resize-text-audit#readme",
	impact: "serious",
	tags: ["wcag2aa", "wcag144", "cat.sensory-and-visual-cues"],
};

function zoomNote(result: ResizeTextResult): string {
	return result.viewportMeta?.blocksZoom
		? ` The page's viewport meta tag (${result.viewportMeta.content}) also stops users zooming.`
		: "";
}

function failureSummary(element: ResizeTextElementResult, result: ResizeTextResult): string {
	if (element.kind === "overlap") {
		return `Text overlaps ${element.overlapsWith || "another element"} when the page is zoomed to 200%. Let text containers grow or wrap so that text does not overlap when zoomed.${zoomNote(result)}`;
	}

	const clippedPx = Math.round(element.metrics.afterOverflowPx);
	const by = element.clippedBy ? ` by ${element.clippedBy}` : "";
	const others =
		element.affectedCount !== undefined && element.affectedCount > 1
			? ` along with ${element.affectedCount - 1} other piece${element.affectedCount === 2 ? "" : "s"} of text`
			: "";

	if (element.noBaseline) {
		return `Text that the page only shows when zoomed to 200% is cut off by ${clippedPx}px${by}${others}. It is not shown at full size, so there was nothing to compare it with: check whether it is cut off wherever this layout is used. Let text containers grow so that content is not clipped.${zoomNote(result)}`;
	}

	return `Text is cut off by ${clippedPx}px${by}${others} when the page is zoomed to 200%. Let text containers grow so that content is not clipped when zoomed.${zoomNote(result)}`;
}

function toAuditNode(element: ResizeTextElementResult, result: ResizeTextResult): AuditNode {
	const node: AuditNode = {
		selector: element.selector,
		html: element.html,
		failureSummary: failureSummary(element, result),
	};

	node.evidence = evidenceCheck(
		RESIZE_TEXT_EVIDENCE_CHECK_ID,
		"serious",
		element.kind === "overlap"
			? "Text overlaps other text when the page is zoomed to 200%"
			: "Text is cut off when the page is zoomed to 200%",
		{
			...element,
			selector: undefined,
			html: undefined,
			viewportMeta: result.viewportMeta,
		},
	);

	return node;
}

/**
 * Text a fixed-height box cuts through is the confident signal; the rest needs a person to look.
 * So does text that was not shown at full size, which may be cut off with or without the zoom.
 */
function isViolation(element: ResizeTextElementResult): boolean {
	return element.kind === "clipped" && element.axis !== "horizontal" && !element.noBaseline;
}

export function resizeTextToAxe(result: ResizeTextResult): AuditOutput {
	if (result.candidateCount === 0) {
		return { ...emptyOutput(), inapplicable: [toResult(METADATA, [])] };
	}

	// A layout that was still moving when it was measured cannot be trusted to fail anything.
	const violations = result.unsettled ? [] : result.findings.filter(isViolation);
	const needsReview = result.findings.filter((finding) => !violations.includes(finding));

	if (violations.length === 0 && needsReview.length === 0) {
		// Finding nothing in part of a page is not the page passing.
		if (result.truncated) {
			return inconclusiveOutput(
				METADATA,
				"the page has more text than the audit measures. The text it measured was unaffected; the rest was not checked.",
			);
		}

		return { ...emptyOutput(), passes: [toResult(METADATA, [])] };
	}

	const nodes = (findings: ResizeTextElementResult[]): AuditNode[] =>
		findings.map((finding) => toAuditNode(finding, result));

	return {
		...emptyOutput(),
		violations: violations.length > 0 ? [toResult(METADATA, nodes(violations))] : [],
		incomplete: needsReview.length > 0 ? [toResult(METADATA, nodes(needsReview))] : [],
	};
}

/**
 * The audit was not run because the viewport is too narrow to halve: a phone-sized viewport is
 * not what 200% zoom is tested from.
 */
export function resizeTextInapplicable(): AuditOutput {
	return { ...emptyOutput(), inapplicable: [toResult(METADATA, [])] };
}
