import type { ReflowOffender, ReflowResult } from "@a11y-pulse/reflow-audit";
import { describe, expect, it } from "vitest";
import { REFLOW_EVIDENCE_CHECK_ID, reflowToAxe } from "./reflow";

function offender(overrides: Partial<ReflowOffender> = {}): ReflowOffender {
	return {
		selector: "#a",
		html: "<div>",
		overflowPx: 580,
		reason: "element-overflow",
		rect: { x: 0, y: 0, width: 900, height: 40 },
		...overrides,
	};
}

function result(
	bucket: ReflowResult["bucket"],
	offenders: ReflowOffender[] = [offender()],
): ReflowResult {
	return {
		viewport: { width: 1280, height: 800 },
		restored: true,
		unsettled: false,
		alreadyNarrow: false,
		documentOverflowPx: bucket === "pass" ? 0 : 580,
		bucket,
		offenders,
	};
}

describe("reflowToAxe", () => {
	it("reports a violation with the overflow in the failure summary", () => {
		const output = reflowToAxe(result("violation"));

		expect(output.violations[0]?.nodes[0]?.target).toEqual(["#a"]);
		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain("580px");
	});

	it("explains a fixed-width container differently", () => {
		const output = reflowToAxe(
			result("violation", [offender({ reason: "fixed-width-container" })]),
		);

		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain("fixed width");
	});

	it.each([
		["text-overflow", "without wrapping"],
		["media-overflow", "scale down"],
		["clipped-content", "cannot be scrolled into view"],
		["scrolling-container", "scrolls horizontally"],
	] as const)("explains a %s offender in its own terms", (reason, phrase) => {
		const output = reflowToAxe(result("incomplete", [offender({ reason })]));
		const summary = output.incomplete[0]?.nodes[0]?.failureSummary;

		expect(summary).toContain(phrase);
		expect(summary).toContain("580px");
	});

	it("names what is too wide inside a scrolling container, in the summary and the evidence", () => {
		const overflowing = [
			{
				selector: "#hero",
				html: '<div id="hero">',
				overflowPx: 280,
				rect: { x: 0, y: 20, width: 600, height: 120 },
			},
		];
		const output = reflowToAxe(
			result("incomplete", [
				offender({
					selector: "#root",
					reason: "scrolling-container",
					overflowPx: 280,
					overflowing,
				}),
			]),
		);
		const node = output.incomplete[0]?.nodes[0];

		expect(node?.failureSummary).toContain("#hero (by 280px)");
		expect(node?.any[0]?.data).toMatchObject({ reason: "scrolling-container", overflowing });
	});

	it("leaves overflowing out of the evidence of offenders that have none", () => {
		const output = reflowToAxe(result("violation"));

		expect(output.violations[0]?.nodes[0]?.any[0]?.data).not.toHaveProperty("overflowing");
	});

	it("maps an unsettled page to incomplete", () => {
		expect(reflowToAxe(result("incomplete")).incomplete).toHaveLength(1);
	});

	it("leaves a passing page's offenders without a failure summary", () => {
		const output = reflowToAxe(result("pass"));

		expect(output.violations).toEqual([]);
		expect(output.passes[0]?.nodes[0]).not.toHaveProperty("failureSummary");
	});

	it("attaches a screenshot when the audit captured one", () => {
		const screenshot = new Uint8Array([1]);
		const output = reflowToAxe(result("violation", [offender({ screenshot })]));

		expect(output.violations[0]?.nodes[0]?.any[0]).toMatchObject({
			id: REFLOW_EVIDENCE_CHECK_ID,
			data: { screenshot },
		});
	});

	it("carries the overflow, reason and box as structured evidence without a screenshot", () => {
		const check = reflowToAxe(result("violation")).violations[0]?.nodes[0]?.any[0];

		expect(check?.id).toBe(REFLOW_EVIDENCE_CHECK_ID);
		expect(check?.data).toEqual({
			reason: "element-overflow",
			overflowPx: 580,
			rect: { x: 0, y: 0, width: 900, height: 40 },
			viewport: { width: 1280, height: 800 },
			documentOverflowPx: 580,
		});
	});

	it("does not say a passing node overflows", () => {
		const check = reflowToAxe(result("pass")).passes[0]?.nodes[0]?.any[0];

		expect(check?.message).not.toContain("overflows");
		expect(check?.message).toContain("measured");
	});
});
