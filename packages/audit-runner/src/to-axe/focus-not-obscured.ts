import type {
	FocusNotObscuredElementResult,
	FocusNotObscuredResult,
} from "@a11y-pulse/focus-not-obscured-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	toResult,
} from "./audit-output";

export const FOCUS_NOT_OBSCURED_AUDIT_ID = "focus-not-obscured";

export const FOCUS_NOT_OBSCURED_EVIDENCE_CHECK_ID = "focus-not-obscured-evidence";

const METADATA: AuditMetadata = {
	id: FOCUS_NOT_OBSCURED_AUDIT_ID,
	help: "Focused elements must not be entirely hidden by author-created content",
	description:
		"Ensures that when a user interface component receives keyboard focus it is not entirely hidden by author-created content, as required by WCAG 2.4.11 Focus Not Obscured (Minimum).",
	helpUrl:
		"https://github.com/A11y-Pulse/audits/tree/main/packages/focus-not-obscured-audit#readme",
	impact: "serious",
	tags: ["wcag22aa", "wcag2411", "cat.keyboard"],
};

function failureSummary(element: FocusNotObscuredElementResult): string {
	const cover = element.measurement.obscuredBy?.selector;
	const coverLabel = cover ? `\`${cover}\`` : "author-created content";

	return `Focused element is completely hidden behind ${coverLabel} (tab stop #${element.tabIndex}). Ensure focused elements are not hidden behind sticky headers, footers, or other overlays.`;
}

function toAuditNode(element: FocusNotObscuredElementResult, failed: boolean): AuditNode {
	const node: AuditNode = { selector: element.selector, html: element.html };

	if (failed) {
		node.failureSummary = failureSummary(element);
	}

	if (element.screenshot) {
		node.evidence = {
			id: FOCUS_NOT_OBSCURED_EVIDENCE_CHECK_ID,
			impact: "serious",
			message: "Focused element is hidden behind author-created content",
			data: { screenshot: element.screenshot },
		};
	}

	return node;
}

function toAuditResult(elements: FocusNotObscuredElementResult[], failed: boolean) {
	return toResult(
		METADATA,
		elements.map((element) => toAuditNode(element, failed)),
	);
}

export function focusNotObscuredToAxe(result: FocusNotObscuredResult): AuditOutput {
	const violations = result.elements.filter((element) => element.bucket === "violation");
	const incomplete = result.elements.filter((element) => element.bucket === "incomplete");
	const passes = result.elements.filter((element) => element.bucket === "pass");

	return {
		...emptyOutput(),
		violations: violations.length > 0 ? [toAuditResult(violations, true)] : [],
		incomplete: incomplete.length > 0 ? [toAuditResult(incomplete, true)] : [],
		passes: passes.length > 0 ? [toAuditResult(passes, false)] : [],
	};
}
