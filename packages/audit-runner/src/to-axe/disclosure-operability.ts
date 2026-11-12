import type {
	DisclosureOperabilityResult,
	DisclosureSignal,
	DisclosureTrigger,
} from "@a11y-pulse/disclosure-operability-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	sortedResultToAxe,
} from "./audit-output";

export const DISCLOSURE_OPERABILITY_AUDIT_ID = "disclosure-operability";

export const DISCLOSURE_OPERABILITY_EVIDENCE_CHECK_ID = "disclosure-operability-evidence";

const METADATA: AuditMetadata = {
	id: DISCLOSURE_OPERABILITY_AUDIT_ID,
	help: "Controls that expand content must work from the keyboard and report their state",
	description:
		"Ensures that disclosure triggers (elements with aria-expanded) open and close with Enter and Space and update aria-expanded when they do, as required by WCAG 2.1.1 Keyboard and 4.1.2 Name, Role, Value.",
	helpUrl:
		"https://github.com/A11y-Pulse/audits/tree/main/packages/disclosure-operability-audit#readme",
	impact: "serious",
	tags: ["cat.keyboard", "wcag2a", "wcag211", "wcag412"],
};

function keys(trigger: DisclosureTrigger): string {
	return trigger.keysTried.length > 0 ? trigger.keysTried.join(" and ") : "the keyboard";
}

function pointer(trigger: DisclosureTrigger): string {
	return trigger.pointer.click ? "a click" : "hovering";
}

const MESSAGES: Record<DisclosureSignal, (trigger: DisclosureTrigger) => string> = {
	"not-focusable": (trigger) =>
		`This control opens with ${pointer(trigger)} but cannot receive keyboard focus. Use a <button>, or add tabindex="0" and key handlers.`,
	"keyboard-inoperable": (trigger) =>
		`This control opens with ${pointer(trigger)} but pressing ${keys(trigger)} does nothing. Use a <button>, or handle Enter and Space as well as the pointer.`,
	"state-not-exposed": (trigger) =>
		trigger.expanded === null
			? "Activating this control shows or hides content but it has no aria-expanded to say so. Add aria-expanded and update it whenever the content is shown or hidden."
			: `Activating this control shows or hides content but aria-expanded stays "${trigger.expanded}". Update aria-expanded whenever the content is shown or hidden.`,
	unresponsive: () =>
		"Nothing changed when this control was operated with the keyboard, clicked or hovered. Check that it opens its content and can be operated with Enter and Space.",
	"state-without-content": () =>
		"aria-expanded changes when this control is activated but no content was seen to appear or disappear. Check that the content it expands is shown, and is the element aria-controls names.",
	"space-inoperable": () =>
		"This button opens with Enter but not with Space. A button must respond to both keys.",
	"enter-inoperable": () =>
		"This control opens with Space but not with Enter. Check that Enter activates it too.",
	"pointer-only-close": () =>
		"Once opened with the keyboard, only a click closed this control again. Check that the same key or Escape closes it.",
	"not-restored": () =>
		"Once opened, this control could not be closed again and was left open. What it opened may have taken keyboard focus, in which case only Escape was tried. Check that a keyboard user can dismiss it.",
	"submit-blocked": () =>
		"Activating this control tried to submit a form, which was stopped. A control with aria-expanded should expand content in place.",
	"navigation-blocked": () =>
		"Activating this control tried to load another page, which was stopped. A control with aria-expanded should expand content in place.",
	"opens-on-focus": () =>
		"Content appears when this control receives focus without aria-expanded changing. Check that the content is announced, and consider opening it on activation instead.",
	"trigger-removed": () =>
		"This control left the page when it was activated, so it could not be checked further. Check that focus is moved somewhere sensible when it goes.",
	"not-in-tab-order": () =>
		"This control works from the keyboard but has a negative tabindex and is not inside a menu, toolbar or similar widget. Check that keyboard users can reach it.",
	navigated: () =>
		"Activating this control loaded another page, so it and the controls after it were not checked. A control with aria-expanded should expand content in place.",
};

function toAuditNode(trigger: DisclosureTrigger): AuditNode {
	const node: AuditNode = {
		selector: trigger.selector,
		html: trigger.html,
		evidence: {
			id: DISCLOSURE_OPERABILITY_EVIDENCE_CHECK_ID,
			impact: "serious",
			message: "What each key press changed",
			data: {
				signals: trigger.signals,
				expanded: trigger.expanded,
				controls: trigger.controls,
				keysTried: trigger.keysTried,
				attempts: trigger.attempts,
				pointer: trigger.pointer,
				openedOnFocus: trigger.openedOnFocus,
				restored: trigger.restored,
			},
		},
	};

	if (trigger.signals.length > 0) {
		node.failureSummary = trigger.signals.map((signal) => MESSAGES[signal](trigger)).join(" ");
	}

	return node;
}

export function disclosureOperabilityToAxe(result: DisclosureOperabilityResult): AuditOutput {
	return sortedResultToAxe(METADATA, result, toAuditNode);
}
