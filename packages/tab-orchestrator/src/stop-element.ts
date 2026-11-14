/**
 * Page scripts that keep hold of the element a tab stop is about.
 *
 * A composed stop script runs entirely inside the page and cannot hand an element back to the host,
 * and the host may only come asking for it some time later, when a consumer captures the stop. By
 * then focus can have moved on (a focus handler that passes focus along from a timer), so "whatever
 * is focused now" is not a safe way to find it again.
 *
 * IMPORTANT: these are serialised and injected into the audited page, so they must not reference
 * any symbol outside their own scope.
 */

type StopElementWindow = Window & { __a11yPulseStopElement?: Element | null };

/** Remember `el` as the element the current stop is about. */
export function rememberStopElementScript(el: Element | null): void {
	(window as StopElementWindow).__a11yPulseStopElement = el;
}

/** The element the current stop is about, or null when none was remembered. */
export function stopElementHandleScript(): Element | null {
	return (window as StopElementWindow).__a11yPulseStopElement ?? null;
}

export function forgetStopElementScript(): void {
	delete (window as StopElementWindow).__a11yPulseStopElement;
}
