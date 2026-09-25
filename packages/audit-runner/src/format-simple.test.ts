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

function results(violations: Result[]): AxeResults {
	return {
		url: "https://a.test/",
		violations,
		passes: [],
		incomplete: [],
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

	it("colours output only when asked", () => {
		const page = results([violation({ nodes: nodesTargeting("h1") })]);

		expect(formatSimple(page, false)).not.toContain("\x1b[");
		expect(formatSimple(page, true)).toContain("\x1b[");
	});
});
