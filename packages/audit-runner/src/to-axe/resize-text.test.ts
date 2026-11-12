import type { ResizeTextElementResult, ResizeTextResult } from "@a11y-pulse/resize-text-audit";
import { describe, expect, it } from "vitest";
import { AUDIT_INCONCLUSIVE_TAG } from "./audit-output";
import {
	RESIZE_TEXT_AUDIT_ID,
	RESIZE_TEXT_EVIDENCE_CHECK_ID,
	resizeTextToAxe,
} from "./resize-text";

function finding(overrides: Partial<ResizeTextElementResult> = {}): ResizeTextElementResult {
	return {
		selector: "#a",
		html: "<div>",
		kind: "clipped",
		metrics: { beforeOverflowPx: 0, afterOverflowPx: 12.4 },
		rect: { x: 0, y: 0, width: 100, height: 40 },
		axis: "vertical",
		affectedCount: 1,
		clippedBy: "#card",
		...overrides,
	};
}

function result(
	findings: ResizeTextElementResult[],
	overrides: Partial<ResizeTextResult> = {},
): ResizeTextResult {
	return {
		findings,
		candidateCount: 5,
		truncated: false,
		viewport: { width: 640, height: 400 },
		originalViewport: { width: 1280, height: 800 },
		unsettled: false,
		restored: true,
		viewportMeta: null,
		summary: {
			clipped: findings.filter((entry) => entry.kind === "clipped").length,
			overlaps: findings.filter((entry) => entry.kind === "overlap").length,
		},
		...overrides,
	};
}

describe("resizeTextToAxe", () => {
	it("reports vertically clipped text as a violation, naming the box and the overflow", () => {
		const output = resizeTextToAxe(result([finding()]));

		expect(output.violations[0]?.id).toBe(RESIZE_TEXT_AUDIT_ID);
		expect(output.violations[0]?.tags).toContain("wcag144");
		expect(output.violations[0]?.nodes[0]?.target).toEqual(["#a"]);
		expect(output.violations[0]?.nodes[0]?.failureSummary).toBe(
			"Text is cut off by 12px by #card when the page is zoomed to 200%. Let text containers grow so that content is not clipped when zoomed.",
		);
		expect(output.incomplete).toEqual([]);
	});

	it("says how much other text the same box cuts off", () => {
		const two = resizeTextToAxe(result([finding({ affectedCount: 2 })]));
		const four = resizeTextToAxe(result([finding({ affectedCount: 4 })]));

		expect(two.violations[0]?.nodes[0]?.failureSummary).toContain(
			"by #card along with 1 other piece of text when",
		);
		expect(four.violations[0]?.nodes[0]?.failureSummary).toContain(
			"along with 3 other pieces of text",
		);
	});

	it("treats text clipped in both directions as a violation", () => {
		expect(resizeTextToAxe(result([finding({ axis: "both" })])).violations).toHaveLength(1);
	});

	it("reports horizontal-only clipping and overlap as incomplete", () => {
		const output = resizeTextToAxe(
			result([
				finding({ axis: "horizontal" }),
				finding({ selector: "#b", kind: "overlap", overlapsWith: "#c", axis: undefined }),
			]),
		);

		expect(output.violations).toEqual([]);
		expect(output.incomplete[0]?.nodes.map((node) => node.target)).toEqual([["#a"], ["#b"]]);
		expect(output.incomplete[0]?.nodes[1]?.failureSummary).toContain("overlaps #c");
	});

	it("splits a mixed result between violations and incomplete", () => {
		const output = resizeTextToAxe(
			result([finding(), finding({ selector: "#b", kind: "overlap", overlapsWith: "#c" })]),
		);

		expect(output.violations[0]?.nodes.map((node) => node.target)).toEqual([["#a"]]);
		expect(output.incomplete[0]?.nodes.map((node) => node.target)).toEqual([["#b"]]);
	});

	it("fails nothing when the layout was still moving", () => {
		const output = resizeTextToAxe(result([finding()], { unsettled: true }));

		expect(output.violations).toEqual([]);
		expect(output.incomplete[0]?.nodes).toHaveLength(1);
	});

	it("mentions a viewport meta tag that stops users zooming", () => {
		const output = resizeTextToAxe(
			result([finding()], {
				viewportMeta: {
					content: "width=device-width, user-scalable=no",
					html: "<meta>",
					userScalable: false,
					maximumScale: null,
					blocksZoom: true,
				},
			}),
		);

		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain(
			"The page's viewport meta tag (width=device-width, user-scalable=no) also stops users zooming.",
		);
	});

	it("attaches a screenshot when the audit captured one", () => {
		const screenshot = new Uint8Array([1]);
		const output = resizeTextToAxe(result([finding({ screenshot })]));

		expect(output.violations[0]?.nodes[0]?.any[0]).toMatchObject({
			id: RESIZE_TEXT_EVIDENCE_CHECK_ID,
			data: { screenshot },
		});
	});

	it("carries the measurements as structured evidence without a screenshot", () => {
		const element = finding();
		const check = resizeTextToAxe(result([element])).violations[0]?.nodes[0]?.any[0];

		expect(check?.id).toBe(RESIZE_TEXT_EVIDENCE_CHECK_ID);
		expect(check?.data).toMatchObject({
			kind: element.kind,
			metrics: element.metrics,
			rect: element.rect,
		});
		expect(check?.data).not.toHaveProperty("screenshot");
		expect(check?.data).not.toHaveProperty("html");
	});

	it("passes with no nodes when no text was cut off or overlapped", () => {
		const output = resizeTextToAxe(result([]));

		expect(output.passes[0]?.id).toBe(RESIZE_TEXT_AUDIT_ID);
		expect(output.passes[0]?.nodes).toEqual([]);
	});

	it("sends cut-off text that was not shown at full size for review, and says why", () => {
		const output = resizeTextToAxe(result([finding({ noBaseline: true })]));

		expect(output.violations).toEqual([]);
		expect(output.incomplete[0]?.nodes[0]?.target).toEqual(["#a"]);
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toBe(
			"Text that the page only shows when zoomed to 200% is cut off by 12px by #card. It is not shown at full size, so there was nothing to compare it with: check whether it is cut off wherever this layout is used. Let text containers grow so that content is not clipped.",
		);
		expect(output.incomplete[0]?.nodes[0]?.any[0]?.data).toMatchObject({ noBaseline: true });
	});

	it("is incomplete, not a pass, when nothing was found but the candidate limit left text unmeasured", () => {
		const output = resizeTextToAxe(result([], { truncated: true }));

		expect(output.passes).toEqual([]);
		expect(output.violations).toEqual([]);
		expect(output.incomplete[0]?.id).toBe(RESIZE_TEXT_AUDIT_ID);
		expect(output.incomplete[0]?.tags).toContain(AUDIT_INCONCLUSIVE_TAG);
		expect(output.incomplete[0]?.nodes).toEqual([]);
		expect(output.incomplete[0]?.description).toContain("the rest was not checked");
	});

	it("is inapplicable when the page has no text candidates", () => {
		const output = resizeTextToAxe(result([], { candidateCount: 0 }));

		expect(output.inapplicable[0]?.id).toBe(RESIZE_TEXT_AUDIT_ID);
		expect(output.passes).toEqual([]);
	});
});
