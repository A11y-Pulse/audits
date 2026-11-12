import {
	type FocusAppearanceResult,
	type FocusElementResult,
	hasLowContrastIndicator,
	type IndicatorContrast,
} from "@a11y-pulse/focus-appearance-audit";
import { describe, expect, it } from "vitest";
import {
	FOCUS_INDICATOR_CONTRAST_AUDIT_ID,
	FOCUS_INDICATOR_CONTRAST_EVIDENCE_CHECK_ID,
	focusIndicatorContrastToAxe,
} from "./focus-indicator-contrast";

const SUMMARY: FocusAppearanceResult["summary"] = {
	checked: 1,
	passed: 1,
	failed: 0,
	needsReview: 0,
	lowContrastIndicators: 0,
	reachedLimit: false,
	reachedScreenshotLimit: false,
	reachedFailedElementLimit: false,
	timedOut: false,
	sessionEnd: "completed",
};

const FAINT_OUTLINE: IndicatorContrast = {
	ratio: 1.4115,
	method: "style",
	property: "outline",
	indicatorColor: "rgb(217, 217, 217)",
	adjacentColor: "rgb(255, 255, 255)",
	comparedAgainst: "surroundings",
};

function element(
	selector: string,
	indicatorContrast?: IndicatorContrast,
	extra: Partial<FocusElementResult> = {},
): FocusElementResult {
	return {
		selector,
		html: "<a>",
		tabIndex: 3,
		passed: true,
		detectionMethod: "style",
		...(indicatorContrast ? { indicatorContrast } : {}),
		...extra,
	};
}

function convert(...elements: FocusElementResult[]) {
	return focusIndicatorContrastToAxe({ elements, summary: SUMMARY });
}

function targets(results: ReturnType<typeof convert>["violations"]) {
	return results.flatMap((result) => result.nodes.map((node) => node.target[0]));
}

describe("focusIndicatorContrastToAxe", () => {
	it("reports nothing for elements whose indicator was not measured", () => {
		const output = convert(
			element("#default-ring"),
			element("#none", undefined, { passed: false, detectionMethod: null }),
		);

		expect(output).toEqual({ violations: [], incomplete: [], passes: [], inapplicable: [] });
	});

	it("routes indicators by their contrast ratio", () => {
		const output = convert(
			element("#faint", FAINT_OUTLINE),
			element("#edge", { ...FAINT_OUTLINE, ratio: 2.999 }),
			element("#just", { ...FAINT_OUTLINE, ratio: 3 }),
			element("#strong", { ...FAINT_OUTLINE, ratio: 5.85 }),
			element("#unknown", {
				ratio: null,
				method: "style",
				property: "outline",
				reason: "background-unresolved",
			}),
		);

		expect(targets(output.violations)).toEqual(["#faint", "#edge"]);
		expect(targets(output.passes)).toEqual(["#just", "#strong"]);
		expect(targets(output.incomplete)).toEqual(["#unknown"]);
	});

	it("tags the rule with WCAG 1.4.11", () => {
		const [violation] = convert(element("#faint", FAINT_OUTLINE)).violations;

		expect(violation).toMatchObject({ id: FOCUS_INDICATOR_CONTRAST_AUDIT_ID, impact: "serious" });
		expect(violation?.tags).toEqual(expect.arrayContaining(["wcag2aa", "wcag1411"]));
	});

	it("says what was measured, against what, and the ratio rounded down", () => {
		const [violation] = convert(element("#faint", FAINT_OUTLINE)).violations;

		expect(violation?.nodes[0]?.failureSummary).toBe(
			"The focus outline has a contrast ratio of 1.41:1 against the background around the element (rgb(217, 217, 217) on rgb(255, 255, 255)) (tab stop #3). Use an indicator color with a contrast ratio of at least 3:1.",
		);
	});

	it("never rounds a failing ratio up to the threshold", () => {
		const [violation] = convert(element("#edge", { ...FAINT_OUTLINE, ratio: 2.9999 })).violations;

		expect(violation?.nodes[0]?.failureSummary).toContain("2.99:1");
	});

	it("describes an indicator measured from the screenshots", () => {
		const [violation] = convert(
			element(
				"#custom-checkbox",
				{
					ratio: 1.54,
					method: "pixels",
					indicatorColor: "rgb(208, 208, 208)",
					adjacentColor: "rgb(255, 255, 255)",
					comparedAgainst: "adjacent-pixels",
				},
				{ detectionMethod: "pixel-diff", measuredOn: "label" },
			),
		).violations;

		expect(violation?.nodes[0]?.failureSummary).toBe(
			"The focus indicator has a contrast ratio of 1.54:1 against the color next to it (rgb(208, 208, 208) on rgb(255, 255, 255)) (tab stop #3). Use an indicator color with a contrast ratio of at least 3:1.",
		);
	});

	it("explains why an indicator could not be measured", () => {
		const output = convert(
			element("#hero-link", {
				ratio: null,
				method: "style",
				property: "outline",
				indicatorColor: "rgb(0, 80, 255)",
				reason: "background-unresolved",
			}),
			element("#bootstrap-input", {
				ratio: null,
				method: "style",
				property: "box-shadow",
				reason: "translucent",
			}),
			element("#fading", { ratio: null, method: "pixels", reason: "transitioning" }),
		);
		const summaries = output.incomplete[0]?.nodes.map((node) => node.failureSummary);

		expect(summaries).toEqual([
			"The contrast of the focus outline could not be measured because a background image, gradient or translucent color is behind the element, or the element is positioned over other content (tab stop #3). Check that it has a contrast ratio of at least 3:1 against the colors next to it.",
			"The contrast of the focus box-shadow could not be measured because its color is translucent or a soft glow (tab stop #3). Check that it has a contrast ratio of at least 3:1 against the colors next to it.",
			"The contrast of the focus indicator could not be measured because it was still animating in when it was measured (tab stop #3). Check that it has a contrast ratio of at least 3:1 against the colors next to it.",
		]);
	});

	it("leaves an element whose only change is one measured colour to focus-color-only", () => {
		const output = convert(
			element(
				"#highlight",
				{
					ratio: 1.35,
					method: "style",
					property: "background-color",
					indicatorColor: "rgb(255, 221, 0)",
					adjacentColor: "rgb(255, 255, 255)",
					comparedAgainst: "surroundings",
				},
				{
					colorOnly: {
						property: "background-color",
						unfocusedColor: "rgba(0, 0, 0, 0)",
						focusedColor: "rgb(255, 221, 0)",
						contrastRatio: 1.35,
						backgroundColor: "rgb(255, 255, 255)",
					},
				},
			),
		);

		expect(output).toEqual({ violations: [], incomplete: [], passes: [], inapplicable: [] });
	});

	it("reports a measured contrast when the colour-only check could not measure the change", () => {
		// focus-color-only can only say "could not be measured" here. The contrast that was
		// measured must not be dropped along with it.
		const output = convert(
			element(
				"#highlight",
				{
					ratio: 1.35,
					method: "style",
					property: "background-color",
					indicatorColor: "rgb(255, 221, 0)",
					adjacentColor: "rgb(255, 255, 255)",
					comparedAgainst: "surroundings",
				},
				{
					colorOnly: {
						property: "background-color",
						unfocusedColor: "rgba(0, 0, 0, 0)",
						focusedColor: "rgb(255, 221, 0)",
						contrastRatio: null,
					},
				},
			),
		);

		expect(targets(output.violations)).toEqual(["#highlight"]);
		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain("1.35:1");
	});

	it("does not report how little an indicator differs from the unfocused state", () => {
		// A grey border turning blue on white: 1.9:1 against the grey it was, which 1.4.11 does not
		// ask about, and 8.6:1 against the white next to it, which it does.
		const output = convert(
			element("#field", {
				ratio: 8.59,
				stateChangeRatio: 1.89,
				method: "style",
				property: "border",
				indicatorColor: "rgb(0, 0, 255)",
				adjacentColor: "rgb(255, 255, 255)",
				comparedAgainst: "surroundings",
			}),
		);

		expect(output.violations).toEqual([]);
		expect(targets(output.passes)).toEqual(["#field"]);
		expect(output.passes[0]?.nodes[0]?.any[0]?.data).toMatchObject({ stateChangeRatio: 1.89 });
	});

	it("reports exactly the elements the audit's own low-contrast count includes", () => {
		const measured = { property: "border-color", unfocusedColor: "a", focusedColor: "b" } as const;
		const elements = [
			element("#low", FAINT_OUTLINE),
			element("#low-unmeasured-colour", FAINT_OUTLINE, {
				colorOnly: { ...measured, contrastRatio: null },
			}),
			element("#low-measured-colour", FAINT_OUTLINE, {
				colorOnly: { ...measured, contrastRatio: 1.2 },
			}),
			element("#strong", { ...FAINT_OUTLINE, ratio: 5 }),
			element("#unknown", { ratio: null, method: "pixels", reason: "noisy" }),
		];

		expect(elements.filter(hasLowContrastIndicator).map((e) => e.selector)).toEqual(
			targets(convert(...elements).violations),
		);
		expect(targets(convert(...elements).violations)).toEqual(["#low", "#low-unmeasured-colour"]);
	});

	it("carries the measurement on every node, with the screenshots when they were kept", () => {
		const evidence = {
			focusedScreenshot: new Uint8Array([1]),
			unfocusedScreenshot: new Uint8Array([2]),
		};
		const output = convert(
			element("#with", { ...FAINT_OUTLINE, evidence }),
			element("#without", FAINT_OUTLINE),
		);
		const [withEvidence, without] = output.violations[0]?.nodes ?? [];

		expect(withEvidence?.any).toEqual([
			{
				id: FOCUS_INDICATOR_CONTRAST_EVIDENCE_CHECK_ID,
				impact: "serious",
				message: "The focus outline has a contrast ratio of 1.41:1",
				data: { tabIndex: 3, ...FAINT_OUTLINE, ...evidence },
			},
		]);
		expect(without?.any[0]?.data).toEqual({ tabIndex: 3, ...FAINT_OUTLINE });
	});

	it("names why an indicator could not be measured as the reason", () => {
		const output = convert(
			element("#image", { ratio: null, method: "style", reason: "background-image" }),
		);

		expect(output.incomplete[0]?.nodes[0]?.any[0]).toMatchObject({
			message: "The contrast of the focus indicator could not be measured",
			data: { ratio: null, reason: "background-image" },
		});
	});

	it("gives passing nodes no failure summary", () => {
		const [pass] = convert(element("#strong", { ...FAINT_OUTLINE, ratio: 5.85 })).passes;

		expect(pass?.nodes[0]?.failureSummary).toBeUndefined();
	});
});
