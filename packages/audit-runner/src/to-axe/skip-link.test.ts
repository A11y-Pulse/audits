import type { SkipLinkElementResult } from "@a11y-pulse/skip-link-audit";
import { describe, expect, it } from "vitest";
import { SKIP_LINK_AUDIT_ID, skipLinkToAxe } from "./skip-link";

function element(overrides: Partial<SkipLinkElementResult> = {}): SkipLinkElementResult {
	return {
		selector: "#a",
		html: "<a>",
		fragment: "#main",
		tabIndex: 1,
		passed: true,
		failureReason: null,
		...overrides,
	};
}

function summaryFor(skipLinks: SkipLinkElementResult[]) {
	const passed = skipLinks.filter((link) => link.passed).length;

	return { found: skipLinks.length, passed, failed: skipLinks.length - passed };
}

function result(skipLinks: SkipLinkElementResult[]) {
	return { skipLinks, summary: summaryFor(skipLinks) };
}

describe("skipLinkToAxe", () => {
	it("reports a working skip link as a pass", () => {
		const output = skipLinkToAxe(result([element()]));

		expect(output.passes[0]?.nodes[0]?.target).toEqual(["#a"]);
		expect(output.passes[0]?.nodes[0]).not.toHaveProperty("failureSummary");
	});

	it("explains a missing target and a link that does not move focus", () => {
		const output = skipLinkToAxe(
			result([
				element({ passed: false, failureReason: "target-missing" }),
				element({ selector: "#b", passed: false, failureReason: "activation-no-effect" }),
			]),
		);

		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain("was not found");
		expect(output.violations[0]?.nodes[1]?.failureSummary).toContain("did not move keyboard focus");
	});

	it("is inapplicable when the page has no skip link", () => {
		const output = skipLinkToAxe(result([]));

		expect(output.inapplicable[0]?.id).toBe(SKIP_LINK_AUDIT_ID);
		expect(output.inapplicable[0]?.nodes).toEqual([]);
		expect(output.violations).toEqual([]);
		expect(output.passes).toEqual([]);
	});
});
