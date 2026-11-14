import type { BaseAuditSummary } from "@a11y-pulse/tab-orchestrator";

/** Why an element was taken to be a control. */
export type ControlSignals = {
	/**
	 * Pointer and keyboard event types handled on the element itself: from an `on…` attribute or
	 * property, and from `addEventListener` when the browser could be asked.
	 */
	listeners: string[];

	/** The `role` attribute, or null without one. */
	role: string | null;

	/** The computed cursor is `pointer`. */
	cursorPointer: boolean;

	/** The `tabindex` attribute, or null without one. */
	tabindex: number | null;
};

/**
 * - `widget-role`: has a widget role (`button`, `tab`, `option`...) but no tab stop.
 * - `click-handler`: handles `click`, and nothing in or around it can take focus.
 * - `hidden-control-label`: a `<label>` whose form control is not rendered, so the control can only
 *   be operated by clicking the label.
 * - `container-handler`: handles `click` but holds a lot of content and shows no pointer cursor, so
 *   the listener may be delegated or incidental. Review.
 * - `script-focus-only`: a control with `tabindex="-1"` outside any widget that manages focus, so
 *   only a script can focus it. Review.
 * - `press-handler`: handles pointer or touch presses but not `click`. Review.
 * - `pointer-cursor`: only the pointer cursor suggests a control. Review.
 * - `blanket-listener`: handles `click`, but so do most elements on the page (a script that
 *   instruments every element), so the listener says little. Only a few are listed. Review.
 */
export type UnreachableReason =
	| "widget-role"
	| "click-handler"
	| "hidden-control-label"
	| "container-handler"
	| "script-focus-only"
	| "press-handler"
	| "pointer-cursor"
	| "blanket-listener";

/** A control that Tab never reaches (WCAG 2.1.1). */
export type UnreachableControl = {
	/** Selector for the element (see getSelector). */
	selector: string;

	/** Truncated opening tag. */
	html: string;

	/** Start of the element's text. */
	text: string;

	/** `failed` when the evidence is direct, `review` when a person has to decide. */
	verdict: "failed" | "review";
	reason: UnreachableReason;
	signals: ControlSignals;
};

/**
 * - `handler-without-role`: handles clicks or key presses and exposes no role.
 * - `custom-element`: a custom element that handles clicks or key presses and has no `role`
 *   attribute; it may set a role internally, which could not be read. Review.
 * - `pointer-cursor`: only the pointer cursor suggests a control. Review.
 * - `container-handler`: handles clicks or key presses but holds other tab stops, or carries a
 *   framework's whole delegated event set, so its listeners most likely serve what is inside (a
 *   focusable scrolling region). Review.
 * - `blanket-listener`: handles `click`, but so do most elements on the page. Review.
 */
export type MissingRoleReason =
	| "handler-without-role"
	| "custom-element"
	| "pointer-cursor"
	| "container-handler"
	| "blanket-listener";

/** An element that takes focus and acts as a control but exposes no role (WCAG 4.1.2). */
export type MissingRoleControl = {
	selector: string;
	html: string;
	text: string;
	verdict: "failed" | "review";
	reason: MissingRoleReason;
	signals: ControlSignals;

	/**
	 * The role the browser exposes for the element (`generic` for a plain `div`), or null when the
	 * browser could not be asked.
	 */
	computedRole: string | null;

	/** 1-based tab stop at which the element took focus. */
	tabIndex: number;
};

export type UnreachableControlsResult = {
	/**
	 * - `findings`: something is reported in `unreachable` or `missingRole`.
	 * - `clean`: the tab pass covered the page and nothing was found. Not proof that every control
	 *   is reachable: see the README's limitations.
	 * - `inconclusive`: the tab pass did not cover the page, or the page could not be scanned
	 *   afterwards, so nothing is reported.
	 */
	outcome: "findings" | "clean" | "inconclusive";

	/**
	 * Why the result is inconclusive.
	 *
	 * - `session-ended-early`: the tab session stopped before the end of the tab order (`limit`,
	 *   `stuck`, `lostFocus`, `navigation` or `failed`; see `summary.sessionEnd`).
	 * - `element-limit` and `timeout`: this audit's own `elementLimit` or `timeout` cut it short.
	 * - `navigated`: the page is no longer the document the session tabbed through.
	 * - `scan-failed`: the page scan threw.
	 */
	inconclusiveReason?:
		| "session-ended-early"
		| "element-limit"
		| "timeout"
		| "navigated"
		| "scan-failed";

	/** Controls Tab never reached, in document order. */
	unreachable: UnreachableControl[];

	/** Focused elements that act as controls but expose no role, in tab order. */
	missingRole: MissingRoleControl[];

	/**
	 * The browser was asked which listeners each element has. False on Firefox and WebKit and with an
	 * adaptor that has no `inspectElements`, where a control wired up with `addEventListener` alone is
	 * only found by its role or cursor.
	 */
	listenersInspected: boolean;

	/**
	 * `candidateLimit` or `findingLimit` cut the scan or the findings short, or only a sample of the
	 * `blanket-listener` elements is listed.
	 */
	truncated: boolean;

	summary: BaseAuditSummary;
};
