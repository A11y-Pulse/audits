import type { ReflowOffender, ReflowResult } from "@a11y-pulse/reflow-audit";
import { describe, expect, it } from "vitest";
import { REFLOW_EVIDENCE_CHECK_ID, reflowToAxe } from "./reflow";

function offender(overrides: Partial<ReflowOffender> = {}): ReflowOffender {
	return {
		selector: "#a",
		html: "<div>",
		overflowPx: 580,
		reason: "element-overflow",
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
});
