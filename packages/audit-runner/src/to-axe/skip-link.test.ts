import type { SkipLinkElementResult, SkipLinkUnreachableResult } from "@a11y-pulse/skip-link-audit";
import { describe, expect, it } from "vitest";
import { SKIP_LINK_AUDIT_ID, SKIP_LINK_EVIDENCE_CHECK_ID, skipLinkToAxe } from "./skip-link";

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

function result(skipLinks: SkipLinkElementResult[], unreachable: SkipLinkUnreachableResult[] = []) {
	const passed = skipLinks.filter((link) => link.passed).length;

	return {
		skipLinks,
		unreachable,
		summary: {
			found: skipLinks.length,
			passed,
			failed: skipLinks.length - passed,
			unreachable: unreachable.length,
		},
	};
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

	it("explains a hidden target, and names where focus went when the link had no effect", () => {
		const output = skipLinkToAxe(
			result([
				element({ passed: false, failureReason: "target-hidden" }),
				element({
					selector: "#b",
					passed: false,
					failureReason: "activation-no-effect",
					focusAfterEnter: { position: "skip-link", selector: "#b", html: "<a>" },
					focusAfterTab: { position: "elsewhere", selector: "nav > a", html: "<a>" },
				}),
			]),
		);

		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain("is not rendered");
		expect(output.violations[0]?.nodes[1]?.failureSummary).toContain(
			"Focus went to `nav > a` instead.",
		);
	});

	it("reports a skip link that can never be focused as a violation", () => {
		const output = skipLinkToAxe(
			result(
				[],
				[
					{
						selector: "a.skip",
						html: '<a class="skip">',
						fragment: "#main",
						linkText: "Skip to content",
						reason: "not-rendered",
					},
				],
			),
		);

		expect(output.inapplicable).toEqual([]);
		expect(output.violations[0]?.nodes[0]?.target).toEqual(["a.skip"]);
		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain(
			"can never receive keyboard focus because it is not rendered",
		);
	});

	it("is inapplicable when the page has no skip link", () => {
		const output = skipLinkToAxe(result([]));

		expect(output.inapplicable[0]?.id).toBe(SKIP_LINK_AUDIT_ID);
		expect(output.inapplicable[0]?.nodes).toEqual([]);
		expect(output.violations).toEqual([]);
		expect(output.passes).toEqual([]);
	});

	it("attaches a screenshot when the audit captured one", () => {
		const screenshot = new Uint8Array([1]);
		const output = skipLinkToAxe(
			result([element({ passed: false, failureReason: "target-missing", screenshot })]),
		);

		expect(output.violations[0]?.nodes[0]?.any[0]).toMatchObject({
			id: SKIP_LINK_EVIDENCE_CHECK_ID,
			data: { screenshot },
		});
	});

	it("carries where focus went as structured evidence without a screenshot", () => {
		const focusAfterEnter = { position: "skip-link" as const, selector: "#skip", html: "<a>" };
		const focusAfterTab = { position: "elsewhere" as const, selector: "#nav a", html: "<a>" };
		const target = { selector: "#main", html: "<main>", rendered: true };
		const output = skipLinkToAxe(
			result([
				element({
					passed: false,
					failureReason: "activation-no-effect",
					linkText: "Skip to content",
					target,
					focusAfterEnter,
					focusAfterTab,
				}),
			]),
		);
		const check = output.violations[0]?.nodes[0]?.any[0];

		expect(check?.id).toBe(SKIP_LINK_EVIDENCE_CHECK_ID);
		expect(check?.data).toMatchObject({
			reason: "activation-no-effect",
			linkText: "Skip to content",
			target,
			focusAfterEnter,
			focusAfterTab,
		});
		expect(check?.data).not.toHaveProperty("screenshot");
	});
});
