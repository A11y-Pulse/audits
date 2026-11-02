import type {
	SuspiciousNameElement,
	SuspiciousNameResult,
} from "@a11y-pulse/suspicious-accessible-name-audit";
import { describe, expect, it } from "vitest";
import {
	SUSPICIOUS_ACCESSIBLE_NAME_AUDIT_ID,
	suspiciousAccessibleNameToAxe,
} from "./suspicious-accessible-name";

function element(overrides: Partial<SuspiciousNameElement> = {}): SuspiciousNameElement {
	return {
		selector: "#a",
		html: "<button>",
		name: "Add to basket",
		nameSource: "content",
		role: "button",
		signal: null,
		evidence: null,
		criterion: "2.4.6",
		...overrides,
	};
}

function result(
	failed: SuspiciousNameElement[],
	needsReview: SuspiciousNameElement[] = [],
	passed: SuspiciousNameElement[] = [],
): SuspiciousNameResult {
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

describe("suspiciousAccessibleNameToAxe", () => {
	it("routes each list to its bucket", () => {
		const output = suspiciousAccessibleNameToAxe(
			result(
				[element({ selector: "#failed", signal: "artefact" })],
				[element({ selector: "#review", signal: "identifier-pattern" })],
				[element({ selector: "#passed" })],
			),
		);

		expect(output.violations[0]?.id).toBe(SUSPICIOUS_ACCESSIBLE_NAME_AUDIT_ID);
		expect(output.violations[0]?.nodes[0]?.target).toEqual(["#failed"]);
		expect(output.incomplete[0]?.nodes[0]?.target).toEqual(["#review"]);
		expect(output.passes[0]?.nodes[0]?.target).toEqual(["#passed"]);
		expect(output.passes[0]?.nodes[0]).not.toHaveProperty("failureSummary");
	});

	it("tags each bucket with the criteria of its elements", () => {
		const output = suspiciousAccessibleNameToAxe(
			result(
				[
					element({ signal: "artefact", criterion: "2.4.6" }),
					element({ signal: "artefact", criterion: "1.1.1" }),
				],
				[element({ signal: "identifier-pattern", criterion: "2.4.4" })],
			),
		);

		expect(output.violations[0]?.tags).toEqual([
			"wcag2a",
			"wcag111",
			"wcag2aa",
			"wcag246",
			"cat.name-role-value",
		]);
		expect(output.violations[0]?.impact).toBe("serious");
		expect(output.incomplete[0]?.tags).toEqual(["wcag2a", "wcag244", "cat.name-role-value"]);
	});

	it("reports role words alone as minor best practice", () => {
		const roleWord = element({ signal: "role-word", evidence: "button", criterion: null });

		const alone = suspiciousAccessibleNameToAxe(result([], [roleWord]));
		const mixed = suspiciousAccessibleNameToAxe(
			result([], [roleWord, element({ signal: "placeholder-suffix", criterion: "2.4.6" })]),
		);

		expect(alone.incomplete[0]).toMatchObject({
			impact: "minor",
			tags: ["best-practice", "cat.name-role-value"],
		});
		expect(mixed.incomplete[0]).toMatchObject({
			impact: "serious",
			tags: ["wcag2aa", "wcag246", "best-practice", "cat.name-role-value"],
		});
	});

	it("names the accessible name and what is wrong with it", () => {
		const output = suspiciousAccessibleNameToAxe(
			result(
				[
					element({
						name: "quantity-selector",
						signal: "attribute-match",
						evidence: "class",
					}),
					element({ name: "{{title}}", signal: "artefact" }),
				],
				[
					element({ name: "banner1", signal: "placeholder-suffix" }),
					element({ name: "Disclaimer button", signal: "role-word", evidence: "button" }),
				],
			),
		);

		expect(output.violations[0]?.nodes.map(({ failureSummary }) => failureSummary)).toEqual([
			'The accessible name "quantity-selector" is also the element\'s `class`. Replace it with a name that says what the element is or does.',
			'The accessible name "{{title}}" is a leftover script value, template token or placeholder. Replace it with a name that says what the element is or does.',
		]);
		expect(output.incomplete[0]?.nodes.map(({ failureSummary }) => failureSummary)).toEqual([
			'The accessible name "banner1" looks like a numbered placeholder. Check that it is a name a person would use; if it is not, replace it with a name that says what the element is or does.',
			'The accessible name "Disclaimer button" ends with the role word "button". Screen readers announce the element\'s role, so remove the word, or give the element the role it names.',
		]);
	});

	it("is inapplicable when nothing was checked", () => {
		const output = suspiciousAccessibleNameToAxe(result([]));

		expect(output.inapplicable).toMatchObject([
			{
				id: SUSPICIOUS_ACCESSIBLE_NAME_AUDIT_ID,
				nodes: [],
				tags: [
					"wcag2a",
					"wcag111",
					"wcag244",
					"wcag2aa",
					"wcag246",
					"best-practice",
					"cat.name-role-value",
				],
			},
		]);
		expect(output.violations).toEqual([]);
	});
});
