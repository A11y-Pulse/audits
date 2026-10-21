import type {
	OrphanedTabRolesElement,
	OrphanedTabRolesResult,
	TabRoleFinding,
} from "@a11y-pulse/orphaned-tab-roles-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	sortedResultToAxe,
} from "./audit-output";

export const ORPHANED_TAB_ROLES_AUDIT_ID = "orphaned-tab-roles";

const METADATA: AuditMetadata = {
	id: ORPHANED_TAB_ROLES_AUDIT_ID,
	help: "Tabs must control a tab panel, and tab panels must belong to a tab",
	description:
		"Ensures that every element with role tab is associated with a tab panel and every tab panel with a tab, so assistive technology is not promised a tab interface that does not exist (WCAG 1.3.1 Info and Relationships, 4.1.2 Name, Role, Value).",
	helpUrl:
		"https://github.com/A11y-Pulse/audits/tree/main/packages/orphaned-tab-roles-audit#readme",
	impact: "serious",
	tags: ["cat.aria", "wcag2a", "wcag131", "wcag412"],
};

function failureSummary(element: OrphanedTabRolesElement, finding: TabRoleFinding): string {
	switch (finding) {
		case "tab-used-as-link":
			return 'This link has the tab role but takes the user to another page instead of showing a tab panel. If it navigates, remove role="tab" and mark the links up as a list inside a nav element, with aria-current="page" on the current one. If it shows content on this page, point its aria-controls at that content\'s tab panel.';
		case "tab-without-panel":
			return "No tab panel on the page belongs to this tab. Point its aria-controls at the tab panel it shows; if it shows none, remove the tab role.";
		case "tabpanel-without-tab":
			return "No tab on the page controls this tab panel. Point its tab's aria-controls at it; if no tab shows it, remove the tabpanel role.";
		case "controls-not-a-tabpanel":
			return 'This tab\'s aria-controls points at an element that is not a tab panel. Check that the tab shows that content, and give the content role="tabpanel".';
		case "association-unverifiable":
			return element.role === "tab"
				? "This tab names no tab panel with aria-controls, and no tab panel names it with aria-labelledby. Check that it shows a tab panel, and connect the two with aria-controls."
				: "No tab names this tab panel with aria-controls, and it names no tab with aria-labelledby. Check that a tab shows it, and connect the two with aria-controls.";
	}
}

function toAuditNode(element: OrphanedTabRolesElement): AuditNode {
	const node: AuditNode = { selector: element.selector, html: element.html };

	if (element.finding) {
		node.failureSummary = failureSummary(element, element.finding);
	}

	return node;
}

export function orphanedTabRolesToAxe(result: OrphanedTabRolesResult): AuditOutput {
	return sortedResultToAxe(METADATA, result, toAuditNode);
}
