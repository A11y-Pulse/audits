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
				tablist: null,
			},
		]);
		expect(result.needsReview).toMatchObject([
			{ selector: "#element-2", role: "tabpanel", finding: "association-unverifiable" },
		]);
		expect(result.passed.map((entry) => entry.selector)).toEqual(["#element-1", "#element-3"]);
		expect(result.summary).toEqual({ checked: 4, failed: 1, needsReview: 1, passed: 2 });
	});

	it("reports the tablist, the aria-controls targets and the link target as evidence", async () => {
		const dangling = [{ id: "panel-gone", found: false, role: null, tag: null }];
		const page = fakePage([
			element({ navigates: true, href: "https://shop.test/sale", tablist: 3 }),
			element({ hasControls: true, tablist: 3, controlsTargets: dangling }),
			element({ role: "tabpanel", html: "<div>" }),
		]);

		const result = await runOrphanedTabRolesAudit(page.adaptor);

		expect(result.failed).toMatchObject([
			{ selector: "#element-0", tablist: "#element-3", href: "https://shop.test/sale" },
		]);
		expect(result.failed[0]).not.toHaveProperty("controls");
		expect(result.needsReview).toMatchObject([
			{ selector: "#element-1", tablist: "#element-3", controls: dangling },
			{ selector: "#element-2", role: "tabpanel" },
		]);
		expect(result.needsReview[0]).not.toHaveProperty("href");
		expect(result.needsReview[1]).not.toHaveProperty("tablist");
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
