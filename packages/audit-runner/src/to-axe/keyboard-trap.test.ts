import type { KeyboardTrapResult } from "@a11y-pulse/keyboard-trap-audit";
import { describe, expect, it } from "vitest";
import { KEYBOARD_TRAP_AUDIT_ID, keyboardTrapToAxe } from "./keyboard-trap";

function result(overrides: Partial<KeyboardTrapResult> = {}): KeyboardTrapResult {
	return {
		outcome: "no-cycle",
		ring: [],
		ringSize: 0,
		container: null,
		excludedCount: 0,
		escapedVia: null,
		roundsAttempted: 0,
		summary: {
			checked: 3,
			passed: 1,
			failed: 0,
			reachedLimit: false,
			reachedFailedElementLimit: false,
			timedOut: false,
			sessionEnd: "completed",
		},
		...overrides,
	};
}

const WIDGET = { selector: "#widget", html: '<div id="widget">' };

describe("keyboardTrapToAxe", () => {
	it("reports a trap as needing review, never as a violation", () => {
		const output = keyboardTrapToAxe(
			result({
				outcome: "trapped",
				container: WIDGET,
				ring: [WIDGET, WIDGET],
				ringSize: 2,
				excludedCount: 4,
				roundsAttempted: 2,
			}),
		);

		expect(output.violations).toEqual([]);
		expect(output.incomplete[0]?.id).toBe(KEYBOARD_TRAP_AUDIT_ID);
		expect(output.incomplete[0]?.nodes[0]?.target).toEqual(["#widget"]);
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("within 2 element(s)");
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("across 2 attempts");
	});

	it("passes a page with no cycle without naming a node", () => {
		const output = keyboardTrapToAxe(result());

		expect(output.passes[0]?.nodes).toEqual([]);
	});

	it("passes an escapable cycle against its container", () => {
		const output = keyboardTrapToAxe(
			result({ outcome: "escaped", container: WIDGET, escapedVia: "escape-key" }),
		);

		expect(output.passes[0]?.nodes[0]?.target).toEqual(["#widget"]);
		expect(output.passes[0]?.nodes[0]).not.toHaveProperty("failureSummary");
	});

	it("is inapplicable when nothing takes focus", () => {
		expect(keyboardTrapToAxe(result({ outcome: "no-focusable" })).inapplicable[0]?.id).toBe(
			KEYBOARD_TRAP_AUDIT_ID,
		);
	});

	it("reports nothing when the traversal could not be trusted", () => {
		const output = keyboardTrapToAxe(result({ outcome: "inconclusive" }));

		expect([output.violations, output.incomplete, output.passes, output.inapplicable]).toEqual([
			[],
			[],
			[],
			[],
		]);
	});
});
