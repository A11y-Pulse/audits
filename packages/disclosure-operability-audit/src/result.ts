import type { DisclosureSkipReason } from "./browser-scripts";
import type { DisclosureAttempt, DisclosureKey, DisclosureSignal } from "./classify";

export type DisclosureTrigger = {
	/** Selector for the trigger (see getSelector). */
	selector: string;

	/** Truncated opening tag. */
	html: string;

	/** The explicit `role`, or null. */
	role: string | null;

	/**
	 * `aria-expanded` as the trigger was found. Null only for a trigger with `aria-controls` alone,
	 * which is operated when `includeControlsOnly` is set.
	 */
	expanded: string | null;

	/** Selector for the first element its `aria-controls` names, or null when none resolves. */
	controls: string | null;

	/** Every signal that applies, most serious first. Empty when the trigger passes. */
	signals: DisclosureSignal[];

	/** The keys pressed on it, in order. */
	keysTried: DisclosureKey[];

	/** What each key press changed, and what undid it. */
	attempts: DisclosureAttempt[];

	/**
	 * Whether a click or hover changed anything. Only tried when no key did, so null otherwise.
	 * `click` is false without a scripted click when a key already clicked the trigger to no effect.
	 */
	pointer: { click: boolean | null; hover: boolean | null };

	/** Whether taking keyboard focus alone opened it. */
	openedOnFocus: boolean;

	/** Whether it was left as it was found. */
	restored: boolean;
};

export type DisclosureSkipped = {
	selector: string;
	html: string;
	reason: DisclosureSkipReason;
};

export type DisclosureOperabilityResult = {
	/** Triggers that a pointer operates and the keyboard does not, or that hide their state. */
	failed: DisclosureTrigger[];

	/** Triggers a human should check. */
	needsReview: DisclosureTrigger[];

	passed: DisclosureTrigger[];

	/** Triggers found but deliberately not operated, up to ten. */
	skipped: DisclosureSkipped[];

	/**
	 * Set when the audit stopped early: operating a trigger replaced the document. The triggers
	 * after it were not checked and the page is no longer the one the audit started on.
	 */
	stopped: "navigated" | null;

	summary: {
		/** Triggers operated. Zero means inapplicable. */
		checked: number;
		failed: number;
		needsReview: number;
		passed: number;
		/** Every trigger found but not operated, including those past the ten listed. */
		skipped: number;
		/** Operable triggers left out by `triggerLimit`, or not reached before the audit stopped. */
		unchecked: number;
	};
};
