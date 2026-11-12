import type { KeyName } from "@a11y-pulse/browser-adaptor";
import type { BaseAuditSummary } from "@a11y-pulse/tab-orchestrator";

/** The standard keyboard exit that freed focus from a cycle. */
export type EscapeRoute = "escape-key" | "shift-tab" | "arrow-key" | "tab";

/** The keys the escape protocol presses. Never an activation key such as Enter or Space. */
export type EscapeKey = Extract<
	KeyName,
	"Tab" | "Shift+Tab" | "Escape" | "ArrowDown" | "ArrowRight"
>;

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

/**
 * Why an `inconclusive` result could not be decided.
 *
 * - `stuck-in-frame`: focus went into an iframe and never came back out; `container` names it.
 * - `page-edge-only`: the only way out found was past the edge of the page to the browser's own
 *   interface, and the page pulled focus back when it re-entered from the other end.
 * - `ring-sampled`: no key left the cycle, but it was too large to walk in full (`sampledRing`), so a
 *   way out from a member in the middle of it was never tried.
 * - `session-ended`: the tab traversal ended early (lost focus, navigation, a limit).
 * - `element-limit`: the audit stopped itself at `elementLimit`.
 * - `timed-out`: `timeout` ran out during the traversal or the escape attempts.
 * - `ring-unresolved`: the cycle's elements could not be found again.
 * - `scattered-ring`: the cycle's elements share no ancestor below `<body>`.
 * - `ring-changed`: the cycle stopped holding focus between attempts.
 * - `navigated`: a key press loaded another document.
 */
export type InconclusiveReason =
	| "stuck-in-frame"
	| "page-edge-only"
	| "ring-sampled"
	| "session-ended"
	| "element-limit"
	| "timed-out"
	| "ring-unresolved"
	| "scattered-ring"
	| "ring-changed"
	| "navigated";

export type KeyboardTrapElement = {
	/** Selector for the element (see getSelector). */
	selector: string;

	/** Truncated opening tag; the internal marker attribute is already stripped. */
	html: string;
};

/** One key of the escape protocol, pressed one or more times in a row from inside the ring. */
export type EscapeAttempt = {
	/** The round of the protocol this belongs to, from 1. */
	round: number;

	key: EscapeKey;

	/** How many times the key was pressed in a row. */
	presses: number;

	/** Opening tag of the ring member that held focus before the first press. */
	from: string | null;

	/** Opening tag of the element holding focus after the last press, or `null` when nothing did. */
	landed: string | null;

	/** The key moved focus out of the ring, or dismissed its container. */
	exited: boolean;

	/** For Tab and Shift+Tab: the page cancelled the last press with `preventDefault()`. */
	cancelled?: boolean;

	/**
	 * For Tab and Shift+Tab: focus stayed at the edge of the page without the page cancelling the
	 * key, which in a real browser moves it to the browser's own interface.
	 */
	pageEdge?: boolean;
};

/** The dialog a ring sits in, so a consent or sign-up dialog can be told from another widget. */
export type TrapDialog = {
	role: "dialog" | "alertdialog";

	/** A `<dialog>` element rather than an ARIA role. */
	native: boolean;

	/** Shown with `showModal()`, or marked `aria-modal="true"`. */
	modal: boolean;

	/** Enabled, visible buttons and links inside it. They are never activated. */
	buttons: number;
};

export type KeyboardTrapResult = {
	outcome: KeyboardTrapOutcome;

	/** Set when `outcome` is `inconclusive`. */
	inconclusiveReason: InconclusiveReason | null;

	/** The elements focus cycled through, in tab order, up to 10. Empty unless a cycle formed. */
	ring: KeyboardTrapElement[];

	/** How many elements focus cycled through, including any beyond those listed in `ring`. */
	ringSize: number;

	/**
	 * The ring's nearest common ancestor, when a cycle shut out part of the page. For
	 * `stuck-in-frame`, the iframe focus never left.
	 */
	container: KeyboardTrapElement | null;

	/** The dialog the ring sits in, if any. */
	dialog: TrapDialog | null;

	/** Tabbable elements the cycle never reached, including any a modal dialog or `inert` shuts out. */
	excludedCount: number;

	escapedVia: EscapeRoute | null;

	/** Escape protocol rounds run before the verdict. */
	roundsAttempted: number;

	/** Every key the escape protocol pressed, in the order it first pressed them. */
	keysTried: EscapeKey[];

	/** What each key did, in the order pressed. */
	attempts: EscapeAttempt[];

	/**
	 * The ring was too large to walk in full, so Tab and Shift+Tab were pressed only from the members
	 * either side of where it wraps round. Such a ring is never reported as `trapped`: when no key
	 * leaves it the outcome is `inconclusive` with `ring-sampled`.
	 */
	sampledRing: boolean;

	summary: BaseAuditSummary;
};
