import type { FocusOrderResult, FocusOrderTransition } from "@a11y-pulse/focus-order-audit";
import { describe, expect, it } from "vitest";
import { FOCUS_ORDER_AUDIT_ID, focusOrderToAxe } from "./focus-order";

function transition(
	from: number,
	to: number,
	kind: FocusOrderTransition["kind"] = "backwards-jump",
) {
	return {
		kind,
		from: { selector: `#s${from}`, html: `<a id="s${from}">`, tabIndex: from },
		to: { selector: `#s${to}`, html: `<a id="s${to}">`, tabIndex: to },
	};
}

function result(overrides: Partial<FocusOrderResult> = {}): FocusOrderResult {
	return {
		outcome: "disordered",
		transitions: [transition(1, 2), transition(2, 3), transition(3, 4)],
		positiveTabindex: false,
		summary: {
			checked: 4,
			passed: 0,
			failed: 1,
			reachedLimit: false,
			reachedFailedElementLimit: false,
			timedOut: false,
			sessionEnd: "completed",
		},
		...overrides,
	};
}

describe("focusOrderToAxe", () => {
	it("reports disorder for review, tagged experimental, against each jump's origin", () => {
		const output = focusOrderToAxe(result());
		const entry = output.incomplete[0];

		expect(output.violations).toEqual([]);
		expect(entry?.id).toBe(FOCUS_ORDER_AUDIT_ID);
		expect(entry?.tags).toContain("experimental");
		expect(entry?.nodes.map((node) => node.target)).toEqual([["#s1"], ["#s2"], ["#s3"]]);
		expect(entry?.nodes[0]?.failureSummary).toContain("to `#s2` (tab stops 1 → 2)");
		expect(entry?.nodes[0]?.failureSummary).toContain("one of 3 such moves");
	});

	it("points at positive tabindex when the page has some", () => {
		const output = focusOrderToAxe(result({ positiveTabindex: true }));

		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("positive tabindex");
	});

	it("lists each origin once and caps the nodes", () => {
		const transitions = [
			transition(1, 2),
			transition(1, 2, "column-thrash"),
			...Array.from({ length: 20 }, (_, i) => transition(i + 3, i + 4)),
		];
		const nodes = focusOrderToAxe(result({ transitions })).incomplete[0]?.nodes ?? [];

		expect(nodes).toHaveLength(10);
		expect(nodes.filter((node) => node.target[0] === "#s1")).toHaveLength(1);
	});

	it("reports nothing at all for an unremarkable sequence, never a pass", () => {
		const output = focusOrderToAxe(result({ outcome: "unremarkable", transitions: [] }));

		expect([output.violations, output.incomplete, output.passes, output.inapplicable]).toEqual([
			[],
			[],
			[],
			[],
		]);
	});
});
