import type { PasteBlockingField, PasteBlockingResult } from "@a11y-pulse/paste-blocking-audit";
import { describe, expect, it } from "vitest";
import {
	ACCESSIBLE_AUTHENTICATION_AUDIT_ID,
	PASTE_BLOCKING_EVIDENCE_CHECK_ID,
	pasteBlockingToAxe,
} from "./paste-blocking";

function field(overrides: Partial<PasteBlockingField> = {}): PasteBlockingField {
	return {
		selector: "#password",
		html: '<input id="password" type="password">',
		kind: "password",
		signals: [],
		blocked: [],
		detectedBy: null,
		autocomplete: null,
		boxes: null,
		partialProbe: false,
		suppressed: [],
		...overrides,
	};
}

function result(
	failed: PasteBlockingField[],
	needsReview: PasteBlockingField[] = [],
	passed: PasteBlockingField[] = [],
): PasteBlockingResult {
	return {
		failed,
		needsReview,
		passed,
		summary: {
			checked: failed.length + needsReview.length + passed.length,
			failed: failed.length,
			needsReview: needsReview.length,
			passed: passed.length,
			unchecked: 0,
		},
	};
}

const blocked = field({
	signals: ["paste-blocked"],
	blocked: ["paste"],
	detectedBy: "inline-handler",
});

describe("pasteBlockingToAxe", () => {
	it("is inapplicable when the page has no authentication fields", () => {
		const output = pasteBlockingToAxe(result([]));

		expect(output.inapplicable.map(({ id }) => id)).toEqual([ACCESSIBLE_AUTHENTICATION_AUDIT_ID]);
		expect(output.inapplicable[0]?.nodes).toEqual([]);
		expect(output.violations).toEqual([]);
		expect(output.incomplete).toEqual([]);
		expect(output.passes).toEqual([]);
	});

	it("tags the audit as WCAG 2.2 AA 3.3.8", () => {
		const [audit] = pasteBlockingToAxe(result([blocked])).incomplete;

		expect(audit?.tags).toEqual(["cat.forms", "wcag22aa", "wcag338"]);
		expect(audit?.impact).toBe("serious");
	});

	it("reports blocked fields for review ahead of the other findings, never as violations", () => {
		const output = pasteBlockingToAxe(
			result(
				[blocked],
				[field({ selector: "#otp", kind: "one-time-code", signals: ["no-autofill-hint"] })],
				[field({ selector: "#email", kind: "username" })],
			),
		);

		expect(output.violations).toEqual([]);
		expect(output.incomplete).toHaveLength(1);
		expect(output.incomplete[0]?.nodes.map(({ target }) => target)).toEqual([
			["#password"],
			["#otp"],
		]);
		expect(output.passes[0]?.nodes.map(({ target }) => target)).toEqual([["#email"]]);
	});

	it("leaves a passing field without a failure summary or evidence", () => {
		const [node] = pasteBlockingToAxe(result([], [], [field()])).passes[0]?.nodes ?? [];

		expect(node).not.toHaveProperty("failureSummary");
		expect(node?.any).toEqual([]);
	});

	it("says what cancels the paste and that another sign-in method would satisfy the criterion", () => {
		const [node] = pasteBlockingToAxe(result([blocked])).incomplete[0]?.nodes ?? [];

		expect(node?.failureSummary).toContain("Nothing can be pasted into this password field");
		expect(node?.failureSummary).toContain("an onpaste attribute cancels the paste event");
		expect(node?.failureSummary).toContain("unless the page offers another way to sign in");
	});

	it("names every cancelled mechanism and a script listener", () => {
		const [node] =
			pasteBlockingToAxe(
				result([
					field({
						kind: "new-password",
						signals: ["paste-blocked"],
						blocked: ["shortcut", "paste"],
						detectedBy: "event-listener",
					}),
				]),
			).incomplete[0]?.nodes ?? [];

		expect(node?.failureSummary).toContain("this new password field");
		expect(node?.failureSummary).toContain(
			"a script's event listener cancels the Ctrl+V or Cmd+V key press and the paste event",
		);
	});

	it("describes each review signal", () => {
		const summaryFor = (overrides: Partial<PasteBlockingField>): string =>
			pasteBlockingToAxe(result([], [field(overrides)])).incomplete[0]?.nodes[0]?.failureSummary ??
			"";

		expect(
			summaryFor({
				signals: ["paste-may-be-blocked"],
				blocked: ["beforeinput"],
				detectedBy: "event-listener",
			}),
		).toContain("cancels the beforeinput event for a paste, though the paste event itself is not");
		expect(
			summaryFor({
				kind: "one-time-code",
				signals: ["partial-paste-refused"],
				blocked: ["paste"],
				detectedBy: "event-listener",
				partialProbe: true,
			}),
		).toMatch(/cancels the paste event and the field stays unchanged.*one digit short/);
		expect(
			summaryFor({ kind: "one-time-code", signals: ["split-code-paste-unhandled"], boxes: 6 }),
		).toContain("split into 6 one-character boxes");
		expect(summaryFor({ kind: "username", signals: ["readonly-until-focus"] })).toContain(
			"This username field is read-only until it is focused",
		);
		expect(summaryFor({ signals: ["autocomplete-off"], autocomplete: "off" })).toContain(
			'has autocomplete="off"',
		);
		expect(summaryFor({ signals: ["new-password-on-sign-in"] })).toContain(
			'Use autocomplete="current-password"',
		);
		expect(summaryFor({ kind: "one-time-code", signals: ["no-autofill-hint"] })).toContain(
			'no autocomplete="one-time-code"',
		);
	});

	it("joins the summaries of a field with several signals", () => {
		const [node] =
			pasteBlockingToAxe(
				result([
					field({
						signals: ["paste-blocked", "autocomplete-off"],
						blocked: ["paste"],
						detectedBy: "event-listener",
						autocomplete: "off",
					}),
				]),
			).incomplete[0]?.nodes ?? [];

		expect(node?.failureSummary).toMatch(/Nothing can be pasted.*has autocomplete="off"/);
	});

	it("attaches the structured evidence to a flagged field", () => {
		const [node] = pasteBlockingToAxe(result([blocked])).incomplete[0]?.nodes ?? [];

		expect(node?.any).toEqual([
			{
				id: PASTE_BLOCKING_EVIDENCE_CHECK_ID,
				impact: "serious",
				message: "The password field was flagged for: paste-blocked",
				data: {
					kind: "password",
					signals: ["paste-blocked"],
					blocked: ["paste"],
					detectedBy: "inline-handler",
					autocomplete: null,
					boxes: null,
					partialProbe: false,
					suppressed: [],
				},
			},
		]);
	});
});
