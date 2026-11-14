import type { CollectedTabRole } from "./browser-scripts";

/**
 * - `tab-used-as-link`: a tab that links to another document and is associated with no panel.
 * - `tab-without-panel`: a tab with no panel it could control, because the page has none or every
 *   one belongs to a tab in another tablist.
 * - `tabpanel-without-tab`: a tab panel no tab could control, because the page has no tabs or every
 *   one belongs to another panel.
 * - `controls-not-a-tabpanel`: a tab whose `aria-controls` points at something other than a tab
 *   panel.
 * - `association-unverifiable`: no association is declared, but one may be wired up some other way.
 */
export type TabRoleFinding =
	| "tab-used-as-link"
	| "tab-without-panel"
	| "tabpanel-without-tab"
	| "controls-not-a-tabpanel"
	| "association-unverifiable";

export type TabRoleVerdict = "failed" | "needs-review" | "passed";

export type TabRoleClassification = { verdict: TabRoleVerdict; finding: TabRoleFinding | null };

const PASSED: TabRoleClassification = { verdict: "passed", finding: null };

function failed(finding: TabRoleFinding): TabRoleClassification {
	return { verdict: "failed", finding };
}

function needsReview(finding: TabRoleFinding): TabRoleClassification {
	return { verdict: "needs-review", finding };
}

/**
 * Classify each collected tab and tab panel by whether it is associated with a counterpart, in the
 * same order.
 */
export function classifyTabRoles(elements: readonly CollectedTabRole[]): TabRoleClassification[] {
	const isTab = (i: number) => elements[i]?.role === "tab";
	const isPanel = (i: number) => elements[i]?.role === "tabpanel";

	// An explicit association runs either way: the tab's `aria-controls` names the panel, or the
	// panel's `aria-labelledby` names the tab.
	const partners = elements.map(() => new Set<number>());

	elements.forEach((element, i) => {
		const controlled = element.role === "tab" ? element.controls.filter(isPanel) : [];
		const labellers = element.role === "tabpanel" ? element.labelledBy.filter(isTab) : [];

		for (const panel of controlled) {
			partners[i]!.add(panel);
			partners[panel]!.add(i);
		}

		for (const tab of labellers) {
			partners[i]!.add(tab);
			partners[tab]!.add(i);
		}
	});

	const tabs = elements.flatMap((element, i) => (element.role === "tab" ? [i] : []));
	const panels = elements.flatMap((element, i) => (element.role === "tabpanel" ? [i] : []));
	const associated = (i: number) => partners[i]!.size > 0;

	// A tab whose `aria-controls` names a panel that is not mounted yet still has a panel of its own,
	// but one that names only other elements may be pointing at a wrapper around its panel.
	const tabHasOwnPanel = (i: number) =>
		associated(i) || (elements[i]!.hasControls && !elements[i]!.controlsOther);

	// Libraries that mount only the active panel leave the other tabs with nothing to point at:
	// React Aria puts `aria-controls` on the selected tab alone, Radix puts a dangling one on every
	// tab. Only that exact shape vouches for the unselected siblings: the selected tab paired with
	// one panel that is paired with it alone. A wired tab that is not selected, or one sharing
	// panels with other tabs, says nothing about whether its siblings were ever wired.
	const pairedOneToOne = (i: number) => {
		const [only, ...rest] = partners[i]!;

		return only !== undefined && rest.length === 0 && partners[only]!.size === 1;
	};
	const lazyTablists = new Set(
		tabs
			.filter((i) => elements[i]!.selected === true && pairedOneToOne(i))
			.flatMap((i) => {
				const tablist = elements[i]!.tablist;

				return typeof tablist === "number" ? [tablist] : [];
			}),
	);
	const selectedSiblingVouches = (element: CollectedTabRole) =>
		typeof element.tablist === "number" && lazyTablists.has(element.tablist);

	return elements.map((element, i) => {
		if (associated(i)) {
			return PASSED;
		}

		if (element.role === "tabpanel") {
			return tabs.every(tabHasOwnPanel)
				? failed("tabpanel-without-tab")
				: needsReview("association-unverifiable");
		}

		if (element.navigates) {
			return failed("tab-used-as-link");
		}

		if (element.controlsOther) {
			return needsReview("controls-not-a-tabpanel");
		}

		// A leftover panel may be this tab's own, wired up wrongly, so that still goes to review.
		if (!element.selected && selectedSiblingVouches(element) && panels.every(associated)) {
			return PASSED;
		}

		// A dangling `aria-controls` is how lazily mounted panels look, so only a page with no panels
		// at all fails such a tab.
		if (panels.length === 0 || (!element.hasControls && panels.every(associated))) {
			return failed("tab-without-panel");
		}

		return needsReview("association-unverifiable");
	});
}
