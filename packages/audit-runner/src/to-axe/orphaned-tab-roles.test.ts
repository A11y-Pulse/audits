import type {
	OrphanedTabRolesElement,
	OrphanedTabRolesResult,
} from "@a11y-pulse/orphaned-tab-roles-audit";
import { describe, expect, it } from "vitest";
import { ORPHANED_TAB_ROLES_AUDIT_ID, orphanedTabRolesToAxe } from "./orphaned-tab-roles";

function element(overrides: Partial<OrphanedTabRolesElement> = {}): OrphanedTabRolesElement {
	return { selector: "#a", html: "<button>", role: "tab", finding: null, ...overrides };
}

function result(
	failed: OrphanedTabRolesElement[],
	needsReview: OrphanedTabRolesElement[],
	passed: OrphanedTabRolesElement[],
): OrphanedTabRolesResult {
	return {
		failed,
		needsReview,
		passed,
		summary: {
			checked: failed.length + needsReview.length + passed.length,
			failed: failed.length,
			needsReview: needsReview.length,
			passed: passed.length,
		},
	};
}

describe("orphanedTabRolesToAxe", () => {
	it("routes each list to its bucket", () => {
		const output = orphanedTabRolesToAxe(
			result(
				[element({ selector: "#failed", finding: "tab-without-panel" })],
				[element({ selector: "#review", finding: "association-unverifiable" })],
				[element({ selector: "#passed" })],
			),
		);

		expect(output.violations[0]?.nodes[0]?.target).toEqual(["#failed"]);
		expect(output.incomplete[0]?.nodes[0]?.target).toEqual(["#review"]);
		expect(output.passes[0]?.nodes[0]?.target).toEqual(["#passed"]);
		expect(output.passes[0]?.nodes[0]).not.toHaveProperty("failureSummary");
	});

	it("explains each finding", () => {
		const output = orphanedTabRolesToAxe(
			result(
				[
					element({ finding: "tab-used-as-link" }),
					element({ finding: "tab-without-panel" }),
					element({ role: "tabpanel", finding: "tabpanel-without-tab" }),
				],
				[
					element({ finding: "controls-not-a-tabpanel" }),
					element({ finding: "association-unverifiable" }),
					element({ role: "tabpanel", finding: "association-unverifiable" }),
				],
				[],
			),
		);
		const summaries = [...output.violations, ...output.incomplete].flatMap((entry) =>
			entry.nodes.map((node) => node.failureSummary),
		);

		expect(summaries).toEqual([
			expect.stringContaining("takes the user to another page"),
			expect.stringContaining("No tab panel on the page belongs to this tab"),
			expect.stringContaining("No tab on the page controls this tab panel"),
			expect.stringContaining("points at an element that is not a tab panel"),
			expect.stringContaining("This tab names no tab panel"),
			expect.stringContaining("No tab names this tab panel"),
		]);
	});

	it("tags results as 1.3.1 and 4.1.2 results", () => {
		const output = orphanedTabRolesToAxe(
			result([element({ finding: "tab-without-panel" })], [], []),
		);

		expect(output.violations[0]).toMatchObject({
			id: ORPHANED_TAB_ROLES_AUDIT_ID,
			impact: "serious",
			tags: ["cat.aria", "wcag2a", "wcag131", "wcag412"],
		});
	});

	it("is inapplicable when the page has no tab roles", () => {
		const output = orphanedTabRolesToAxe(result([], [], []));

		expect(output.inapplicable[0]?.id).toBe(ORPHANED_TAB_ROLES_AUDIT_ID);
		expect(output.violations).toEqual([]);
	});
});
