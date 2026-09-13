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
});
