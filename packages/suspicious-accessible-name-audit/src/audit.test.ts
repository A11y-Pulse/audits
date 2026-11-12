import { fakeStashAdaptor } from "@a11y-pulse/integration-harness/fake-stash-adaptor";
import { describe, expect, it } from "vitest";
import { runSuspiciousNameAudit } from "./audit";
import {
	type CollectedElement,
	collectNamedElementsScript,
	type NamedElementCollection,
} from "./browser-scripts";

function element(name: string, extra: Partial<CollectedElement> = {}): CollectedElement {
	return {
		name,
		truncated: false,
		source: "aria-label",
		role: "button",
		lang: "en",
		identifiers: [],
		iconOnly: false,
		linkContext: false,
		html: `<button aria-label="${name}">`,
		...extra,
	};
}

function fakePage(elements: CollectedElement[], total = elements.length) {
	const collection: NamedElementCollection = { elements, total };

	return fakeStashAdaptor(collectNamedElementsScript, collection, "element");
}

describe("runSuspiciousNameAudit", () => {
	it("sorts elements into failed, needs review and passed", async () => {
		const page = fakePage([
			element("quantity-selector", {
				role: "spinbutton",
				identifiers: [{ attribute: "class", value: "quantity-selector" }],
				html: '<input class="quantity-selector">',
			}),
			element("undefined", { iconOnly: true }),
			element("banner1"),
			element("Disclaimer button"),
			element("Add to basket"),
		]);

		const result = await runSuspiciousNameAudit(page.adaptor);

		expect(result.failed).toEqual([
			{
				selector: "#element-0",
				html: '<input class="quantity-selector">',
				name: "quantity-selector",
				nameSource: "aria-label",
				role: "spinbutton",
				signal: "attribute-match",
				evidence: "class",
				labelSelector: null,
				criterion: "2.4.6",
			},
			expect.objectContaining({ selector: "#element-1", signal: "artefact", criterion: "1.1.1" }),
		]);
		expect(result.needsReview).toMatchObject([
			{ selector: "#element-2", signal: "placeholder-suffix", criterion: "2.4.6" },
			{ selector: "#element-3", signal: "role-word", evidence: "button", criterion: null },
		]);
		expect(result.passed).toMatchObject([
			{ selector: "#element-4", signal: null, criterion: "2.4.6" },
		]);
		expect(result.summary).toEqual({
			checked: 5,
			failed: 2,
			needsReview: 2,
			passed: 1,
			unchecked: 0,
		});
		expect(page.released()).toBe(true);
	});

	it("uses each element's language for role words", async () => {
		const page = fakePage([element("Stäng knapp", { lang: "sv" })]);

		const result = await runSuspiciousNameAudit(page.adaptor);

		expect(result.needsReview[0]?.evidence).toBe("knapp");
	});

	it("passes truncated names without classifying them", async () => {
		const page = fakePage([element("undefined", { truncated: true })]);

		const result = await runSuspiciousNameAudit(page.adaptor);

		expect(result.summary.passed).toBe(1);
	});

	it("lists at most reportLimit elements per bucket but counts them all", async () => {
		const page = fakePage([element("undefined"), element("null"), element("NaN")], 5);

		const result = await runSuspiciousNameAudit(page.adaptor, { reportLimit: 2 });

		expect(result.failed).toHaveLength(2);
		expect(result.summary).toMatchObject({ checked: 3, failed: 3, unchecked: 2 });
	});
});
