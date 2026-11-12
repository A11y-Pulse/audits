import type { TextSpacingElementResult, TextSpacingResult } from "@a11y-pulse/text-spacing-audit";
import { describe, expect, it } from "vitest";
import { AUDIT_INCONCLUSIVE_TAG } from "./audit-output";
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
		truncated: false,
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

	it("is incomplete, not a pass, when nothing was found but the candidate limit left text unmeasured", () => {
		const output = textSpacingToAxe({ ...result([], 500), truncated: true });

		expect(output.passes).toEqual([]);
		expect(output.violations).toEqual([]);
		expect(output.incomplete[0]?.id).toBe(TEXT_SPACING_AUDIT_ID);
		expect(output.incomplete[0]?.tags).toContain(AUDIT_INCONCLUSIVE_TAG);
		expect(output.incomplete[0]?.nodes).toEqual([]);
		expect(output.incomplete[0]?.description).toContain(
			"the page has more text than the audit measures. The 500 pieces of text it measured were unaffected; the rest was not checked.",
		);
	});

	it("reports what it found on a page the candidate limit cut short", () => {
		const output = textSpacingToAxe({ ...result([finding()], 500), truncated: true });

		expect(output.violations[0]?.nodes).toHaveLength(1);
		expect(output.violations[0]?.tags).not.toContain(AUDIT_INCONCLUSIVE_TAG);
		expect(output.incomplete).toEqual([]);
	});

	it("is inapplicable when the page has no text candidates", () => {
		const output = textSpacingToAxe(result([], 0));

		expect(output.inapplicable[0]?.id).toBe(TEXT_SPACING_AUDIT_ID);
		expect(output.passes).toEqual([]);
	});

	it("carries the clipper, axis and metrics as structured evidence without a screenshot", () => {
		const element = finding({
			kind: "clipped",
			axis: "vertical",
			clippedBy: ".card",
			clippedByHtml: '<div class="card">',
			affectedCount: 3,
			rect: { x: 10, y: 20, width: 200, height: 40 },
		});
		const check = textSpacingToAxe(result([element])).violations[0]?.nodes[0]?.any[0];

		expect(check?.id).toBe(TEXT_SPACING_EVIDENCE_CHECK_ID);
		expect(check?.data).toEqual({
			kind: "clipped",
			axis: "vertical",
			metrics: element.metrics,
			rect: { x: 10, y: 20, width: 200, height: 40 },
			clippedBy: ".card",
			clippedByHtml: '<div class="card">',
			affectedCount: 3,
		});
	});
});
