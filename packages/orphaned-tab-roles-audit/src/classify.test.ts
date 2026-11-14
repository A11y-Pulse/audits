import { describe, expect, it } from "vitest";
import type { CollectedTabRole } from "./browser-scripts";
import { classifyTabRoles } from "./classify";

function tab(overrides: Partial<CollectedTabRole> = {}): CollectedTabRole {
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

function panel(overrides: Partial<CollectedTabRole> = {}): CollectedTabRole {
	return tab({ role: "tabpanel", html: "<div>", ...overrides });
}

function findings(elements: CollectedTabRole[]) {
	return classifyTabRoles(elements).map(({ finding }) => finding);
}

describe("classifyTabRoles", () => {
	it("passes tabs and panels associated by aria-controls", () => {
		const result = classifyTabRoles([
			tab({ controls: [2], hasControls: true }),
			tab({ controls: [3], hasControls: true }),
			panel(),
			panel(),
		]);

		expect(result.every(({ verdict }) => verdict === "passed")).toBe(true);
	});

	it("passes tabs and panels associated by aria-labelledby", () => {
		expect(findings([tab(), panel({ labelledBy: [0] })])).toEqual([null, null]);
	});

	it("passes a tab that controls several elements including its panel", () => {
		expect(
			findings([tab({ controls: [1], hasControls: true, controlsOther: true }), panel()]),
		).toEqual([null, null]);
	});

	it("fails tabs on a page with no tab panels", () => {
		expect(findings([tab(), tab({ hasControls: true })])).toEqual([
			"tab-without-panel",
			"tab-without-panel",
		]);
	});

	it("fails a tab panel on a page with no tabs", () => {
		expect(findings([panel()])).toEqual(["tabpanel-without-tab"]);
	});

	it("fails unwired tabs when every panel on the page belongs to another tablist's tab", () => {
		const result = findings([
			tab({ tablist: 4 }),
			tab({ tablist: 4 }),
			tab({ tablist: 5, controls: [3], hasControls: true }),
			panel({ labelledBy: [2] }),
		]);

		expect(result).toEqual(["tab-without-panel", "tab-without-panel", null, null]);
	});

	it("fails unwired tabs outside any tablist when every panel belongs to another tab", () => {
		const result = findings([
			tab(),
			tab({ controls: [2], hasControls: true, selected: true }),
			panel({ labelledBy: [1] }),
		]);

		expect(result).toEqual(["tab-without-panel", null, null]);
	});

	it("passes unselected tabs with no aria-controls beside a wired tab in the same tablist", () => {
		const result = classifyTabRoles([
			tab({ tablist: 4, controls: [3], hasControls: true, selected: true }),
			tab({ tablist: 4 }),
			tab({ tablist: 4 }),
			panel({ labelledBy: [0] }),
		]);

		expect(result.map(({ verdict }) => verdict)).toEqual(["passed", "passed", "passed", "passed"]);
	});

	it("passes unselected tabs whose aria-controls dangles beside a wired tab in the same tablist", () => {
		const result = findings([
			tab({ tablist: 3, controls: [2], hasControls: true, selected: true }),
			tab({ tablist: 3, hasControls: true }),
			panel({ labelledBy: [0] }),
		]);

		expect(result).toEqual([null, null, null]);
	});

	it("fails a tablist none of whose tabs has a panel, beside a lazily mounted one", () => {
		const result = findings([
			tab({ tablist: 5, controls: [4], hasControls: true, selected: true }),
			tab({ tablist: 5 }),
			tab({ tablist: 6, selected: true }),
			tab({ tablist: 6 }),
			panel({ labelledBy: [0] }),
		]);

		expect(result).toEqual([null, null, "tab-without-panel", "tab-without-panel", null]);
	});

	it("does not pass a selected tab on the strength of a wired sibling", () => {
		const result = findings([
			tab({ tablist: 3, controls: [2], hasControls: true }),
			tab({ tablist: 3, selected: true }),
			panel({ labelledBy: [0] }),
		]);

		expect(result).toEqual([null, "tab-without-panel", null]);
	});

	it("fails unwired tabs when every panel is labelled by the same sibling tab", () => {
		const result = findings([
			tab({ tablist: 6, selected: true }),
			tab({ tablist: 6 }),
			tab({ tablist: 6 }),
			panel({ labelledBy: [0] }),
			panel({ labelledBy: [0] }),
			panel({ labelledBy: [0] }),
		]);

		expect(result).toEqual([null, "tab-without-panel", "tab-without-panel", null, null, null]);
	});

	it("fails unwired tabs beside a wired sibling when no tab in the tablist is selected", () => {
		const result = findings([
			tab({ tablist: 4, controls: [3], hasControls: true }),
			tab({ tablist: 4 }),
			tab({ tablist: 4 }),
			panel({ labelledBy: [0] }),
		]);

		expect(result).toEqual([null, "tab-without-panel", "tab-without-panel", null]);
	});

	it("reviews a dangling aria-controls beside a wired sibling that is not the selected tab", () => {
		const result = findings([
			tab({ tablist: 3, controls: [2], hasControls: true }),
			tab({ tablist: 3, hasControls: true }),
			panel({ labelledBy: [0] }),
		]);

		expect(result).toEqual([null, "association-unverifiable", null]);
	});

	it("does not let a selected tab that shares its panel with another tab vouch for siblings", () => {
		const result = findings([
			tab({ tablist: 4, controls: [3], hasControls: true, selected: true }),
			tab({ tablist: 4, controls: [3], hasControls: true }),
			tab({ tablist: 4 }),
			panel(),
		]);

		expect(result).toEqual([null, null, "tab-without-panel", null]);
	});

	it("reviews an unwired tab beside a wired sibling while a panel is left over", () => {
		const result = findings([
			tab({ tablist: 4, controls: [2], hasControls: true, selected: true }),
			tab({ tablist: 4 }),
			panel({ labelledBy: [0] }),
			panel(),
		]);

		expect(result).toEqual([null, "association-unverifiable", null, "association-unverifiable"]);
	});

	it("still fails a navigating tab beside a wired sibling", () => {
		const result = findings([
			tab({ tablist: 3, controls: [2], hasControls: true, selected: true }),
			tab({ tablist: 3, navigates: true }),
			panel({ labelledBy: [0] }),
		]);

		expect(result).toEqual([null, "tab-used-as-link", null]);
	});

	it("fails a panel that no tab references when every tab controls another panel", () => {
		const result = findings([
			tab({ controls: [2], hasControls: true }),
			tab({ hasControls: true }),
			panel(),
			panel(),
		]);

		expect(result).toEqual([null, "association-unverifiable", null, "tabpanel-without-tab"]);
	});

	it("reviews implicit widgets whose tabs and panels declare no association", () => {
		expect(findings([tab(), tab(), panel(), panel()])).toEqual([
			"association-unverifiable",
			"association-unverifiable",
			"association-unverifiable",
			"association-unverifiable",
		]);
	});

	it("reviews a dangling aria-controls outside a tablist rather than failing it", () => {
		const result = findings([
			tab({ controls: [2], hasControls: true }),
			tab({ hasControls: true }),
			panel(),
		]);

		expect(result).toEqual([null, "association-unverifiable", null]);
	});

	it("fails navigation links with tab roles even beside decoy panels", () => {
		const result = findings([tab({ navigates: true }), tab({ navigates: true }), panel(), panel()]);

		expect(result).toEqual([
			"tab-used-as-link",
			"tab-used-as-link",
			"association-unverifiable",
			"association-unverifiable",
		]);
	});

	it("passes a navigating tab that still has a panel", () => {
		expect(findings([tab({ navigates: true }), panel({ labelledBy: [0] })])).toEqual([null, null]);
	});

	it("reviews a tab whose aria-controls points at something other than a tab panel", () => {
		const result = classifyTabRoles([
			tab({ hasControls: true, controlsOther: true }),
			tab({ controls: [2], hasControls: true }),
			panel(),
		]);

		expect(result[0]).toEqual({ verdict: "needs-review", finding: "controls-not-a-tabpanel" });
	});

	it("leaves wrong pairings alone, since an association exists", () => {
		const result = findings([
			tab({ controls: [3], hasControls: true }),
			tab({ controls: [2], hasControls: true }),
			panel({ labelledBy: [0] }),
			panel({ labelledBy: [1] }),
		]);

		expect(result).toEqual([null, null, null, null]);
	});

	it("reviews the panels beside a tab whose aria-controls points at something else", () => {
		expect(findings([tab({ hasControls: true, controlsOther: true }), panel()])).toEqual([
			"controls-not-a-tabpanel",
			"association-unverifiable",
		]);
	});

	it("does not count aria-controls between two tabs as an association", () => {
		expect(
			findings([tab({ controls: [1], hasControls: true, controlsOther: true }), tab()]),
		).toEqual(["controls-not-a-tabpanel", "tab-without-panel"]);
	});
});
