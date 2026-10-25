import type { FocusAppearanceResult, FocusElementResult } from "@a11y-pulse/focus-appearance-audit";
import { describe, expect, it } from "vitest";
import {
	FOCUS_COLOR_ONLY_AUDIT_ID,
	FOCUS_COLOR_ONLY_EVIDENCE_CHECK_ID,
	focusColorOnlyToAxe,
} from "./focus-color-only";

const SUMMARY: FocusAppearanceResult["summary"] = {
	checked: 1,
	passed: 1,
	failed: 0,
	reachedLimit: false,
	reachedFailedElementLimit: false,
	timedOut: false,
	sessionEnd: "completed",
};

function element(
	selector: string,
	contrastRatio: number | null | undefined,
	tabIndex = 1,
): FocusElementResult {
	return {
		selector,
		html: "<a>",
		tabIndex,
		passed: true,
		detectionMethod: "style",
		...(contrastRatio !== undefined
			? {
					colorOnly: {
						unfocusedColor: "rgb(51, 51, 51)",
						focusedColor: "rgb(46, 93, 46)",
						contrastRatio,
					},
				}
			: {}),
	};
}

function convert(...elements: FocusElementResult[]) {
	return focusColorOnlyToAxe({ elements, summary: SUMMARY });
}

function targets(results: ReturnType<typeof convert>["violations"]) {
	return results.flatMap((result) => result.nodes.map((node) => node.target));
}

describe("focusColorOnlyToAxe", () => {
	it("reports nothing for elements whose focus change is not colour only", () => {
		const output = convert(element("#a", undefined));

		expect(output).toEqual({ violations: [], incomplete: [], passes: [], inapplicable: [] });
	});

	it("routes colour-only changes by their lightness contrast", () => {
		const output = convert(element("#low", 1.64), element("#high", 3), element("#unknown", null));

		expect(targets(output.violations)).toEqual([["#low"]]);
		expect(targets(output.passes)).toEqual([["#high"]]);
		expect(targets(output.incomplete)).toEqual([["#unknown"]]);
	});

	it("tags results with WCAG 1.4.1", () => {
		const output = convert(element("#low", 1.64));

		expect(output.violations[0]).toMatchObject({
			id: FOCUS_COLOR_ONLY_AUDIT_ID,
			impact: "serious",
			tags: ["wcag2a", "wcag141", "cat.color"],
		});
	});

	it("names both colours and the floored ratio in the failure summary", () => {
		const output = convert(element("#low", 1.6391, 4));
		const summary = output.violations[0]?.nodes[0]?.failureSummary;

		expect(summary).toContain("rgb(51, 51, 51) to rgb(46, 93, 46)");
		expect(summary).toContain("1.63:1");
		expect(summary).toContain("tab stop #4");
	});

	it("explains an unmeasurable change and omits the summary on passes", () => {
		const output = convert(element("#unknown", null), element("#high", 4.5));

		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("could not be measured");
		expect(output.passes[0]?.nodes[0]).not.toHaveProperty("failureSummary");
	});

	it("attaches the focused and unfocused screenshots when the audit captured them", () => {
		const evidence = {
			focusedScreenshot: new Uint8Array([1]),
			unfocusedScreenshot: new Uint8Array([2]),
		};
		const low = element("#low", 1.6);
		low.colorOnly = { ...low.colorOnly!, evidence };

		const output = convert(low);

		expect(output.violations[0]?.nodes[0]?.any[0]).toMatchObject({
			id: FOCUS_COLOR_ONLY_EVIDENCE_CHECK_ID,
			data: evidence,
		});
	});
});
