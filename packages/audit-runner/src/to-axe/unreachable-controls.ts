import type {
	ControlSignals,
	MissingRoleControl,
	UnreachableControl,
	UnreachableControlsResult,
} from "@a11y-pulse/unreachable-controls-audit";
import type { Result } from "axe-core";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	inconclusiveOutput,
	mergeOutputs,
	toResult,
} from "./audit-output";

export const KEYBOARD_REACHABILITY_AUDIT_ID = "keyboard-reachability";

export const CONTROL_WITHOUT_ROLE_AUDIT_ID = "control-without-role";

export const UNREACHABLE_CONTROLS_EVIDENCE_CHECK_ID = "unreachable-controls-evidence";

const HELP_URL =
	"https://github.com/A11y-Pulse/audits/tree/main/packages/unreachable-controls-audit#readme";

const REACHABILITY: AuditMetadata = {
	id: KEYBOARD_REACHABILITY_AUDIT_ID,
	help: "Controls must be reachable with the keyboard",
	description:
		"Ensures that elements which act as controls (they handle clicks, or have a widget role) can be reached with the Tab key, as required by WCAG 2.1.1 Keyboard.",
	helpUrl: HELP_URL,
	impact: "serious",
	tags: ["wcag2a", "wcag211", "cat.keyboard"],
};

const ROLE: AuditMetadata = {
	id: CONTROL_WITHOUT_ROLE_AUDIT_ID,
	help: "Focusable controls must expose a role",
	description:
		"Ensures that elements which take keyboard focus and handle clicks or key presses expose a role, so assistive technology can say what they are, as required by WCAG 4.1.2 Name, Role, Value.",
	helpUrl: HELP_URL,
	impact: "serious",
	tags: ["wcag2a", "wcag412", "cat.aria"],
};

const FIX =
	'Use a native element such as <button> or <a href>, or give it tabindex="0", a role and key handlers.';

function handled(signals: ControlSignals): string {
	return signals.listeners.length > 0 ? signals.listeners.join(", ") : "no";
}

function reachabilitySummary({ reason, signals }: UnreachableControl): string {
	switch (reason) {
		case "widget-role":
			return `This element has role="${signals.role}" but is not in the tab order, and nothing inside or around it is, so keyboard users cannot reach it. ${FIX}`;
		case "click-handler":
			return `This element handles ${handled(signals)} events but is not in the tab order, and nothing inside or around it is. If it does something no focusable control on the page also does, keyboard users cannot do it. ${FIX}`;
		case "hidden-control-label":
			return "This label's form control is not rendered (it, or something around it, is display: none or visibility: hidden) and nothing focusable stands in for it, so the control can be changed by clicking the label but cannot be reached with the keyboard. Hide the control visually without removing it from the tab order.";
		case "container-handler":
			return `This element handles ${handled(signals)} events and holds nothing focusable, but it holds a lot of content and shows no pointer cursor, so the listener may be delegated or incidental. Check whether clicking inside it does something keyboard users cannot do.`;
		case "script-focus-only":
			return `This element acts as a control but has tabindex="${signals.tabindex}" and is not part of a widget that moves focus with arrow keys, so only a script can focus it. Check that keyboard users can reach it.`;
		case "press-handler":
			return `This element handles ${handled(signals)} events but not click, and is not in the tab order. Check whether it is a control, a drag handle or a swipe area, and that what it does is possible with the keyboard.`;
		case "pointer-cursor":
			return "This element shows a pointer cursor but is not in the tab order. Check whether it is a control.";
		case "blanket-listener":
			return `This element handles ${handled(signals)} events but is not in the tab order. Most elements on this page handle them too, which is what a click-tracking script does, so check whether clicking it does anything.`;
	}
}

function roleSummary({ reason, signals, computedRole, tabIndex }: MissingRoleControl): string {
	const exposed = computedRole === null ? "" : ` The browser exposes it as "${computedRole}".`;

	switch (reason) {
		case "handler-without-role":
			return `This element takes keyboard focus (tab stop #${tabIndex}) and handles ${handled(signals)} events, but has no role, so assistive technology cannot say what it is.${exposed} Use a native element such as <button>, or add the role that matches what it does.`;
		case "custom-element":
			return `This custom element takes keyboard focus (tab stop #${tabIndex}) and handles ${handled(signals)} events, but has no role attribute. It may set a role internally, which could not be read. Check that assistive technology announces what it is.`;
		case "pointer-cursor":
			return `This element takes keyboard focus (tab stop #${tabIndex}) and shows a pointer cursor, but has no role.${exposed} Check whether it is a control, and if so give it the role that matches what it does.`;
		case "container-handler":
			return `This element takes keyboard focus (tab stop #${tabIndex}) and handles ${handled(signals)} events, but has no role.${exposed} It holds other controls, so its listeners may only serve them (a scrolling region made focusable). Check whether it does anything itself, and if so give it the role that matches.`;
		case "blanket-listener":
			return `This element takes keyboard focus (tab stop #${tabIndex}) and handles ${handled(signals)} events, but has no role.${exposed} Most elements on this page handle them too, which is what a click-tracking script does, so check whether it is a control.`;
	}
}

function toNode(
	item: UnreachableControl | MissingRoleControl,
	failureSummary: string,
	data: Record<string, unknown>,
): AuditNode {
	return {
		selector: item.selector,
		html: item.html,
		failureSummary,
		evidence: {
			id: UNREACHABLE_CONTROLS_EVIDENCE_CHECK_ID,
			impact: "serious",
			message: `Taken to be a control because: ${item.reason}`,
			data: {
				reason: item.reason,
				verdict: item.verdict,
				text: item.text,
				...item.signals,
				...data,
			},
		},
	};
}

function bucket(metadata: AuditMetadata, nodes: AuditNode[]): Result[] {
	return nodes.length > 0 ? [toResult(metadata, nodes)] : [];
}

function reachabilityToAxe(result: UnreachableControlsResult): AuditOutput {
	// A pointer cursor alone, or a listener nearly every element carries, is too weak a sign to put
	// in front of a reviewer of a whole page.
	const reported = result.unreachable.filter(
		(control) => control.reason !== "pointer-cursor" && control.reason !== "blanket-listener",
	);

	if (reported.length === 0) {
		return { ...emptyOutput(), passes: [toResult(REACHABILITY, [])] };
	}

	const node = (control: UnreachableControl): AuditNode =>
		toNode(control, reachabilitySummary(control), {});

	// Only a declared widget is certain to be a control. A click listener may duplicate something a
	// focusable control already offers, which the audit cannot see.
	const certain = (control: UnreachableControl): boolean => control.reason === "widget-role";

	return {
		...emptyOutput(),
		violations: bucket(REACHABILITY, reported.filter(certain).map(node)),
		incomplete: bucket(REACHABILITY, reported.filter((control) => !certain(control)).map(node)),
	};
}

function roleToAxe(result: UnreachableControlsResult): AuditOutput {
	if (result.summary.checked === 0) {
		return { ...emptyOutput(), inapplicable: [toResult(ROLE, [])] };
	}

	if (result.missingRole.length === 0) {
		return { ...emptyOutput(), passes: [toResult(ROLE, [])] };
	}

	const node = (control: MissingRoleControl): AuditNode =>
		toNode(control, roleSummary(control), {
			computedRole: control.computedRole,
			tabIndex: control.tabIndex,
		});

	return {
		...emptyOutput(),
		violations: bucket(
			ROLE,
			result.missingRole.filter((control) => control.verdict === "failed").map(node),
		),
		incomplete: bucket(
			ROLE,
			result.missingRole.filter((control) => control.verdict === "review").map(node),
		),
	};
}

/**
 * Convert the audit into axe-core's buckets, as two results: `keyboard-reachability` for controls
 * Tab never reaches and `control-without-role` for focused controls with no role. An inconclusive
 * audit reports both as `incomplete` with the reason.
 */
export function unreachableControlsToAxe(result: UnreachableControlsResult): AuditOutput {
	if (result.outcome === "inconclusive") {
		// Controls the pass never got to would all be listed as unreachable, so neither half says
		// anything about the page.
		const reason =
			"the keyboard pass ended before the whole page had been tabbed through, so the elements it did not reach cannot be told from ones the keyboard cannot reach.";

		return mergeOutputs([
			inconclusiveOutput(REACHABILITY, reason),
			inconclusiveOutput(ROLE, reason),
		]);
	}

	return mergeOutputs([reachabilityToAxe(result), roleToAxe(result)]);
}
