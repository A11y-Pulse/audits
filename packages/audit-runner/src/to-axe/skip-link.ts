import type {
	SkipLinkElementResult,
	SkipLinkFailureReason,
	SkipLinkResult,
	SkipLinkUnreachableResult,
} from "@a11y-pulse/skip-link-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	evidenceCheck,
	toResult,
} from "./audit-output";

export const SKIP_LINK_AUDIT_ID = "skip-link-activation";

export const SKIP_LINK_EVIDENCE_CHECK_ID = "skip-link-activation-evidence";

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

	if (reason === "target-hidden") {
		return `Skip link target \`${element.fragment}\` is not rendered, so activating the skip link cannot move to it. Ensure the skip link points to visible content.`;
	}

	const landed = element.focusAfterTab?.selector ?? element.focusAfterEnter?.selector;
	const where = landed ? ` Focus went to \`${landed}\` instead.` : "";

	return `Activating the skip link did not move keyboard focus to \`${element.fragment}\`.${where} Ensure activating the skip link moves keyboard focus to its target.`;
}

const UNREACHABLE_REASONS: Record<SkipLinkUnreachableResult["reason"], string> = {
	"not-rendered": "it is not rendered (for example `display: none`)",
	"visibility-hidden": "it is `visibility: hidden`",
	inert: "it is inside inert content",
	"negative-tabindex": "it has a negative `tabindex`",
};

function toUnreachableNode(element: SkipLinkUnreachableResult): AuditNode {
	return {
		selector: element.selector,
		html: element.html,
		failureSummary: `The skip link to \`${element.fragment}\` can never receive keyboard focus because ${UNREACHABLE_REASONS[element.reason]}. Hide skip links visually until focused instead of removing them from the tab order.`,
		evidence: evidenceCheck(
			SKIP_LINK_EVIDENCE_CHECK_ID,
			"moderate",
			"Skip link that keyboard focus cannot reach",
			{ fragment: element.fragment, linkText: element.linkText, reason: element.reason },
		),
	};
}

function toAuditNode(element: SkipLinkElementResult): AuditNode {
	const node: AuditNode = { selector: element.selector, html: element.html };

	if (element.failureReason) {
		node.failureSummary = failureSummary(element, element.failureReason);
	}

	node.evidence = evidenceCheck(
		SKIP_LINK_EVIDENCE_CHECK_ID,
		"moderate",
		element.passed
			? "Where focus went when the skip link was activated"
			: "Where focus went instead when the skip link was activated",
		{
			fragment: element.fragment,
			linkText: element.linkText,
			tabIndex: element.tabIndex,
			reason: element.failureReason ?? undefined,
			target: element.target,
			focusAfterEnter: element.focusAfterEnter,
			focusAfterTab: element.focusAfterTab,
			screenshot: element.screenshot,
		},
	);

	return node;
}

export function skipLinkToAxe(result: SkipLinkResult): AuditOutput {
	if (result.skipLinks.length === 0 && result.unreachable.length === 0) {
		return { ...emptyOutput(), inapplicable: [toResult(METADATA, [])] };
	}

	const passed = result.skipLinks.filter((element) => element.passed);
	const failed = [
		...result.skipLinks.filter((element) => !element.passed).map(toAuditNode),
		...result.unreachable.map(toUnreachableNode),
	];

	return {
		...emptyOutput(),
		violations: failed.length > 0 ? [toResult(METADATA, failed)] : [],
		passes: passed.length > 0 ? [toResult(METADATA, passed.map(toAuditNode))] : [],
	};
}
