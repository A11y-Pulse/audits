import type { BaseAuditSummary } from "@a11y-pulse/tab-orchestrator";

/** The standard keyboard exit that freed focus from a cycle. */
export type EscapeRoute = "escape-key" | "shift-tab" | "arrow-key" | "tab";

/**
 * - `no-cycle`: tabbing ran off the end of the page.
 * - `small-ring`: focus cycled, but through every tabbable element on the page.
 * - `escaped`: focus cycled within part of the page, and a standard exit freed it.
 * - `trapped`: focus cycled within part of the page, and no standard exit freed it.
 * - `inconclusive`: the traversal or the escape attempts could not be trusted.
 * - `no-focusable`: nothing on the page took focus.
 */
export type KeyboardTrapOutcome =
	| "no-cycle"
	| "small-ring"
	| "escaped"
	| "trapped"
	| "inconclusive"
	| "no-focusable";

export type KeyboardTrapElement = {
	/** Selector for the element (see getSelector). */
	selector: string;

	/** Truncated opening tag; the internal marker attribute is already stripped. */
	html: string;
};

export type KeyboardTrapResult = {
	outcome: KeyboardTrapOutcome;

	/** The elements focus cycled through, in tab order, up to 10. Empty unless a cycle formed. */
	ring: KeyboardTrapElement[];

	/** How many elements focus cycled through, including any beyond those listed in `ring`. */
	ringSize: number;

	/** The ring's nearest common ancestor, when a cycle shut out part of the page. */
	container: KeyboardTrapElement | null;

	/** Tabbable elements the cycle never reached, including any a modal dialog or `inert` shuts out. */
	excludedCount: number;

	escapedVia: EscapeRoute | null;

	/** Escape protocol rounds run before the verdict. */
	roundsAttempted: number;

	summary: BaseAuditSummary;
};
