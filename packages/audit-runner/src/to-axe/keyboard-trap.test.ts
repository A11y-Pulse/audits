import type { KeyboardTrapResult } from "@a11y-pulse/keyboard-trap-audit";
import { describe, expect, it } from "vitest";
import { AUDIT_INCONCLUSIVE_TAG } from "./audit-output";
import {
	KEYBOARD_TRAP_AUDIT_ID,
	KEYBOARD_TRAP_EVIDENCE_CHECK_ID,
	keyboardTrapToAxe,
} from "./keyboard-trap";

function result(overrides: Partial<KeyboardTrapResult> = {}): KeyboardTrapResult {
	return {
		outcome: "no-cycle",
		inconclusiveReason: null,
		ring: [],
		ringSize: 0,
		container: null,
		dialog: null,
		excludedCount: 0,
		escapedVia: null,
		roundsAttempted: 0,
		keysTried: [],
		attempts: [],
		sampledRing: false,
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
				keysTried: ["Escape", "Shift+Tab", "ArrowDown", "Tab", "ArrowRight"],
			}),
		);

		expect(output.violations).toEqual([]);
		expect(output.incomplete[0]?.id).toBe(KEYBOARD_TRAP_AUDIT_ID);
		expect(output.incomplete[0]?.nodes[0]?.target).toEqual(["#widget"]);
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("within 2 element(s)");
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("across 2 attempts");
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain(
			"did not leave via Tab, Shift+Tab, Escape or arrow keys",
		);
	});

	it("names only the keys that were pressed", () => {
		const output = keyboardTrapToAxe(
			result({
				outcome: "trapped",
				container: WIDGET,
				ringSize: 1,
				roundsAttempted: 2,
				keysTried: ["Shift+Tab", "Tab"],
			}),
		);
		const summary = output.incomplete[0]?.nodes[0]?.failureSummary;

		expect(summary).toContain("did not leave via Tab or Shift+Tab across");
		expect(summary).not.toContain("Escape");
		expect(summary).not.toContain("arrow");
	});

	it("says when the trapping component is a dialog with buttons that were not activated", () => {
		const output = keyboardTrapToAxe(
			result({
				outcome: "trapped",
				container: WIDGET,
				keysTried: ["Escape", "Shift+Tab", "Tab"],
				dialog: { role: "dialog", native: false, modal: true, buttons: 2 },
			}),
		);

		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain(
			"is a dialog with 2 button(s) or link(s), which were not activated",
		);
	});

	it("sends focus that never left an iframe for review, against the iframe", () => {
		const frame = { selector: "#booking", html: '<iframe id="booking">' };
		const output = keyboardTrapToAxe(
			result({ outcome: "inconclusive", inconclusiveReason: "stuck-in-frame", container: frame }),
		);

		expect(output.incomplete[0]?.nodes[0]?.target).toEqual(["#booking"]);
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("did not come back out");
		expect(output.violations).toEqual([]);
	});

	it("sends a ring whose only exit is the browser's own interface for review", () => {
		const output = keyboardTrapToAxe(
			result({
				outcome: "inconclusive",
				inconclusiveReason: "page-edge-only",
				container: WIDGET,
				ringSize: 2,
				excludedCount: 1,
			}),
		);

		expect(output.incomplete[0]?.nodes[0]?.target).toEqual(["#widget"]);
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("pulled focus back");
	});

	it("sends a ring too large to test in full for review, and says which members were not tried", () => {
		const output = keyboardTrapToAxe(
			result({
				outcome: "inconclusive",
				inconclusiveReason: "ring-sampled",
				sampledRing: true,
				container: WIDGET,
				ringSize: 150,
				excludedCount: 2,
				roundsAttempted: 2,
				keysTried: ["Escape", "Shift+Tab", "Tab"],
			}),
		);
		const node = output.incomplete[0]?.nodes[0];

		expect(output.violations).toEqual([]);
		expect(output.passes).toEqual([]);
		expect(node?.target).toEqual(["#widget"]);
		expect(node?.failureSummary).toContain("within 150 element(s)");
		expect(node?.failureSummary).toContain("did not leave via Tab, Shift+Tab or Escape");
		expect(node?.failureSummary).toContain("too large to test in full");
		expect(node?.failureSummary).toContain(
			"a way out from an element in the middle of it was not tried",
		);
		// A ring that was walked in full makes no such claim.
		expect(
			keyboardTrapToAxe(result({ outcome: "trapped", container: WIDGET, ringSize: 3 }))
				.incomplete[0]?.nodes[0]?.failureSummary,
		).not.toContain("too large");
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

	it("reports a traversal that could not be trusted as incomplete, with the reason", () => {
		const output = keyboardTrapToAxe(
			result({ outcome: "inconclusive", inconclusiveReason: "ring-changed", container: WIDGET }),
		);

		expect([output.violations, output.passes, output.inapplicable]).toEqual([[], [], []]);
		expect(output.incomplete[0]?.id).toBe(KEYBOARD_TRAP_AUDIT_ID);
		expect(output.incomplete[0]?.tags).toContain(AUDIT_INCONCLUSIVE_TAG);
		expect(output.incomplete[0]?.description).toContain("page changed the elements");
		expect(output.incomplete[0]?.nodes).toEqual([]);
	});

	it("carries the ring, the keys pressed and where each landed as structured evidence", () => {
		const attempts = [
			{
				round: 1,
				key: "Escape" as const,
				presses: 1,
				from: "#close",
				landed: "#close",
				exited: false,
				cancelled: true,
			},
		];
		const dialog = { role: "dialog" as const, native: false, modal: true, buttons: 2 };
		const output = keyboardTrapToAxe(
			result({
				outcome: "trapped",
				container: WIDGET,
				ring: [WIDGET, WIDGET],
				ringSize: 2,
				excludedCount: 4,
				roundsAttempted: 1,
				keysTried: ["Escape"],
				attempts,
				dialog,
			}),
		);

		expect(output.incomplete[0]?.nodes[0]?.any[0]).toMatchObject({
			id: KEYBOARD_TRAP_EVIDENCE_CHECK_ID,
			data: {
				outcome: "trapped",
				ring: [WIDGET, WIDGET],
				ringSize: 2,
				excludedCount: 4,
				keysTried: ["Escape"],
				attempts,
				dialog,
			},
		});
	});
});
