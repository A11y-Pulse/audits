import type { TextSpacingElementResult, TextSpacingResult } from "@a11y-pulse/text-spacing-audit";
import { describe, expect, it } from "vitest";
import {
	TEXT_SPACING_AUDIT_ID,
	TEXT_SPACING_EVIDENCE_CHECK_ID,
	textSpacingToAxe,
} from "./text-spacing";

function finding(overrides: Partial<TextSpacingElementResult> = {}): TextSpacingElementResult {
	return {
		selector: "#a",
		html: "<div>",
		kind: "clipped",
		metrics: { beforeOverflowPx: 0, afterOverflowPx: 12 },
		...overrides,
	};
}

function result(findings: TextSpacingElementResult[], candidateCount = 5): TextSpacingResult {
	return {
		findings,
		candidateCount,
		restored: true,
		summary: {
			clipped: findings.filter((entry) => entry.kind === "clipped").length,
			truncationIncreased: findings.filter((entry) => entry.kind === "truncation-increased").length,
			overlaps: findings.filter((entry) => entry.kind === "overlap").length,
		},
	};
}

describe("textSpacingToAxe", () => {
	it("reports clipped text as a violation, with the overflow delta", () => {
		const output = textSpacingToAxe(result([finding()]));

		expect(output.violations[0]?.nodes[0]?.target).toEqual(["#a"]);
		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain("clipped by 12px");
	});

	it("reports truncation and overlap as incomplete", () => {
		const output = textSpacingToAxe(
			result([
				finding({ kind: "truncation-increased" }),
				finding({ selector: "#b", kind: "overlap", overlapsWith: "#c" }),
			]),
		);

		expect(output.violations).toEqual([]);
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain(
			"Truncation increases by 12px",
		);
		expect(output.incomplete[0]?.nodes[1]?.failureSummary).toContain("overlaps #c");
	});

	it("attaches a screenshot when the audit captured one", () => {
		const screenshot = new Uint8Array([1]);
		const output = textSpacingToAxe(result([finding({ screenshot })]));

		expect(output.violations[0]?.nodes[0]?.any[0]).toMatchObject({
			id: TEXT_SPACING_EVIDENCE_CHECK_ID,
			data: { screenshot },
		});
	});

	it("passes with no nodes when every candidate survived the spacing overrides", () => {
		const output = textSpacingToAxe(result([]));

		expect(output.passes[0]?.id).toBe(TEXT_SPACING_AUDIT_ID);
		expect(output.passes[0]?.nodes).toEqual([]);
	});

	it("is inapplicable when the page has no text candidates", () => {
		const output = textSpacingToAxe(result([], 0));

		expect(output.inapplicable[0]?.id).toBe(TEXT_SPACING_AUDIT_ID);
		expect(output.passes).toEqual([]);
	});
});
