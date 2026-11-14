import type {
	PasteBlockingField,
	PasteBlockingResult,
	PasteBlockingSignal,
} from "@a11y-pulse/paste-blocking-audit";
import type { Result } from "axe-core";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	toResult,
} from "./audit-output";

export const ACCESSIBLE_AUTHENTICATION_AUDIT_ID = "accessible-authentication";

const METADATA: AuditMetadata = {
	id: ACCESSIBLE_AUTHENTICATION_AUDIT_ID,
	help: "Sign-in fields must let a password manager or a paste fill them",
	description:
		"Ensures that password, username and one-time-code fields do not block pasting or autofill, so that signing in does not depend on remembering or transcribing a secret (WCAG 3.3.8 Accessible Authentication (Minimum)).",
	helpUrl: "https://github.com/A11y-Pulse/audits/tree/main/packages/paste-blocking-audit#readme",
	impact: "serious",
	tags: ["cat.forms", "wcag22aa", "wcag338"],
};

export const PASTE_BLOCKING_EVIDENCE_CHECK_ID = "paste-blocking-evidence";

const FIELD_NAMES: Record<PasteBlockingField["kind"], string> = {
	password: "password field",
	"new-password": "new password field",
	username: "username field",
	"one-time-code": "one-time-code field",
};

const MECHANISMS: Record<PasteBlockingField["blocked"][number], string> = {
	paste: "the paste event",
	beforeinput: "the beforeinput event for a paste",
	shortcut: "the Ctrl+V or Cmd+V key press",
};

const ALTERNATIVE =
	"This fails WCAG 3.3.8 unless the page offers another way to sign in that needs nothing remembered or transcribed, such as a passkey or an emailed link.";

function refusal(field: PasteBlockingField): string {
	const cancelled = field.blocked.map((mechanism) => MECHANISMS[mechanism]).join(" and ");
	const source =
		field.detectedBy === "inline-handler" ? "an onpaste attribute" : "a script's event listener";

	return `${source} cancels ${cancelled}`;
}

function describeSignal(field: PasteBlockingField, signal: PasteBlockingSignal): string {
	const name = FIELD_NAMES[field.kind];

	switch (signal) {
		case "paste-blocked":
			return `Nothing can be pasted into this ${name}: ${refusal(field)} and the field stays unchanged, so a password manager or a copied value cannot fill it. Remove the handler. ${ALTERNATIVE}`;
		case "partial-paste-refused":
			return `Pasting into this ${name} may not work: ${refusal(field)} and the field stays unchanged. The audit pastes a code one digit short, so that the page cannot send it for verification, and the page may only be turning away a code of the wrong length. Check that a full code can be pasted into the field.`;
		case "paste-may-be-blocked":
			return `Pasting into this ${name} may not work: ${refusal(field)}, though the paste event itself is not cancelled. Check that Ctrl+V or Cmd+V and the context menu both paste into the field.`;
		case "split-code-paste-unhandled":
			return `This code is split into ${field.boxes} one-character boxes and nothing spreads a pasted code across them, so a pasted or autofilled code is cut to its first character. Check that a full code can be pasted; if not, handle the paste, or use a single field with autocomplete="one-time-code".`;
		case "readonly-until-focus":
			return `This ${name} is read-only until it is focused, a trick that keeps browsers and password managers from filling it. Check that a password manager can fill it, and remove the readonly attribute if not.`;
		case "autocomplete-off":
			return `This ${name} has autocomplete="off", on itself or its form. Browsers ignore it for sign-in fields, but some password managers honour it. Check that a password manager offers to fill the field, and use a value such as "username", "current-password" or "one-time-code" instead.`;
		case "new-password-on-sign-in":
			return 'This sign-in password field has autocomplete="new-password", which tells password managers to suggest a new password instead of filling the saved one. Use autocomplete="current-password".';
		case "no-autofill-hint":
			return 'This one-time-code field has no autocomplete="one-time-code", so browsers do not offer the code from a text message and it has to be transcribed. Add the attribute.';
	}
}

function failureSummary(field: PasteBlockingField): string {
	return field.signals.map((signal) => describeSignal(field, signal)).join(" ");
}

function toAuditNode(field: PasteBlockingField): AuditNode {
	const node: AuditNode = { selector: field.selector, html: field.html };

	if (field.signals.length === 0) {
		return node;
	}

	node.failureSummary = failureSummary(field);
	node.evidence = {
		id: PASTE_BLOCKING_EVIDENCE_CHECK_ID,
		impact: "serious",
		message: `The ${FIELD_NAMES[field.kind]} was flagged for: ${field.signals.join(", ")}`,
		data: {
			kind: field.kind,
			signals: field.signals,
			blocked: field.blocked,
			detectedBy: field.detectedBy,
			autocomplete: field.autocomplete,
			boxes: field.boxes,
			partialProbe: field.partialProbe,
			suppressed: field.suppressed,
		},
	};

	return node;
}

function toBucket(fields: readonly PasteBlockingField[]): Result[] {
	return fields.length > 0 ? [toResult(METADATA, fields.map(toAuditNode))] : [];
}

/**
 * Convert the audit into axe-core's buckets. A field that blocks pasting is reported in
 * `incomplete` rather than `violations`: WCAG 3.3.8 is only failed when the page offers no other
 * way to sign in, which is beyond what the audit can see. Blocked fields are listed first.
 */
export function pasteBlockingToAxe(result: PasteBlockingResult): AuditOutput {
	if (result.summary.checked === 0) {
		return { ...emptyOutput(), inapplicable: [toResult(METADATA, [])] };
	}

	return {
		...emptyOutput(),
		incomplete: toBucket([...result.failed, ...result.needsReview]),
		passes: toBucket(result.passed),
	};
}
