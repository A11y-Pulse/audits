import type { FocusAppearanceResult, FocusElementResult } from "@a11y-pulse/focus-appearance-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	toResult,
} from "./audit-output";

export const FOCUS_APPEARANCE_AUDIT_ID = "focus-appearance";

export const FOCUS_APPEARANCE_EVIDENCE_CHECK_ID = "focus-appearance-evidence";

const METADATA: AuditMetadata = {
	id: FOCUS_APPEARANCE_AUDIT_ID,
	help: "Interactive elements must have a visible focus indicator",
	description:
		"Ensures that elements which receive keyboard focus show a visible focus indicator, as required by WCAG 2.4.7 Focus Visible.",
	helpUrl: "https://github.com/A11y-Pulse/audits/tree/main/packages/focus-appearance-audit#readme",
	impact: "serious",
	tags: ["wcag2aa", "wcag247", "cat.keyboard"],
};

function toAuditNode(element: FocusElementResult, failed: boolean): AuditNode {
	const node: AuditNode = { selector: element.selector, html: element.html };

	if (!failed) {
		return node;
	}

	node.failureSummary = `Element did not show a focus indicator (tab stop #${element.tabIndex}). Ensure a visible focus indicator appears on all interactive elements when they receive keyboard focus.`;

	if (element.failureEvidence) {
		node.evidence = {
			id: FOCUS_APPEARANCE_EVIDENCE_CHECK_ID,
			impact: "serious",
			message: "No visible focus indicator detected",
			data: element.failureEvidence,
		};
	}

	return node;
}

export function focusAppearanceToAxe(result: FocusAppearanceResult): AuditOutput {
	const passed = result.elements.filter((element) => element.passed);
	const failed = result.elements.filter((element) => !element.passed);

	const failures =
		failed.length > 0
			? [
					toResult(
						METADATA,
						failed.map((element) => toAuditNode(element, true)),
					),
				]
			: [];

	// Losing focus can only hide an indicator, never invent one: failures recorded around the loss
	// may be artefacts, while the passes stay trustworthy.
	const focusWasLost = result.summary.sessionEnd === "lostFocus";

	return {
		...emptyOutput(),
		violations: focusWasLost ? [] : failures,
		incomplete: focusWasLost ? failures : [],
		passes:
			passed.length > 0
				? [
						toResult(
							METADATA,
							passed.map((element) => toAuditNode(element, false)),
						),
					]
				: [],
	};
}
