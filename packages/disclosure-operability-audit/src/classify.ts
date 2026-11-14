export type DisclosureKey = "Enter" | "Space";

/** What put a changed trigger back as it was found. */
export type DisclosureRestore = DisclosureKey | "Escape" | "click" | "blur";

export type DisclosureAttempt = {
	key: DisclosureKey;
	/** `aria-expanded` before and after the key press. */
	expandedBefore: string | null;
	expandedAfter: string | null;
	/** Whether content was shown or hidden: an `aria-controls` target, or anything else on the page. */
	contentChanged: boolean;
	/** What undid the change, or null when nothing changed or nothing undid it. */
	restoredBy: DisclosureRestore | null;
};

export type DisclosureSignal =
	/** Fails: it works with a pointer but cannot take keyboard focus (WCAG 2.1.1). */
	| "not-focusable"
	/** Fails: it works with a pointer but neither Enter nor Space does anything (WCAG 2.1.1). */
	| "keyboard-inoperable"
	/** Fails: a key shows or hides content but `aria-expanded` is missing or never changes (WCAG 4.1.2). */
	| "state-not-exposed"
	/** Review: nothing the audit tried, keyboard or pointer, changed anything. */
	| "unresponsive"
	/** Review: `aria-expanded` changes but no content was seen to appear or disappear. */
	| "state-without-content"
	/** Review: Enter works but Space does not, on a button. */
	| "space-inoperable"
	/** Review: Space works but Enter does not. */
	| "enter-inoperable"
	/** Review: it opens with a key but only a click closes it again. */
	| "pointer-only-close"
	/**
	 * Review: once opened, nothing the audit could safely try closed it. The page was left changed.
	 * What opened may have kept focus to itself, in which case only Escape was pressed.
	 */
	| "not-restored"
	/** Review: operating it tried to submit a form, which the audit stopped. */
	| "submit-blocked"
	/** Review: operating it tried to load another page, which the audit stopped. */
	| "navigation-blocked"
	/** Review: content appears when the trigger takes focus, without `aria-expanded` changing. */
	| "opens-on-focus"
	/** Review: the trigger left the document when operated. */
	| "trigger-removed"
	/** Review: it has a negative `tabindex` and is not part of a widget that manages focus. */
	| "not-in-tab-order"
	/** Review: operating it replaced the document, and the audit stopped. */
	| "navigated";

export type Verdict = "failed" | "review" | null;

export type DisclosureObservation = {
	/** Whether the trigger took focus. */
	focusable: boolean;
	inTabOrder: boolean;
	inComposite: boolean;
	spaceExpected: boolean;
	/** Set when taking focus alone changed the trigger or the page. */
	openedOnFocus: { expandedChanged: boolean } | null;
	attempts: readonly DisclosureAttempt[];
	/** Whether a click or a hover changed anything. Null when not tried. */
	pointer: { click: boolean | null; hover: boolean | null };
	/** Whether operating it tried to submit a form or leave the page, and was stopped. */
	blocked: { submit: boolean; navigation: boolean };
	removed: boolean;
	navigated: boolean;
	/** False when the trigger could not be put back as it was found. */
	restored: boolean;
};

export type DisclosureClassification = { verdict: Verdict; signals: DisclosureSignal[] };

const FAILING: ReadonlySet<DisclosureSignal> = new Set([
	"not-focusable",
	"keyboard-inoperable",
	"state-not-exposed",
]);

function expandedChanged(attempt: DisclosureAttempt): boolean {
	return attempt.expandedBefore !== attempt.expandedAfter;
}

function changed(attempt: DisclosureAttempt): boolean {
	return expandedChanged(attempt) || attempt.contentChanged;
}

/** Decide what the keys pressed on one trigger, and what they changed, say about it. */
export function classifyTrigger(observation: DisclosureObservation): DisclosureClassification {
	const signals: DisclosureSignal[] = [];
	const respondsToPointer =
		observation.pointer.click === true || observation.pointer.hover === true;
	const working = observation.attempts.filter(changed);
	// A control that tried to send a form or leave the page did respond, just not as a disclosure.
	const blocked = observation.blocked.submit || observation.blocked.navigation;

	if (observation.navigated) {
		signals.push("navigated");
	} else if (observation.removed) {
		signals.push("trigger-removed");
	} else if (!observation.focusable) {
		if (respondsToPointer) {
			signals.push("not-focusable");
		} else if (!blocked) {
			signals.push("unresponsive");
		}
	} else if (observation.openedOnFocus) {
		if (!observation.openedOnFocus.expandedChanged) {
			signals.push("opens-on-focus");
		}
	} else if (working.length === 0) {
		if (respondsToPointer) {
			signals.push("keyboard-inoperable");
		} else if (!blocked) {
			signals.push("unresponsive");
		}
	} else {
		if (working.some((attempt) => attempt.contentChanged && !expandedChanged(attempt))) {
			signals.push("state-not-exposed");
		}

		if (working.every((attempt) => !attempt.contentChanged)) {
			signals.push("state-without-content");
		}

		const works = (key: DisclosureAttempt["key"]) => working.some((attempt) => attempt.key === key);
		const tried = (key: DisclosureAttempt["key"]) =>
			observation.attempts.some((attempt) => attempt.key === key);

		if (works("Enter") && tried("Space") && !works("Space") && observation.spaceExpected) {
			signals.push("space-inoperable");
		}

		if (works("Space") && tried("Enter") && !works("Enter")) {
			signals.push("enter-inoperable");
		}

		if (working.some((attempt) => attempt.restoredBy === "click")) {
			signals.push("pointer-only-close");
		}
	}

	if (!observation.restored && !observation.navigated && !observation.removed) {
		signals.push("not-restored");
	}

	if (observation.blocked.submit && !observation.navigated) {
		signals.push("submit-blocked");
	}

	if (observation.blocked.navigation && !observation.navigated) {
		signals.push("navigation-blocked");
	}

	if (
		observation.focusable &&
		!observation.inTabOrder &&
		!observation.inComposite &&
		!observation.navigated
	) {
		signals.push("not-in-tab-order");
	}

	const verdict: Verdict = signals.some((signal) => FAILING.has(signal))
		? "failed"
		: signals.length > 0
			? "review"
			: null;

	// Most serious first.
	signals.sort((a, b) => Number(FAILING.has(b)) - Number(FAILING.has(a)));

	return { verdict, signals };
}
