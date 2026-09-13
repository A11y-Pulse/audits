import type { ReflowOffender, ReflowResult } from "@a11y-pulse/reflow-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	toResult,
} from "./audit-output";

export const REFLOW_AUDIT_ID = "reflow";

export const REFLOW_EVIDENCE_CHECK_ID = "reflow-evidence";

const METADATA: AuditMetadata = {
	id: REFLOW_AUDIT_ID,
	help: "Content must reflow without two-dimensional scrolling",
	description:
		"Ensures that content can be presented at a width equivalent to 320 CSS pixels without requiring two-dimensional scrolling, as required by WCAG 1.4.10 Reflow.",
	helpUrl: "https://github.com/A11y-Pulse/audits/tree/main/packages/reflow-audit#readme",
	impact: "serious",
	tags: ["wcag21aa", "wcag1410", "cat.structure"],
};

function failureSummary(offender: ReflowOffender): string {
	if (offender.reason === "fixed-width-container") {
		return "Element has a fixed width that exceeds the 320px reflow viewport. Use fluid widths or max-width so content fits without requiring horizontal scrolling.";
	}

	return `Element is overflowing the viewport by ${offender.overflowPx}px. Ensure elements are resized and text is wrapped so that users do not have to scroll horizontally to view content.`;
}

function toAuditNode(offender: ReflowOffender, failed: boolean): AuditNode {
	const node: AuditNode = { selector: offender.selector, html: offender.html };

	if (failed) {
		node.failureSummary = failureSummary(offender);
	}

	if (offender.screenshot) {
		node.evidence = {
			id: REFLOW_EVIDENCE_CHECK_ID,
			impact: "serious",
			message: "Element overflows the 320px reflow viewport",
			data: { screenshot: offender.screenshot },
		};
	}

	return node;
}

export function reflowToAxe(result: ReflowResult): AuditOutput {
	const failed = result.bucket !== "pass";
	const audit = toResult(
		METADATA,
		result.offenders.map((offender) => toAuditNode(offender, failed)),
	);

	switch (result.bucket) {
		case "violation":
			return { ...emptyOutput(), violations: [audit] };
		case "incomplete":
			return { ...emptyOutput(), incomplete: [audit] };
		case "pass":
			return { ...emptyOutput(), passes: [audit] };
	}
}
