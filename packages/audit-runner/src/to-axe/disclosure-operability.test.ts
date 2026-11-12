import type {
	DisclosureOperabilityResult,
	DisclosureTrigger,
} from "@a11y-pulse/disclosure-operability-audit";
import { describe, expect, it } from "vitest";
import {
	DISCLOSURE_OPERABILITY_AUDIT_ID,
	DISCLOSURE_OPERABILITY_EVIDENCE_CHECK_ID,
	disclosureOperabilityToAxe,
} from "./disclosure-operability";

function trigger(overrides: Partial<DisclosureTrigger> = {}): DisclosureTrigger {
	return {
		selector: "#toggle",
		html: '<button id="toggle" aria-expanded="false">',
		role: null,
		expanded: "false",
		controls: "#panel",
		signals: [],
		keysTried: ["Enter", "Space"],
		attempts: [
			{
				key: "Enter",
				expandedBefore: "false",
				expandedAfter: "true",
				contentChanged: true,
				restoredBy: "Enter",
			},
		],
		pointer: { click: null, hover: null },
		openedOnFocus: false,
		restored: true,
		...overrides,
	};
}

function result(parts: Partial<DisclosureOperabilityResult> = {}): DisclosureOperabilityResult {
	const failed = parts.failed ?? [];
	const needsReview = parts.needsReview ?? [];
	const passed = parts.passed ?? [];

	return {
		failed,
		needsReview,
		passed,
		skipped: [],
		stopped: null,
		summary: {
			checked: failed.length + needsReview.length + passed.length,
			failed: failed.length,
			needsReview: needsReview.length,
			passed: passed.length,
			skipped: 0,
			unchecked: 0,
		},
		...parts,
	};
}

describe("disclosureOperabilityToAxe", () => {
	it("is inapplicable when no trigger was operated, even if some were skipped", () => {
		const output = disclosureOperabilityToAxe(
			result({
				skipped: [{ selector: "#shop", html: "<a>", reason: "navigating-link" }],
			}),
		);

		expect(output.inapplicable.map(({ id }) => id)).toEqual([DISCLOSURE_OPERABILITY_AUDIT_ID]);
		expect(output.violations).toEqual([]);
		expect(output.incomplete).toEqual([]);
		expect(output.passes).toEqual([]);
	});

	it("sorts failed, review and passed triggers into violations, incomplete and passes", () => {
		const output = disclosureOperabilityToAxe(
			result({
				failed: [trigger({ selector: "#a", signals: ["keyboard-inoperable"] })],
				needsReview: [trigger({ selector: "#b", signals: ["unresponsive"] })],
				passed: [trigger({ selector: "#c" })],
			}),
		);

		expect(output.violations[0]?.nodes.map(({ target }) => target)).toEqual([["#a"]]);
		expect(output.incomplete[0]?.nodes.map(({ target }) => target)).toEqual([["#b"]]);
		expect(output.passes[0]?.nodes.map(({ target }) => target)).toEqual([["#c"]]);
		expect(output.passes[0]?.nodes[0]).not.toHaveProperty("failureSummary");
		expect(output.violations[0]).toMatchObject({
			id: DISCLOSURE_OPERABILITY_AUDIT_ID,
			impact: "serious",
			tags: expect.arrayContaining(["wcag211", "wcag412"]),
		});
	});

	it("names the keys pressed and the pointer action that did work", () => {
		const output = disclosureOperabilityToAxe(
			result({
				failed: [
					trigger({ signals: ["keyboard-inoperable"], pointer: { click: true, hover: null } }),
					trigger({
						signals: ["keyboard-inoperable"],
						keysTried: ["Enter"],
						pointer: { click: false, hover: true },
					}),
					trigger({
						signals: ["not-focusable"],
						keysTried: [],
						pointer: { click: true, hover: null },
					}),
				],
			}),
		);
		const summaries = output.violations[0]?.nodes.map(({ failureSummary }) => failureSummary);

		expect(summaries?.[0]).toContain(
			"opens with a click but pressing Enter and Space does nothing",
		);
		expect(summaries?.[1]).toContain("opens with hovering but pressing Enter does nothing");
		expect(summaries?.[2]).toContain("opens with a click but cannot receive keyboard focus");
	});

	it("tells a stale aria-expanded from a missing one", () => {
		const output = disclosureOperabilityToAxe(
			result({
				failed: [
					trigger({ signals: ["state-not-exposed"] }),
					trigger({ signals: ["state-not-exposed"], expanded: null }),
				],
			}),
		);

		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain('aria-expanded stays "false"');
		expect(output.violations[0]?.nodes[1]?.failureSummary).toContain("has no aria-expanded");
	});

	it("joins the message for every signal on a trigger", () => {
		const output = disclosureOperabilityToAxe(
			result({
				needsReview: [trigger({ signals: ["space-inoperable", "pointer-only-close"] })],
			}),
		);
		const summary = output.incomplete[0]?.nodes[0]?.failureSummary;

		expect(summary).toContain("not with Space");
		expect(summary).toContain("only a click closed");
	});

	it("reports a navigation as incomplete, saying later controls were not checked", () => {
		const output = disclosureOperabilityToAxe(
			result({
				stopped: "navigated",
				needsReview: [trigger({ signals: ["navigated"], restored: false })],
			}),
		);

		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain(
			"the controls after it were not checked",
		);
	});

	it("says when a form submission or a navigation was stopped", () => {
		const output = disclosureOperabilityToAxe(
			result({
				needsReview: [
					trigger({ selector: "#apply", signals: ["submit-blocked"] }),
					trigger({ selector: "#go", signals: ["navigation-blocked"] }),
				],
			}),
		);
		const [submit, navigation] = output.incomplete[0]?.nodes ?? [];

		expect(submit?.failureSummary).toContain("tried to submit a form, which was stopped");
		expect(navigation?.failureSummary).toContain("tried to load another page, which was stopped");
		expect(output.violations).toEqual([]);
	});

	it("says a control left open may have taken focus", () => {
		const output = disclosureOperabilityToAxe(
			result({ needsReview: [trigger({ signals: ["not-restored"], restored: false })] }),
		);

		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("was left open");
	});

	it("attaches what each key press changed as evidence", () => {
		const item = trigger({ signals: ["state-not-exposed"] });
		const output = disclosureOperabilityToAxe(result({ failed: [item] }));

		expect(output.violations[0]?.nodes[0]?.any).toEqual([
			{
				id: DISCLOSURE_OPERABILITY_EVIDENCE_CHECK_ID,
				impact: "serious",
				message: "What each key press changed",
				data: {
					signals: ["state-not-exposed"],
					expanded: "false",
					controls: "#panel",
					keysTried: ["Enter", "Space"],
					attempts: item.attempts,
					pointer: { click: null, hover: null },
					openedOnFocus: false,
					restored: true,
				},
			},
		]);
	});
});
