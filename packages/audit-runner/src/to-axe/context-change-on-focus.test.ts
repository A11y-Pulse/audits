import type {
	ContextChangeOnFocusElementResult,
	ContextChangeOnFocusResult,
} from "@a11y-pulse/context-change-on-focus-audit";
import { describe, expect, it } from "vitest";
import { contextChangeOnFocusToAxe } from "./context-change-on-focus";

const SUMMARY: ContextChangeOnFocusResult["summary"] = {
	checked: 3,
	passed: 1,
	failed: 1,
	reachedLimit: false,
	reachedFailedElementLimit: false,
	timedOut: false,
	sessionEnd: "completed",
};

function element(
	overrides: Partial<ContextChangeOnFocusElementResult> = {},
): ContextChangeOnFocusElementResult {
	return {
		selector: "#a",
		html: "<input>",
		tabIndex: 1,
		findings: [],
		failed: false,
		...overrides,
	};
}

describe("contextChangeOnFocusToAxe", () => {
	it("reports a failed element as a violation and describes the change", () => {
		const output = contextChangeOnFocusToAxe({
			elements: [
				element({
					selector: "#b",
					tabIndex: 2,
					failed: true,
					findings: [{ kind: "new-window", bucket: "violation" }],
				}),
			],
			summary: SUMMARY,
		});

		expect(output.violations[0]?.nodes[0]?.target).toEqual(["#b"]);
		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain("a new window or tab");
		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain("tab stop #2");
	});

	it("reports findings that need review as incomplete", () => {
		const output = contextChangeOnFocusToAxe({
			elements: [element({ findings: [{ kind: "url-changed", bucket: "incomplete" }] })],
			summary: SUMMARY,
		});

		expect(output.violations).toEqual([]);
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("a soft URL change");
	});

	it("reports elements with no findings as passes, without a failure summary", () => {
		const output = contextChangeOnFocusToAxe({ elements: [element()], summary: SUMMARY });

		expect(output.passes[0]?.nodes[0]?.target).toEqual(["#a"]);
		expect(output.passes[0]?.nodes[0]).not.toHaveProperty("failureSummary");
	});
});
