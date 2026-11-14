import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";

export type { BrowserAdaptor, ElementRef } from "@a11y-pulse/browser-adaptor";

/** What the browser itself knows about one element, which no page script can read. */
export type ElementInspection = {
	/** Event types with a listener registered directly on the element, such as `click`. */
	listeners: string[];

	/** The role the browser exposes in its accessibility tree, or null when it could not be read. */
	role: string | null;
};

/**
 * The adaptor the audit runs against. `inspectElements` is optional: without it the audit only
 * knows about handlers a page script can see (an `onclick` attribute or property), widget roles and
 * the pointer cursor, so a control wired up with `addEventListener` alone is reported for review
 * at most.
 */
export interface UnreachableControlsAdaptor extends BrowserAdaptor {
	/**
	 * Inspect each element of the array a page script left on `window[stashKey]`, in order, and
	 * resolve to one entry per element. Resolve to null when the browser cannot be asked (anything
	 * other than Chromium), which the audit treats the same as the method being absent. `roles` lists
	 * the indices whose accessibility role is wanted; `role` is null for every other element.
	 */
	inspectElements?(
		stashKey: string,
		count: number,
		roles: readonly number[],
	): Promise<ElementInspection[] | null>;
}
