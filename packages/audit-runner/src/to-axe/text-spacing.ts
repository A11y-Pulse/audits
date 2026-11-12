import type { TextSpacingElementResult, TextSpacingResult } from "@a11y-pulse/text-spacing-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	evidenceCheck,
	inconclusiveOutput,
	toResult,
} from "./audit-output";

export const TEXT_SPACING_AUDIT_ID = "text-spacing";

export const TEXT_SPACING_EVIDENCE_CHECK_ID = "text-spacing-evidence";

const METADATA: AuditMetadata = {
	id: TEXT_SPACING_AUDIT_ID,
	help: "Text must remain readable when spacing is increased",
	description:
		"Ensures that text remains readable when line height, paragraph spacing, letter spacing, and word spacing are increased to the WCAG 1.4.12 minima.",
	helpUrl: "https://github.com/A11y-Pulse/audits/tree/main/packages/text-spacing-audit#readme",
	impact: "serious",
	tags: ["wcag21aa", "wcag1412", "cat.structure"],
};

function overflowDelta(element: TextSpacingElementResult): number {
	return Math.round(element.metrics.afterOverflowPx - element.metrics.beforeOverflowPx);
}

function failureSummary(element: TextSpacingElementResult): string {
	if (element.kind === "overlap") {
		return `Text overlaps ${element.overlapsWith ?? "another element"} when line height, letter spacing, and word spacing are increased. Ensure text containers can grow so that text does not overlap when spacing is increased.`;
	}

	if (element.kind === "truncation-increased") {
		return `Truncation increases by ${overflowDelta(element)}px when line height, letter spacing, and word spacing are increased. Ensure truncated text remains readable when spacing is increased.`;
	}

	return `Content is clipped by ${overflowDelta(element)}px when line height, letter spacing, and word spacing are increased. Let text containers grow so that content is not clipped when spacing is increased.`;
}

function toAuditNode(element: TextSpacingElementResult): AuditNode {
	const node: AuditNode = {
		selector: element.selector,
		html: element.html,
		failureSummary: failureSummary(element),
	};

	node.evidence = evidenceCheck(
		TEXT_SPACING_EVIDENCE_CHECK_ID,
		"serious",
		element.kind === "overlap"
			? "Text overlaps other text when spacing is increased"
			: "Text is cut off when spacing is increased",
		{
			kind: element.kind,
			axis: element.axis,
			metrics: element.metrics,
			rect: element.rect,
			clippedBy: element.clippedBy,
			clippedByHtml: element.clippedByHtml,
			affectedCount: element.affectedCount,
			overlapsWith: element.overlapsWith,
			overlapsWithHtml: element.overlapsWithHtml,
			overlapRect: element.overlapRect,
			screenshot: element.screenshot,
		},
	);

	return node;
}

export function textSpacingToAxe(result: TextSpacingResult): AuditOutput {
	if (result.candidateCount === 0) {
		return { ...emptyOutput(), inapplicable: [toResult(METADATA, [])] };
	}

	const clipped = result.findings.filter((finding) => finding.kind === "clipped");
	const needsReview = result.findings.filter((finding) => finding.kind !== "clipped");

	if (clipped.length === 0 && needsReview.length === 0) {
		// Finding nothing in part of a page is not the page passing.
		if (result.truncated) {
			return inconclusiveOutput(
				METADATA,
				`the page has more text than the audit measures. The ${result.candidateCount} pieces of text it measured were unaffected; the rest was not checked.`,
			);
		}

		return { ...emptyOutput(), passes: [toResult(METADATA, [])] };
	}

	return {
		...emptyOutput(),
		violations: clipped.length > 0 ? [toResult(METADATA, clipped.map(toAuditNode))] : [],
		incomplete: needsReview.length > 0 ? [toResult(METADATA, needsReview.map(toAuditNode))] : [],
	};
}
