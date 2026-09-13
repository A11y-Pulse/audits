import type { FocusAppearanceResult, FocusElementResult } from "@a11y-pulse/focus-appearance-audit";
import { describe, expect, it } from "vitest";
import { FOCUS_APPEARANCE_EVIDENCE_CHECK_ID, focusAppearanceToAxe } from "./focus-appearance";

const SUMMARY: FocusAppearanceResult["summary"] = {
	checked: 2,
	passed: 1,
	failed: 1,
	reachedLimit: false,
	reachedFailedElementLimit: false,
	timedOut: false,
	sessionEnd: "completed",
};

function element(overrides: Partial<FocusElementResult> = {}): FocusElementResult {
	return {
		selector: "#a",
		html: "<button>",
		tabIndex: 1,
		passed: true,
		detectionMethod: "style",
		...overrides,
	};
}

const EMPTY_STYLES = { element: {}, before: {}, after: {} };

const FAILED = element({
	selector: "#b",
	tabIndex: 2,
	passed: false,
	detectionMethod: null,
	failureEvidence: {
		focusedScreenshot: new Uint8Array([1]),
		unfocusedScreenshot: new Uint8Array([2]),
		focusedStyles: EMPTY_STYLES,
		unfocusedStyles: EMPTY_STYLES,
	},
});

describe("focusAppearanceToAxe", () => {
	it("splits passing and failing elements into their own results", () => {
		const output = focusAppearanceToAxe({ elements: [element(), FAILED], summary: SUMMARY });

		expect(output.violations[0]?.nodes.map((node) => node.target)).toEqual([["#b"]]);
		expect(output.passes[0]?.nodes.map((node) => node.target)).toEqual([["#a"]]);
		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain("tab stop #2");
		expect(output.passes[0]?.nodes[0]).not.toHaveProperty("failureSummary");
	});

	it("attaches the failure evidence to the failing node", () => {
		const output = focusAppearanceToAxe({ elements: [FAILED], summary: SUMMARY });

		expect(output.violations[0]?.nodes[0]?.any[0]).toMatchObject({
			id: FOCUS_APPEARANCE_EVIDENCE_CHECK_ID,
			data: FAILED.failureEvidence,
		});
	});

	it("reports failures as incomplete when the page lost focus, keeping the passes", () => {
		const output = focusAppearanceToAxe({
			elements: [element(), FAILED],
			summary: { ...SUMMARY, sessionEnd: "lostFocus" },
		});

		expect(output.violations).toEqual([]);
		expect(output.incomplete[0]?.nodes.map((node) => node.target)).toEqual([["#b"]]);
		expect(output.passes[0]?.nodes.map((node) => node.target)).toEqual([["#a"]]);
	});

	it("reports nothing when no element was checked", () => {
		expect(focusAppearanceToAxe({ elements: [], summary: SUMMARY })).toEqual({
			violations: [],
			incomplete: [],
			passes: [],
			inapplicable: [],
		});
	});
});
