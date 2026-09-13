import type {
	ContextChangeKind,
	ContextChangeOnFocusElementResult,
	ContextChangeOnFocusResult,
} from "@a11y-pulse/context-change-on-focus-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	toResult,
} from "./audit-output";

export const CONTEXT_CHANGE_ON_FOCUS_AUDIT_ID = "context-change-on-focus";

const METADATA: AuditMetadata = {
	id: CONTEXT_CHANGE_ON_FOCUS_AUDIT_ID,
	help: "Focusing an element must not trigger an unexpected change of context",
	description:
		"Ensures that receiving keyboard focus does not initiate a change of context, as required by WCAG 3.2.1 On Focus.",
	helpUrl:
		"https://github.com/A11y-Pulse/audits/tree/main/packages/context-change-on-focus-audit#readme",
	impact: "serious",
	tags: ["wcag2a", "wcag321", "cat.keyboard"],
};

function contextChangeKindLabel(kind: ContextChangeKind): string {
	switch (kind) {
		case "new-window":
			return "a new window or tab";
		case "auto-submit":
			return "an automatic form submission";
		case "focus-removed":
			return "removal of focus";
		case "focus-redirected-outside":
			return "focus moving to an unrelated element";
		case "focus-redirected-same-subtree":
			return "focus moving within a related widget (needs review)";
		case "url-changed":
			return "a soft URL change";
		case "navigation":
			return "a page navigation";
	}
}

function failureSummary(element: ContextChangeOnFocusElementResult): string {
	const primary = element.findings[0]?.kind;
	const label = primary ? contextChangeKindLabel(primary) : "an unexpected change of context";

	return `Focusing the element triggered ${label} (tab stop #${element.tabIndex}). Ensure focusing an element does not trigger a change of context; trigger changes on activation (click or Enter) instead.`;
}

function toAuditNode(element: ContextChangeOnFocusElementResult): AuditNode {
	const node: AuditNode = { selector: element.selector, html: element.html };

	if (element.findings.length > 0) {
		node.failureSummary = failureSummary(element);
	}

	return node;
}

export function contextChangeOnFocusToAxe(result: ContextChangeOnFocusResult): AuditOutput {
	const violations = result.elements.filter((element) => element.failed);
	const incomplete = result.elements.filter(
		(element) => !element.failed && element.findings.length > 0,
	);
	const passes = result.elements.filter((element) => element.findings.length === 0);

	return {
		...emptyOutput(),
		violations: violations.length > 0 ? [toResult(METADATA, violations.map(toAuditNode))] : [],
		incomplete: incomplete.length > 0 ? [toResult(METADATA, incomplete.map(toAuditNode))] : [],
		passes: passes.length > 0 ? [toResult(METADATA, passes.map(toAuditNode))] : [],
	};
}
