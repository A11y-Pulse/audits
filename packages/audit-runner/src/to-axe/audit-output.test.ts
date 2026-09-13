import { describe, expect, it } from "vitest";
import { type AuditMetadata, emptyOutput, mergeOutputs, toNode, toResult } from "./audit-output";

const METADATA: AuditMetadata = {
	id: "example",
	help: "Example audit",
	description: "An example.",
	helpUrl: "https://example.com/",
	impact: "serious",
	tags: ["wcag2aa"],
};

describe("toNode", () => {
	it("builds an axe-core node with empty check arrays", () => {
		expect(toNode({ selector: "#a", html: "<a>" })).toEqual({
			target: ["#a"],
			html: "<a>",
			any: [],
			all: [],
			none: [],
		});
	});

	it("omits failureSummary unless one is given", () => {
		expect(toNode({ selector: "#a", html: "<a>" })).not.toHaveProperty("failureSummary");
		expect(toNode({ selector: "#a", html: "<a>", failureSummary: "Nope." })).toHaveProperty(
			"failureSummary",
			"Nope.",
		);
	});

	it("attaches evidence as a single check on `any`", () => {
		const evidence = { id: "e", impact: "serious", message: "m", data: { screenshot: 1 } };

		expect(toNode({ selector: "#a", html: "<a>", evidence }).any).toEqual([evidence]);
	});
});

describe("toResult", () => {
	it("keeps the audit metadata alongside the converted nodes", () => {
		expect(toResult(METADATA, [{ selector: "#a", html: "<a>" }])).toMatchObject({
			...METADATA,
			nodes: [{ target: ["#a"] }],
		});
	});
});

describe("mergeOutputs", () => {
	it("concatenates each bucket in the order the audits ran", () => {
		const first = { ...emptyOutput(), violations: [toResult(METADATA, [])] };
		const second = {
			...emptyOutput(),
			violations: [toResult({ ...METADATA, id: "second" }, [])],
			passes: [toResult({ ...METADATA, id: "third" }, [])],
		};

		const merged = mergeOutputs([first, second]);

		expect(merged.violations.map((audit) => audit.id)).toEqual(["example", "second"]);
		expect(merged.passes.map((audit) => audit.id)).toEqual(["third"]);
		expect(merged.incomplete).toEqual([]);
		expect(merged.inapplicable).toEqual([]);
	});
});
