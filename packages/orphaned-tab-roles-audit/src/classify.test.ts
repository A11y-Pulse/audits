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

	it("fails unwired tabs when every panel on the page belongs to another widget's tab", () => {
		const result = findings([
			tab(),
			tab(),
			tab({ controls: [3], hasControls: true }),
			panel({ labelledBy: [2] }),
		]);

		expect(result).toEqual(["tab-without-panel", "tab-without-panel", null, null]);
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

	it("never fails a tab whose aria-controls names a panel that is not mounted", () => {
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
