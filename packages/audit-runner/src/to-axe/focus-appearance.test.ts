import type { FocusAppearanceResult, FocusElementResult } from "@a11y-pulse/focus-appearance-audit";
import { describe, expect, it } from "vitest";
import { FOCUS_APPEARANCE_EVIDENCE_CHECK_ID, focusAppearanceToAxe } from "./focus-appearance";

const SUMMARY: FocusAppearanceResult["summary"] = {
	checked: 2,
	passed: 1,
	failed: 1,
	needsReview: 0,
	lowContrastIndicators: 0,
	reachedLimit: false,
	reachedScreenshotLimit: false,
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

	it("reports a caret-only text field as incomplete, not as a pass or a violation", () => {
		const caret = element({
			selector: "#name",
			tabIndex: 3,
			passed: true,
			detectionMethod: "caret",
			needsReview: "caret",
		});
		const output = focusAppearanceToAxe({ elements: [element(), caret, FAILED], summary: SUMMARY });

		expect(output.passes[0]?.nodes.map((node) => node.target)).toEqual([["#a"]]);
		expect(output.violations[0]?.nodes.map((node) => node.target)).toEqual([["#b"]]);
		expect(output.incomplete[0]?.nodes.map((node) => node.target)).toEqual([["#name"]]);
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("text caret");
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("tab stop #3");
	});

	it("reports an element that stayed covered as incomplete, with its evidence", () => {
		const covered = { ...FAILED, needsReview: "obstructed" as const };
		const output = focusAppearanceToAxe({ elements: [covered], summary: SUMMARY });

		expect(output.violations).toEqual([]);
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("could not be checked");
		expect(output.incomplete[0]?.nodes[0]?.any[0]).toMatchObject({
			id: FOCUS_APPEARANCE_EVIDENCE_CHECK_ID,
			message: "Focus indicator could not be checked",
			data: FAILED.failureEvidence,
		});
	});

	it("reports an indicator shared with other tab stops, or seen under an animation, as incomplete", () => {
		const shared = { ...FAILED, selector: "#bold", needsReview: "shared-indicator" as const };
		const animating = { ...FAILED, selector: "#like", needsReview: "animating" as const };
		const output = focusAppearanceToAxe({ elements: [shared, animating], summary: SUMMARY });
		const nodes = output.incomplete[0]?.nodes ?? [];

		expect(output.violations).toEqual([]);
		expect(output.passes).toEqual([]);
		expect(nodes.map((node) => node.target[0])).toEqual(["#bold", "#like"]);
		expect(nodes[0]?.failureSummary).toContain("not on which element");
		expect(nodes[0]?.any[0]?.message).toBe(
			"The only change on focus was on a container shared with other focusable elements",
		);
		expect(nodes[1]?.failureSummary).toContain("may be the animation");
		expect(nodes[1]?.any[0]?.message).toBe(
			"An animation was running while the focus indicator was measured",
		);
	});

	it("keeps review items and failures together, in tab order, when the page lost focus", () => {
		const caret = element({ selector: "#name", tabIndex: 1, needsReview: "caret" });
		const output = focusAppearanceToAxe({
			elements: [caret, FAILED],
			summary: { ...SUMMARY, sessionEnd: "lostFocus" },
		});

		expect(output.violations).toEqual([]);
		expect(output.incomplete).toHaveLength(1);
		expect(output.incomplete[0]?.nodes.map((node) => node.target)).toEqual([["#name"], ["#b"]]);
	});

	it("says what was compared for an element that draws nothing itself", () => {
		const hidden = { ...FAILED, measuredOn: "label" as const };
		const output = focusAppearanceToAxe({ elements: [hidden], summary: SUMMARY });

		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain("its label was compared");
	});

	it("is inapplicable when no element was checked, so the audit does not vanish", () => {
		const output = focusAppearanceToAxe({ elements: [], summary: SUMMARY });

		expect(output.inapplicable.map((entry) => entry.id)).toEqual(["focus-appearance"]);
		expect([output.violations, output.incomplete, output.passes]).toEqual([[], [], []]);
	});

	it("says how a passing indicator was detected and what changed", () => {
		const output = focusAppearanceToAxe({
			elements: [
				element({
					detectionMethod: "style",
					changedProperties: ["outline-style", "outline-width"],
					indicatorOn: { kind: "ancestor", html: '<div class="field">' },
				}),
			],
			summary: SUMMARY,
		});
		const check = output.passes[0]?.nodes[0]?.any[0];

		expect(check?.id).toBe(FOCUS_APPEARANCE_EVIDENCE_CHECK_ID);
		expect(check?.message).toContain("computed style");
		expect(check?.data).toEqual({
			tabIndex: 1,
			detectionMethod: "style",
			changedProperties: ["outline-style", "outline-width"],
			indicatorOn: { kind: "ancestor", html: '<div class="field">' },
		});
	});

	it("keeps a failure's screenshots and styles at the top level of the evidence", () => {
		const output = focusAppearanceToAxe({ elements: [FAILED], summary: SUMMARY });
		const data = output.violations[0]?.nodes[0]?.any[0]?.data;

		expect(data).toMatchObject({
			...FAILED.failureEvidence,
			tabIndex: FAILED.tabIndex,
			detectionMethod: null,
		});
	});
});
