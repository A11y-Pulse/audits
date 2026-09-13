import type {
	SkipLinkElementResult,
	SkipLinkFailureReason,
	SkipLinkResult,
} from "@a11y-pulse/skip-link-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	toResult,
} from "./audit-output";

export const SKIP_LINK_AUDIT_ID = "skip-link-activation";

const METADATA: AuditMetadata = {
	id: SKIP_LINK_AUDIT_ID,
	help: "Skip links must move keyboard focus to their target",
	description:
		"Ensures that skip-link-like in-page anchors in the first tab stops move keyboard focus to their target when activated, as required by WCAG 2.4.1 Bypass Blocks.",
	helpUrl: "https://github.com/A11y-Pulse/audits/tree/main/packages/skip-link-audit#readme",
	impact: "moderate",
	tags: ["wcag2a", "wcag241", "cat.keyboard"],
};

function failureSummary(element: SkipLinkElementResult, reason: SkipLinkFailureReason): string {
	if (reason === "target-missing") {
		return `Skip link target \`${element.fragment}\` was not found. Ensure the skip link points to an existing in-page target.`;
	}

	return `Activating the skip link did not move keyboard focus to \`${element.fragment}\`. Ensure activating the skip link moves keyboard focus to its target.`;
}

function toAuditNode(element: SkipLinkElementResult): AuditNode {
	const node: AuditNode = { selector: element.selector, html: element.html };

	if (element.failureReason) {
		node.failureSummary = failureSummary(element, element.failureReason);
	}

	return node;
}

export function skipLinkToAxe(result: SkipLinkResult): AuditOutput {
	if (result.skipLinks.length === 0) {
		return { ...emptyOutput(), inapplicable: [toResult(METADATA, [])] };
	}

	const passed = result.skipLinks.filter((element) => element.passed);
	const failed = result.skipLinks.filter((element) => !element.passed);

	return {
		...emptyOutput(),
		violations: failed.length > 0 ? [toResult(METADATA, failed.map(toAuditNode))] : [],
		passes: passed.length > 0 ? [toResult(METADATA, passed.map(toAuditNode))] : [],
	};
}
