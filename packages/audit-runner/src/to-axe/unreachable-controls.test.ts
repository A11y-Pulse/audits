import type {
	MissingRoleControl,
	UnreachableControl,
	UnreachableControlsResult,
} from "@a11y-pulse/unreachable-controls-audit";
import { describe, expect, it } from "vitest";
import {
	CONTROL_WITHOUT_ROLE_AUDIT_ID,
	KEYBOARD_REACHABILITY_AUDIT_ID,
	UNREACHABLE_CONTROLS_EVIDENCE_CHECK_ID,
	unreachableControlsToAxe,
} from "./unreachable-controls";

function unreachable(overrides: Partial<UnreachableControl> = {}): UnreachableControl {
	return {
		selector: "#card",
		html: '<div id="card">',
		text: "Ridgeline 2",
		verdict: "failed",
		reason: "click-handler",
		signals: { listeners: ["click"], role: null, cursorPointer: true, tabindex: null },
		...overrides,
	};
}

function missingRole(overrides: Partial<MissingRoleControl> = {}): MissingRoleControl {
	return {
		selector: "#save",
		html: '<div id="save" tabindex="0">',
		text: "Save",
		verdict: "failed",
		reason: "handler-without-role",
		signals: { listeners: ["click", "keydown"], role: null, cursorPointer: true, tabindex: 0 },
		computedRole: "generic",
		tabIndex: 3,
		...overrides,
	};
}

function result(overrides: Partial<UnreachableControlsResult> = {}): UnreachableControlsResult {
	return {
		outcome: "findings",
		unreachable: [],
		missingRole: [],
		listenersInspected: true,
		truncated: false,
		summary: {
			checked: 4,
			passed: 0,
			failed: 0,
			reachedLimit: false,
			reachedFailedElementLimit: false,
			timedOut: false,
			sessionEnd: "completed",
		},
		...overrides,
	};
}

describe("unreachableControlsToAxe", () => {
	it("passes both results when nothing was found", () => {
		const output = unreachableControlsToAxe(result({ outcome: "clean" }));

		expect(output.passes.map((entry) => entry.id)).toEqual([
			KEYBOARD_REACHABILITY_AUDIT_ID,
			CONTROL_WITHOUT_ROLE_AUDIT_ID,
		]);
		expect(output.violations).toEqual([]);
		expect(output.incomplete).toEqual([]);
	});

	it("reports both halves as incomplete, never as findings, when the audit was inconclusive", () => {
		const output = unreachableControlsToAxe(
			result({
				outcome: "inconclusive",
				inconclusiveReason: "session-ended-early",
				unreachable: [unreachable()],
			}),
		);

		expect([output.violations, output.passes, output.inapplicable]).toEqual([[], [], []]);
		expect(output.incomplete.map((entry) => entry.id)).toEqual([
			KEYBOARD_REACHABILITY_AUDIT_ID,
			CONTROL_WITHOUT_ROLE_AUDIT_ID,
		]);
		expect(output.incomplete.every((entry) => entry.nodes.length === 0)).toBe(true);
		expect(output.incomplete[0]?.description).toContain("ended before the whole page");
	});

	it("sends a click target with no tab stop for review, since another control may do the same", () => {
		const output = unreachableControlsToAxe(result({ unreachable: [unreachable()] }));
		const entry = output.incomplete[0];

		expect(output.violations).toEqual([]);
		expect(entry?.id).toBe(KEYBOARD_REACHABILITY_AUDIT_ID);
		expect(entry?.tags).toContain("wcag211");
		expect(entry?.nodes.map((node) => node.target)).toEqual([["#card"]]);
		expect(entry?.nodes[0]?.failureSummary).toContain("handles click events");
		expect(entry?.nodes[0]?.any[0]).toMatchObject({
			id: UNREACHABLE_CONTROLS_EVIDENCE_CHECK_ID,
			data: {
				reason: "click-handler",
				listeners: ["click"],
				cursorPointer: true,
				text: "Ridgeline 2",
			},
		});
	});

	it("fails a widget role with no tab stop", () => {
		const output = unreachableControlsToAxe(
			result({
				unreachable: [
					unreachable({
						selector: "#swatch",
						reason: "widget-role",
						signals: { listeners: [], role: "button", cursorPointer: false, tabindex: null },
					}),
					unreachable(),
				],
			}),
		);

		expect(output.violations[0]?.nodes.map((node) => node.target)).toEqual([["#swatch"]]);
		expect(output.violations[0]?.nodes[0]?.failureSummary).toContain('role="button"');
		expect(output.incomplete[0]?.nodes.map((node) => node.target)).toEqual([["#card"]]);
	});

	it("words each review reason for what a reviewer has to check", () => {
		const reasons = [
			["hidden-control-label", "not rendered"],
			["container-handler", "delegated or incidental"],
			["script-focus-only", 'tabindex="-1"'],
			["press-handler", "drag handle"],
		] as const;

		for (const [reason, expected] of reasons) {
			const output = unreachableControlsToAxe(
				result({
					unreachable: [
						unreachable({
							reason,
							verdict: "review",
							signals: { listeners: ["mousedown"], role: null, cursorPointer: false, tabindex: -1 },
						}),
					],
				}),
			);

			expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain(expected);
		}
	});

	it("leaves out elements that only show a pointer cursor", () => {
		const output = unreachableControlsToAxe(
			result({ unreachable: [unreachable({ verdict: "review", reason: "pointer-cursor" })] }),
		);

		expect(output.incomplete).toEqual([]);
		expect(output.passes.map((entry) => entry.id)).toContain(KEYBOARD_REACHABILITY_AUDIT_ID);
	});

	it("leaves out elements whose only sign is a listener most of the page carries", () => {
		const output = unreachableControlsToAxe(
			result({
				unreachable: [
					unreachable({ selector: "#intro", verdict: "review", reason: "blanket-listener" }),
					unreachable({ selector: "#swatch", verdict: "failed", reason: "widget-role" }),
				],
			}),
		);

		expect(output.incomplete).toEqual([]);
		expect(output.violations[0]?.nodes.map((node) => node.target)).toEqual([["#swatch"]]);
	});

	it("sends a focusable container with listeners for review, saying what to check", () => {
		const output = unreachableControlsToAxe(
			result({
				missingRole: [
					missingRole({ selector: "#orders", verdict: "review", reason: "container-handler" }),
					missingRole({ selector: "#tracked", verdict: "review", reason: "blanket-listener" }),
				],
			}),
		);
		const nodes = output.incomplete[0]?.nodes ?? [];

		expect(output.violations).toEqual([]);
		expect(nodes.map((node) => node.target)).toEqual([["#orders"], ["#tracked"]]);
		expect(nodes[0]?.failureSummary).toContain("holds other controls");
		expect(nodes[1]?.failureSummary).toContain("click-tracking");
	});

	it("fails a focused control with no role, under its own id", () => {
		const output = unreachableControlsToAxe(result({ missingRole: [missingRole()] }));
		const entry = output.violations[0];

		expect(entry?.id).toBe(CONTROL_WITHOUT_ROLE_AUDIT_ID);
		expect(entry?.tags).toContain("wcag412");
		expect(entry?.nodes[0]?.failureSummary).toContain("tab stop #3");
		expect(entry?.nodes[0]?.failureSummary).toContain('exposes it as "generic"');
		expect(entry?.nodes[0]?.any[0]?.data).toMatchObject({ computedRole: "generic", tabIndex: 3 });
		expect(output.passes.map((pass) => pass.id)).toEqual([KEYBOARD_REACHABILITY_AUDIT_ID]);
	});

	it("sends an uncertain missing role for review", () => {
		const output = unreachableControlsToAxe(
			result({
				missingRole: [
					missingRole({ verdict: "review", reason: "custom-element", computedRole: null }),
					missingRole({ selector: "#hint", verdict: "review", reason: "pointer-cursor" }),
				],
			}),
		);

		expect(output.violations).toEqual([]);
		expect(output.incomplete[0]?.nodes.map((node) => node.target)).toEqual([["#save"], ["#hint"]]);
		expect(output.incomplete[0]?.nodes[0]?.failureSummary).toContain("could not be read");
	});

	it("marks the role check inapplicable on a page with no tab stops", () => {
		const output = unreachableControlsToAxe(
			result({ outcome: "clean", summary: { ...result().summary, checked: 0 } }),
		);

		expect(output.inapplicable.map((entry) => entry.id)).toEqual([CONTROL_WITHOUT_ROLE_AUDIT_ID]);
		expect(output.passes.map((entry) => entry.id)).toEqual([KEYBOARD_REACHABILITY_AUDIT_ID]);
	});
});
