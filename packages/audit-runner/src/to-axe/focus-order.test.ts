import type { FocusOrderResult, FocusOrderTransition } from "@a11y-pulse/focus-order-audit";
import { describe, expect, it } from "vitest";
import { AUDIT_INCONCLUSIVE_TAG } from "./audit-output";
import {
	FOCUS_ORDER_AUDIT_ID,
	FOCUS_ORDER_EVIDENCE_CHECK_ID,
	focusOrderToAxe,
} from "./focus-order";

function transition(
	from: number,
	to: number,
	kind: FocusOrderTransition["kind"] = "backwards-jump",
): FocusOrderTransition {
	const rect = { x: 0, y: 0, width: 100, height: 20 };

	return {
		kind,
		from: { selector: `#s${from}`, html: `<a id="s${from}">`, tabIndex: from, rect },
		to: { selector: `#s${to}`, html: `<a id="s${to}">`, tabIndex: to, rect },
		distance: { block: -1200, inline: 0 },
		direction: "up",
		steps: to - from,
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
	it("reports disorder for review against each jump's origin", () => {
		const output = focusOrderToAxe(result());
		const entry = output.incomplete[0];

		expect(output.violations).toEqual([]);
		expect(entry?.id).toBe(FOCUS_ORDER_AUDIT_ID);
		expect(entry?.nodes.map((node) => node.target)).toEqual([["#s1"], ["#s2"], ["#s3"]]);
		expect(entry?.nodes[0]?.failureSummary).toContain("to `#s2` (tab stops 1 → 2)");
		expect(entry?.nodes[0]?.failureSummary).toContain("one of 3 such moves");
	});

	it("points at positive tabindex when the page has some", () => {
		const output = focusOrderToAxe(result({ positiveTabindex: true }));

		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("positive tabindex");
	});

	it("names the element whose own positive tabindex is behind a move", () => {
		const jump = transition(1, 2);
		jump.to.positiveTabindex = 3;
		const summary = focusOrderToAxe(result({ transitions: [jump], positiveTabindex: true }))
			.incomplete[0]?.nodes[0]?.failureSummary;

		expect(summary).toContain('`#s2` has tabindex="3"');
		expect(summary).not.toContain("such moves");
	});

	it("describes a run of short climbs as steady movement back up the page", () => {
		const output = focusOrderToAxe(result({ transitions: [transition(1, 9, "backwards-drift")] }));

		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain(
			"steadily back up the page, one element at a time, to `#s9` (tab stops 1 → 9).",
		);
	});

	it("says which way focus went, since backwards is sideways on a vertical page", () => {
		// vertical-rl: the page reads right to left, so a backwards jump goes right on screen.
		const jump: FocusOrderTransition = { ...transition(1, 2), direction: "right" };
		const drift: FocusOrderTransition = {
			...transition(2, 9, "backwards-drift"),
			direction: "right",
		};
		const nodes = focusOrderToAxe(result({ transitions: [jump, drift] })).incomplete[0]?.nodes;

		expect(nodes?.[0]?.failureSummary).toContain(
			"a long way back towards the right of the page to `#s2`",
		);
		expect(nodes?.[1]?.failureSummary).toContain(
			"steadily back towards the right of the page, one element at a time, to `#s9`",
		);
		expect(nodes?.map((node) => node.failureSummary).join(" ")).not.toContain("up the page");

		// A jump back across a horizontal page that barely climbs goes left on screen.
		const across: FocusOrderTransition = { ...transition(1, 2), direction: "left" };

		expect(
			focusOrderToAxe(result({ transitions: [across] })).incomplete[0]?.nodes[0]?.failureSummary,
		).toContain("a long way back towards the left of the page to `#s2`");
		expect(focusOrderToAxe(result()).incomplete[0]?.nodes[0]?.failureSummary).toContain(
			"a long way back up the page to `#s2`",
		);
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

	it("reports a traversal that could not be judged as incomplete, with the reason", () => {
		const base = result();
		const output = focusOrderToAxe(
			result({
				outcome: "inconclusive",
				transitions: [],
				summary: { ...base.summary, sessionEnd: "navigation" },
			}),
		);

		expect(output.passes).toEqual([]);
		expect(output.incomplete[0]?.id).toBe(FOCUS_ORDER_AUDIT_ID);
		expect(output.incomplete[0]?.tags).toContain(AUDIT_INCONCLUSIVE_TAG);
		expect(output.incomplete[0]?.description).toContain("navigated away");
	});

	it("is inapplicable when the page has nothing to focus", () => {
		const output = focusOrderToAxe(result({ outcome: "no-focusable", transitions: [] }));

		expect(output.inapplicable[0]?.id).toBe(FOCUS_ORDER_AUDIT_ID);
		expect(output.incomplete).toEqual([]);
	});

	it("carries each jump's geometry as structured evidence", () => {
		const output = focusOrderToAxe(result());

		expect(output.incomplete[0]?.nodes[0]?.any[0]).toMatchObject({
			id: FOCUS_ORDER_EVIDENCE_CHECK_ID,
			data: {
				kind: "backwards-jump",
				direction: "up",
				distance: { block: -1200, inline: 0 },
				from: { selector: "#s1", tabIndex: 1, rect: { x: 0, y: 0, width: 100, height: 20 } },
				to: { selector: "#s2", tabIndex: 2 },
				totalTransitions: 3,
			},
		});
	});
});
