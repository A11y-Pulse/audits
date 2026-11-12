import type {
	ContextChangeFinding,
	ContextChangeOnFocusElementResult,
	ContextChangeOnFocusResult,
} from "@a11y-pulse/context-change-on-focus-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	evidenceCheck,
	toResult,
} from "./audit-output";

export const CONTEXT_CHANGE_ON_FOCUS_AUDIT_ID = "context-change-on-focus";

export const CONTEXT_CHANGE_ON_FOCUS_EVIDENCE_CHECK_ID = "context-change-on-focus-evidence";

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

function describeFinding(finding: ContextChangeFinding): string {
	const later = finding.delayed ? " (shortly after focus had moved on)" : "";

	switch (finding.kind) {
		case "new-window":
			return `a new window or tab${finding.url ? ` (${finding.url})` : ""}${later}`;
		case "auto-submit":
			return `an automatic form submission${
				finding.form ? ` of ${finding.form.selector ?? finding.form.html}` : ""
			}${later}`;
		case "focus-removed":
			return "removal of focus";
		case "focus-redirected-outside":
			return `focus moving to an unrelated element${
				finding.redirectedTo ? ` (${finding.redirectedTo.selector})` : ""
			}`;
		case "focus-redirected-same-subtree":
			return `focus moving within a related widget${
				finding.redirectedTo ? ` (to ${finding.redirectedTo.selector})` : ""
			} (needs review)`;
		case "url-changed":
			return `a soft URL change${finding.to ? ` (to ${finding.to})` : ""}${later}`;
		case "navigation":
			return `a page navigation${finding.url ? ` (to ${finding.url})` : ""}${later}`;
		case "dialog":
			return "a dialog box";
	}
}

/** Everything focusing the element set off, in the order the audit reports it. */
function changesLabel(element: ContextChangeOnFocusElementResult): string {
	if (element.findings.length === 0) {
		return "an unexpected change of context";
	}

	return element.findings.map(describeFinding).join(", and ");
}

function failureSummary(element: ContextChangeOnFocusElementResult): string {
	return `Focusing the element triggered ${changesLabel(element)} (tab stop #${element.tabIndex}). Ensure focusing an element does not trigger a change of context; trigger changes on activation (click or Enter) instead.`;
}

function toAuditNode(element: ContextChangeOnFocusElementResult): AuditNode {
	// A change a timer made for an element that was never a tab stop of its own has no selector.
	const node: AuditNode = { selector: element.selector || "html", html: element.html };

	if (element.findings.length > 0) {
		node.failureSummary = failureSummary(element);
	}

	if (element.findings.length > 0 || element.screenshot) {
		node.evidence = evidenceCheck(
			CONTEXT_CHANGE_ON_FOCUS_EVIDENCE_CHECK_ID,
			"serious",
			element.findings.length > 0
				? `Focusing the element triggered ${changesLabel(element)}`
				: "Focusing the element changed nothing",
			{
				tabIndex: element.tabIndex,
				findings: element.findings,
				screenshot: element.screenshot,
			},
		);
	}

	return node;
}

/**
 * The page navigated away before the element responsible could be read. All that is known is the
 * element focus was on before the Tab press that did it.
 */
function navigationNode(
	navigation: NonNullable<ContextChangeOnFocusResult["navigation"]>,
): AuditNode {
	const where = navigation.url ? ` to ${navigation.url}` : "";
	const which = navigation.after
		? "The element after this one in the tab order"
		: "The first element in the tab order";

	return {
		selector: navigation.after?.selector ?? "html",
		html: navigation.after?.html ?? "<html>",
		failureSummary: `${which} navigated the page${where} as soon as it received focus, which ended the keyboard pass. Ensure focusing an element does not trigger a change of context; navigate on activation (click or Enter) instead.`,
		evidence: evidenceCheck(
			CONTEXT_CHANGE_ON_FOCUS_EVIDENCE_CHECK_ID,
			"serious",
			"The page navigated when the next element received focus",
			{
				findings: [
					{
						kind: "navigation",
						bucket: "violation",
						...(navigation.url ? { url: navigation.url } : {}),
					},
				],
				after: navigation.after?.selector ?? null,
			},
		),
	};
}

/**
 * The page changed context during the keyboard pass for reasons that could not be tied to any
 * focused element: a timed redirect, a background script. Not evidence that focusing anything did
 * it, so it is pinned on the document for a person to look at.
 */
function unattributedNode(findings: ContextChangeFinding[]): AuditNode {
	const changes = findings.map(describeFinding).join(", and ");

	return {
		selector: "html",
		html: "<html>",
		failureSummary: `During the keyboard pass the page triggered ${changes}, which could not be traced to any focused element (it may be timed or set off by a background script). The audit blocked it. Check whether it happens when an element receives focus; a change of context on a timer is a matter for WCAG 2.2.1 Timing Adjustable and 3.2.5 Change on Request instead.`,
		evidence: evidenceCheck(
			CONTEXT_CHANGE_ON_FOCUS_EVIDENCE_CHECK_ID,
			"serious",
			`The page triggered ${changes} that no focused element could be shown to have caused`,
			{ findings, unattributed: true },
		),
	};
}

export function contextChangeOnFocusToAxe(result: ContextChangeOnFocusResult): AuditOutput {
	const violations = result.elements.filter((element) => element.failed).map(toAuditNode);
	const incomplete = result.elements
		.filter((element) => !element.failed && element.findings.length > 0)
		.map(toAuditNode);
	const passes = result.elements.filter((element) => element.findings.length === 0);
	const unattributed = result.unattributed ?? [];

	if (result.navigation) {
		violations.push(navigationNode(result.navigation));
	}

	if (unattributed.length > 0) {
		incomplete.push(unattributedNode(unattributed));
	}

	if (result.elements.length === 0 && !result.navigation && unattributed.length === 0) {
		return { ...emptyOutput(), inapplicable: [toResult(METADATA, [])] };
	}

	return {
		...emptyOutput(),
		violations: violations.length > 0 ? [toResult(METADATA, violations)] : [],
		incomplete: incomplete.length > 0 ? [toResult(METADATA, incomplete)] : [],
		passes: passes.length > 0 ? [toResult(METADATA, passes.map(toAuditNode))] : [],
	};
}
