import { fakeStashAdaptor } from "@a11y-pulse/integration-harness/fake-stash-adaptor";
import { describe, expect, it } from "vitest";
import { runOrphanedTabRolesAudit } from "./audit";
import { type CollectedTabRole, collectTabRolesScript } from "./browser-scripts";

function fakePage(elements: CollectedTabRole[]) {
	return fakeStashAdaptor(collectTabRolesScript, elements, "element");
}

function element(overrides: Partial<CollectedTabRole> = {}): CollectedTabRole {
	return {
		role: "tab",
		controls: [],
		hasControls: false,
		controlsOther: false,
		labelledBy: [],
		navigates: false,
		html: "<button>",
		...overrides,
	};
}

describe("runOrphanedTabRolesAudit", () => {
	it("sorts elements into failed, needs review and passed", async () => {
		const page = fakePage([
			element({ html: '<a role="tab" href="/elsewhere">', navigates: true }),
			element({ controls: [3], hasControls: true }),
			element({ role: "tabpanel", html: "<div>" }),
			element({ role: "tabpanel", html: "<div>" }),
		]);

		const result = await runOrphanedTabRolesAudit(page.adaptor);

		expect(result.failed).toEqual([
			{
				selector: "#element-0",
				html: '<a role="tab" href="/elsewhere">',
				role: "tab",
				finding: "tab-used-as-link",
			},
		]);
		expect(result.needsReview).toMatchObject([
			{ selector: "#element-2", role: "tabpanel", finding: "association-unverifiable" },
		]);
		expect(result.passed.map((entry) => entry.selector)).toEqual(["#element-1", "#element-3"]);
		expect(result.summary).toEqual({ checked: 4, failed: 1, needsReview: 1, passed: 2 });
	});

	it("reports up to the report limit but counts everything", async () => {
		const page = fakePage(Array.from({ length: 4 }, () => element()));

		const result = await runOrphanedTabRolesAudit(page.adaptor, { reportLimit: 2 });

		expect(result.failed).toHaveLength(2);
		expect(result.summary.failed).toBe(4);
	});

	it("checks nothing on a page with no tab roles", async () => {
		const page = fakePage([]);

		const result = await runOrphanedTabRolesAudit(page.adaptor);

		expect(result.summary.checked).toBe(0);
		expect(page.released()).toBe(true);
	});
});
