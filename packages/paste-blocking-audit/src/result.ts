import type { AuthFieldKind, BlockMechanism, SuppressedAction } from "./browser-scripts";
import type { PasteBlockingSignal } from "./classify";

/** How a refused paste was traced: to an `onpaste` attribute, or to a listener added by script. */
export type PasteBlockDetection = "inline-handler" | "event-listener";

export type PasteBlockingField = {
	/** Selector for the field (see getSelector). For a split code, its first box. */
	selector: string;

	/** Truncated opening tag. */
	html: string;

	kind: AuthFieldKind;

	/** Every signal that applies, most serious first. Empty when the field passes. */
	signals: PasteBlockingSignal[];

	/**
	 * Every way the page refused a synthetic paste while leaving the field unchanged: the `paste`
	 * event, the `beforeinput` event for a paste, or the Ctrl+V or Cmd+V key press.
	 */
	blocked: BlockMechanism[];

	/** Where the refusal came from, or null when nothing was refused. */
	detectedBy: PasteBlockDetection | null;

	/** The `autocomplete` of the field, or of its form when it has none. Null if unset. */
	autocomplete: string | null;

	/** How many one-character boxes a split code has, or null for an ordinary field. */
	boxes: number | null;

	/**
	 * The text pasted was a digit short of what the field takes. One-time codes and numeric PINs are
	 * pasted this way so the page never holds a complete code that it could send for verification.
	 */
	partialProbe: boolean;

	/**
	 * What the page tried to do in response to the paste and was stopped from doing: submit a form
	 * (`submit`), or send a `fetch`, `XMLHttpRequest` or `sendBeacon` request (`request`).
	 */
	suppressed: SuppressedAction[];
};

export type PasteBlockingResult = {
	/** Fields whose `paste` event the page cancels, so nothing can be pasted into them. */
	failed: PasteBlockingField[];

	/** Fields that may keep a password manager or a paste out, for a human to check. */
	needsReview: PasteBlockingField[];

	passed: PasteBlockingField[];

	/** Full counts. Each field list stops at `reportLimit`. */
	summary: {
		/** Rendered authentication fields inspected, up to `fieldLimit`. Zero means inapplicable. */
		checked: number;
		failed: number;
		needsReview: number;
		passed: number;
		/** Authentication fields past `fieldLimit`, which were not inspected. */
		unchecked: number;
	};
};
