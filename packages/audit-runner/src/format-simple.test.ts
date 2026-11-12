import type { AxeResults, Result } from "axe-core";
import { describe, expect, it } from "vitest";
import { formatSimple } from "./format-simple";

function violation(overrides: Partial<Result>): Result {
	return {
		id: "region",
		impact: "moderate",
		help: "All page content should be contained by landmarks",
		description: "",
		helpUrl: "https://dequeuniversity.com/rules/axe/4.11/region",
		tags: [],
		nodes: [],
		...overrides,
	};
}

function results(violations: Result[], incomplete: Result[] = []): AxeResults {
	return {
		url: "https://a.test/",
		violations,
		passes: [],
		incomplete,
	} as unknown as AxeResults;
}

function nodesTargeting(...targets: string[]) {
	return targets.map((target) => ({ target: [target], html: "", any: [], all: [], none: [] }));
}

describe("formatSimple", () => {
	it("lists each failed audit with its targets", () => {
		const output = formatSimple(
			results([
				violation({
					id: "html-has-lang",
					impact: "serious",
					help: "Needs a lang",
					helpUrl: "",
					nodes: nodesTargeting("html"),
				}),
				violation({ nodes: nodesTargeting("h1", "p") }),
			]),
			false,
		);

		expect(output).toBe(
			[
				"✖ 2 failed audits on https://a.test/",
				"",
				"html-has-lang · serious",
				"  Needs a lang",
				"  › selector  html",
				"",
				"region · moderate",
				"  All page content should be contained by landmarks",
				"  › selector  h1",
				"  › selector  p",
				"  https://dequeuniversity.com/rules/axe/4.11/region",
			].join("\n"),
		);
	});

	it("truncates long target lists", () => {
		const output = formatSimple(
			results([violation({ nodes: nodesTargeting("a", "b", "c", "d", "e", "f", "g") })]),
			false,
		);

		expect(output).toContain("  › selector  e\n    … and 2 more\n");
		expect(output).not.toContain("selector  f");
	});

	it("joins selectors that cross iframes and shadow roots", () => {
		const nodes = [
			{ target: ["iframe", ["my-app", "button"]], html: "", any: [], all: [], none: [] },
		];
		const output = formatSimple(
			results([violation({ nodes } as unknown as Partial<Result>)]),
			false,
		);

		expect(output).toContain("  › selector  iframe ▸ my-app ▸ button\n");
	});

	it("shows each node's html beneath its selector, collapsed and shortened", () => {
		const nodes = [
			{ target: ["h1"], html: "<h1>\n\t\tWho Likes Dogs?</h1>", any: [], all: [], none: [] },
			{ target: ["p"], html: `<p>${"x".repeat(200)}</p>`, any: [], all: [], none: [] },
		];
		const output = formatSimple(results([violation({ nodes })]), false);

		expect(output).toContain("  › selector  h1\n    html      <h1> Who Likes Dogs?</h1>\n");
		expect(output).toContain(`  › selector  p\n    html      <p>${"x".repeat(96)}…\n`);
	});

	it("reports a clean page", () => {
		expect(formatSimple(results([]), false)).toBe("✔ No failed audits on https://a.test/");
	});

	it("lists a finding that needs review, naming the element and why, on a page with no failures", () => {
		const trap = violation({
			id: "keyboard-trap",
			impact: "serious",
			help: "Keyboard focus must be able to leave every component it can enter",
			helpUrl: "",
			nodes: [
				{
					target: ["#toolbar"],
					html: '<div id="toolbar">',
					any: [],
					all: [],
					none: [],
					failureSummary:
						"Focus cycled within 2 element(s) and did not leave via Tab or Escape.\nSecond line.",
				},
			],
		} as unknown as Partial<Result>);
		const output = formatSimple(results([], [trap]), false);
		const [failed, review] = output.split("⚠");

		expect(failed).toContain("✔ No failed audits on https://a.test/");
		expect(review).toContain("1 audit needs review");
		expect(review).toContain("keyboard-trap · serious");
		expect(review).toContain("  › selector  #toolbar\n");
		expect(review).toContain(
			"    why       Focus cycled within 2 element(s) and did not leave via",
		);
		expect(review).not.toContain("Second line.");
	});

	it("lists review findings after the failed audits, not among them", () => {
		const output = formatSimple(
			results(
				[violation({ id: "html-has-lang", nodes: nodesTargeting("html") })],
				[violation({ id: "focus-order", nodes: nodesTargeting("#jump") })],
			),
			false,
		);

		expect(output).toContain("✖ 1 failed audit on https://a.test/");
		expect(output.indexOf("html-has-lang")).toBeLessThan(output.indexOf("needs review"));
		expect(output.indexOf("needs review")).toBeLessThan(output.indexOf("focus-order"));
	});

	it("shows an audit that could not run, with the reason, since it has no element to name", () => {
		const failedAudit = violation({
			id: "reflow",
			impact: null,
			help: "Reflow could not be completed",
			description: "Reflow did not finish, so this page has not been checked by it: boom",
			helpUrl: "",
		});
		const output = formatSimple(results([], [failedAudit]), false);

		expect(output).toContain("1 audit needs review");
		expect(output).toContain("reflow\n  Reflow could not be completed");
		expect(output).toContain("this page has not been checked by it: boom");
	});

	it("explains a failed node with the first line of its summary, past axe-core's heading", () => {
		const nodes = [
			{
				target: ["img"],
				html: "<img>",
				any: [],
				all: [],
				none: [],
				failureSummary:
					"Fix any of the following:\n  Element does not have an alt attribute\n  aria-label attribute does not exist",
			},
		];
		const output = formatSimple(
			results([violation({ nodes } as unknown as Partial<Result>)]),
			false,
		);

		expect(output).toContain(
			"    why       Fix any of the following: Element does not have an alt attribute\n",
		);
		expect(output).not.toContain("aria-label attribute does not exist");
	});

	it("shows fewer elements for a review finding than for a failure", () => {
		const output = formatSimple(
			results([], [violation({ nodes: nodesTargeting("a", "b", "c", "d", "e") })]),
			false,
		);

		expect(output).toContain("selector  c\n    … and 2 more");
		expect(output).not.toContain("selector  d");
	});

	it("colours output only when asked", () => {
		const page = results([violation({ nodes: nodesTargeting("h1") })]);

		expect(formatSimple(page, false)).not.toContain("\x1b[");
		expect(formatSimple(page, true)).toContain("\x1b[");
	});
});
