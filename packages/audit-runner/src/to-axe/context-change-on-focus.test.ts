import type {
	ContextChangeOnFocusElementResult,
	ContextChangeOnFocusResult,
} from "@a11y-pulse/context-change-on-focus-audit";
import { describe, expect, it } from "vitest";
import {
	CONTEXT_CHANGE_ON_FOCUS_EVIDENCE_CHECK_ID,
	contextChangeOnFocusToAxe,
} from "./context-change-on-focus";

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

	it("attaches a screenshot when the audit captured one", () => {
		const screenshot = new Uint8Array([1]);
		const output = contextChangeOnFocusToAxe({
			elements: [
				element({
					failed: true,
					findings: [{ kind: "focus-removed", bucket: "violation" }],
					screenshot,
				}),
			],
			summary: SUMMARY,
		});

		expect(output.violations[0]?.nodes[0]?.any[0]).toMatchObject({
			id: CONTEXT_CHANGE_ON_FOCUS_EVIDENCE_CHECK_ID,
			message: "Focusing the element triggered removal of focus",
			data: { screenshot },
		});
	});

	it("names every change an element set off, with what is known about each", () => {
		const output = contextChangeOnFocusToAxe({
			elements: [
				element({
					selector: "#thief",
					failed: true,
					findings: [
						{ kind: "new-window", bucket: "violation", url: "/offer", delayed: true },
						{
							kind: "auto-submit",
							bucket: "violation",
							form: { selector: "#signup", html: "<form>", action: "/subscribe" },
						},
						{
							kind: "focus-redirected-outside",
							bucket: "violation",
							redirectedTo: { selector: "#victim", html: "<input>" },
						},
						{ kind: "dialog", bucket: "violation" },
					],
				}),
			],
			summary: SUMMARY,
		});

		expect(output.violations[0]?.nodes[0]?.target).toEqual(["#thief"]);
		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain(
			"triggered a new window or tab (/offer) (shortly after focus had moved on), and an automatic form submission of #signup, and focus moving to an unrelated element (#victim), and a dialog box (tab stop #1)",
		);
	});

	it("reports a cancelled navigation with where the page tried to go", () => {
		const output = contextChangeOnFocusToAxe({
			elements: [
				element({
					failed: true,
					findings: [{ kind: "navigation", bucket: "violation", url: "http://x/away" }],
				}),
			],
			summary: SUMMARY,
		});

		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain(
			"a page navigation (to http://x/away)",
		);
	});

	it("reports a navigation whose element could not be read against the stop before it", () => {
		const output = contextChangeOnFocusToAxe({
			elements: [element({ selector: "#safe" })],
			navigation: { after: { selector: "#safe", html: "<a>" }, url: "http://x/away" },
			summary: { ...SUMMARY, sessionEnd: "navigation" },
		});

		// #safe passed on its own account and is also where the violation is pinned.
		expect(output.passes[0]?.nodes[0]?.target).toEqual(["#safe"]);
		expect(output.violations[0]?.nodes).toHaveLength(1);
		expect(output.violations[0]?.nodes[0]?.target).toEqual(["#safe"]);
		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain(
			"The element after this one in the tab order navigated the page to http://x/away",
		);
	});

	it("pins a navigation from the very first tab stop on the document", () => {
		const output = contextChangeOnFocusToAxe({
			elements: [],
			navigation: { after: null, url: null },
			summary: { ...SUMMARY, sessionEnd: "navigation" },
		});

		expect(output.violations[0]?.nodes[0]?.target).toEqual(["html"]);
		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain(
			"The first element in the tab order navigated the page as soon as",
		);
	});

	it("carries every finding for an element as structured evidence, with URLs and destinations", () => {
		const findings: ContextChangeOnFocusElementResult["findings"] = [
			{ kind: "new-window", bucket: "violation", url: "https://a.test/popup" },
			{
				kind: "focus-redirected-outside",
				bucket: "violation",
				redirectedTo: { selector: "#victim", html: '<input id="victim">' },
			},
			{
				kind: "url-changed",
				bucket: "incomplete",
				from: "https://a.test/",
				to: "https://a.test/#x",
			},
		];
		const output = contextChangeOnFocusToAxe({
			elements: [element({ selector: "#thief", tabIndex: 4, failed: true, findings })],
			summary: SUMMARY,
		});
		const check = output.violations[0]?.nodes[0]?.any[0];

		expect(output.violations[0]?.nodes[0]?.target).toEqual(["#thief"]);
		expect(check?.id).toBe(CONTEXT_CHANGE_ON_FOCUS_EVIDENCE_CHECK_ID);
		expect(check?.data).toEqual({ tabIndex: 4, findings });
	});

	it("is inapplicable when nothing was focused", () => {
		const output = contextChangeOnFocusToAxe({ elements: [], summary: SUMMARY });

		expect(output.inapplicable).toHaveLength(1);
	});

	it("reports a change no focused element caused for review on the document, not on an element", () => {
		const unattributed = [
			{ kind: "navigation", bucket: "incomplete", url: "http://x/signed-out" },
			{ kind: "dialog", bucket: "incomplete" },
		] satisfies ContextChangeOnFocusResult["unattributed"];
		const output = contextChangeOnFocusToAxe({
			elements: [element(), element({ selector: "#b", tabIndex: 2 })],
			unattributed,
			summary: SUMMARY,
		});

		expect(output.violations).toEqual([]);
		expect(output.passes[0]?.nodes.map((node) => node.target)).toEqual([["#a"], ["#b"]]);
		expect(output.incomplete[0]?.nodes).toHaveLength(1);

		const node = output.incomplete[0]?.nodes[0];

		expect(node?.target).toEqual(["html"]);
		expect(node?.failureSummary).toContain("a page navigation (to http://x/signed-out)");
		expect(node?.failureSummary).toContain("a dialog box");
		expect(node?.failureSummary).toContain("could not be traced to any focused element");
		expect(node?.any[0]?.data).toEqual({ findings: unattributed, unattributed: true });
	});

	it("still reports an unattributed change when nothing was focused", () => {
		const output = contextChangeOnFocusToAxe({
			elements: [],
			unattributed: [{ kind: "new-window", bucket: "incomplete", url: "/promotion" }],
			summary: SUMMARY,
		});

		expect(output.inapplicable).toEqual([]);
		expect(output.incomplete[0]?.nodes[0]?.target).toEqual(["html"]);
	});
});
