import type { InspectedField } from "./browser-scripts";

/**
 * What stands between the field and a password manager or a paste.
 *
 * - `paste-blocked`: the page cancels the `paste` event and the field stays empty.
 * - `partial-paste-refused`: the page cancels the `paste` event for a one-time code or numeric PIN.
 *   The audit pastes those a digit short, so the page may only be turning away the wrong length.
 * - `paste-may-be-blocked`: the page cancels only the paste key press or the `beforeinput` event.
 * - `split-code-paste-unhandled`: a code split into one-character boxes takes one character of a
 *   pasted code.
 * - `readonly-until-focus`: the field is `readonly` until focused, which hides it from autofill.
 * - `autocomplete-off`: `autocomplete="off"` on the field or its form.
 * - `new-password-on-sign-in`: `autocomplete="new-password"` on the password of a sign-in form.
 * - `no-autofill-hint`: a one-time-code field without `autocomplete="one-time-code"`.
 */
export type PasteBlockingSignal =
	| "paste-blocked"
	| "partial-paste-refused"
	| "paste-may-be-blocked"
	| "split-code-paste-unhandled"
	| "readonly-until-focus"
	| "autocomplete-off"
	| "new-password-on-sign-in"
	| "no-autofill-hint";

export type Verdict = "failed" | "review";

export type FieldClassification = {
	/** Every signal that applies, most serious first. Empty when the field passes. */
	signals: PasteBlockingSignal[];
	/** `failed` when the first signal is `paste-blocked`, `review` for any other, null for none. */
	verdict: Verdict | null;
};

/**
 * Decide what, if anything, stops a password manager or a paste from filling an inspected field.
 */
export function classifyField(field: InspectedField): FieldClassification {
	const signals: PasteBlockingSignal[] = [];
	const tokens = (field.autocomplete ?? "").split(/\s+/);

	if (field.blocked.includes("paste")) {
		signals.push(field.partialProbe ? "partial-paste-refused" : "paste-blocked");
	} else if (field.blocked.length > 0) {
		signals.push("paste-may-be-blocked");
	} else if (field.boxes > 0 && !field.handled && !field.readonlyUntilFocus) {
		signals.push("split-code-paste-unhandled");
	}

	if (field.readonlyUntilFocus) {
		signals.push("readonly-until-focus");
	}

	if (tokens.includes("off")) {
		signals.push("autocomplete-off");
	}

	if (field.kind === "password" && field.signIn && tokens.includes("new-password")) {
		signals.push("new-password-on-sign-in");
	}

	if (
		field.kind === "one-time-code" &&
		field.boxes === 0 &&
		!tokens.includes("one-time-code") &&
		!tokens.includes("off")
	) {
		signals.push("no-autofill-hint");
	}

	if (signals.length === 0) {
		return { signals, verdict: null };
	}

	return { signals, verdict: signals[0] === "paste-blocked" ? "failed" : "review" };
}
