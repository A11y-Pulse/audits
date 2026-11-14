import type {
	FocusNotObscuredElementResult,
	FocusNotObscuredResult,
} from "@a11y-pulse/focus-not-obscured-audit";
import { describe, expect, it } from "vitest";
import { FOCUS_NOT_OBSCURED_EVIDENCE_CHECK_ID, focusNotObscuredToAxe } from "./focus-not-obscured";

const SUMMARY: FocusNotObscuredResult["summary"] = {
	checked: 3,
	passed: 1,
	failed: 1,
	reachedLimit: false,
	reachedFailedElementLimit: false,
	timedOut: false,
	sessionEnd: "completed",
	scrolledToTopChecked: 0,
};

const UNOBSCURED: FocusNotObscuredElementResult["measurement"] = {
	coveredFraction: 0,
	fullyObscured: false,
	offscreen: false,
	opacity: "opaque",
	obscuredBy: null,
};

function element(
	overrides: Partial<FocusNotObscuredElementResult> = {},
): FocusNotObscuredElementResult {
	return {
		selector: "#a",
		html: "<button>",
		tabIndex: 1,
		measurement: UNOBSCURED,
		bucket: "pass",
		...overrides,
	};
}

describe("focusNotObscuredToAxe", () => {
	it("maps each bucket to the matching axe-core bucket", () => {
		const output = focusNotObscuredToAxe({
			elements: [
				element(),
				element({ selector: "#b", bucket: "violation" }),
				element({ selector: "#c", bucket: "incomplete" }),
			],
			summary: SUMMARY,
		});

		expect(output.passes[0]?.nodes.map((node) => node.target)).toEqual([["#a"]]);
		expect(output.violations[0]?.nodes.map((node) => node.target)).toEqual([["#b"]]);
		expect(output.incomplete[0]?.nodes.map((node) => node.target)).toEqual([["#c"]]);
	});

	it("names the covering element in the failure summary", () => {
		const output = focusNotObscuredToAxe({
			elements: [
				element({
					bucket: "violation",
					tabIndex: 4,
					measurement: {
						...UNOBSCURED,
						fullyObscured: true,
						obscuredBy: { selector: "#footer", html: "<div>" },
					},
				}),
			],
			summary: SUMMARY,
		});

		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain("`#footer`");
		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain("tab stop #4");
	});

	it("says when an element was only found hidden after scrolling it to the top", () => {
		const output = focusNotObscuredToAxe({
			elements: [
				element({
					bucket: "violation",
					foundBy: "scrolled-to-top",
					measurement: {
						...UNOBSCURED,
						fullyObscured: true,
						obscuredBy: { selector: "#header", html: "<header>" },
					},
				}),
			],
			summary: SUMMARY,
		});

		const summary = output.violations[0]?.nodes[0]?.failureSummary;
		expect(summary).toContain("`#header`");
		expect(summary).toContain("scrolled to the top of the viewport");
		expect(summary).toContain("scroll-padding-top");
	});

	it("attaches a screenshot when the audit captured one", () => {
		const screenshot = new Uint8Array([1]);
		const output = focusNotObscuredToAxe({
			elements: [element({ bucket: "violation", screenshot })],
			summary: SUMMARY,
		});

		expect(output.violations[0]?.nodes[0]?.any[0]).toMatchObject({
			id: FOCUS_NOT_OBSCURED_EVIDENCE_CHECK_ID,
			data: { screenshot },
		});
	});

	it("carries the measurement and the cover as structured evidence without a screenshot", () => {
		const measurement: FocusNotObscuredElementResult["measurement"] = {
			coveredFraction: 1,
			fullyObscured: true,
			offscreen: false,
			opacity: "opaque",
			obscuredBy: {
				selector: "#banner",
				html: '<div id="banner">',
				rect: { x: 0, y: 700, width: 1280, height: 100 },
				position: "fixed",
			},
			rect: { x: 20, y: 740, width: 80, height: 20 },
		};
		const output = focusNotObscuredToAxe({
			elements: [element({ bucket: "violation", measurement, tabIndex: 7 })],
			summary: SUMMARY,
		});
		const check = output.violations[0]?.nodes[0]?.any[0];

		expect(check?.id).toBe(FOCUS_NOT_OBSCURED_EVIDENCE_CHECK_ID);
		expect(check?.data).toEqual({ tabIndex: 7, ...measurement });
	});

	it("does not say a passing node is hidden", () => {
		const output = focusNotObscuredToAxe({ elements: [element()], summary: SUMMARY });
		const check = output.passes[0]?.nodes[0]?.any[0];

		expect(check?.message).toBe("Focused element is not entirely hidden");
		expect(check?.data).toMatchObject({ coveredFraction: 0, obscuredBy: null });
	});

	it("is inapplicable when no element was measured", () => {
		const output = focusNotObscuredToAxe({ elements: [], summary: SUMMARY });

		expect(output.inapplicable).toHaveLength(1);
		expect(output.passes).toEqual([]);
	});
});
