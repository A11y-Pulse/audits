import type { BaseAuditSummary } from "@a11y-pulse/tab-orchestrator";

import type { ContextChangeFinding } from "./classify";

export type ContextChangeOnFocusElementResult = {
	/**
	 * Selector for the element the findings are about (see getSelector). When focus was removed or
	 * redirected this is the element that received focus and gave it away, not where focus ended up;
	 * that is on the finding as `redirectedTo`. Empty only for a delayed change whose element was
	 * never a tab stop of its own.
	 */
	selector: string;

	/** Truncated opening tag; the internal marker attribute is already stripped. */
	html: string;

	/** 1-based tab stop at which this element was reached. */
	tabIndex: number;

	/** Every context-change finding observed for this element, if any. */
	findings: ContextChangeFinding[];

	/** True if any of `findings` has `bucket === "violation"`. */
	failed: boolean;

	/**
	 * PNG bytes of this element, clipped and padded. Only captured for an element with findings,
	 * never after a navigation that went ahead, and omitted past `screenshotLimit`.
	 */
	screenshot?: Uint8Array;
};

export type ContextChangeOnFocusResult = {
	/** Every focusable element that was checked, in tab order. */
	elements: ContextChangeOnFocusElementResult[];

	/**
	 * Present when the page navigated away on focus and the element responsible could not be read
	 * before its document was gone (browsers without the Navigation API). `after` is the last element
	 * checked: the element that navigated is the next one in the tab order. `url` is where the page
	 * went. This is a violation that no entry in `elements` carries.
	 */
	navigation?: {
		after: { selector: string; html: string } | null;
		url: string | null;
	};

	/**
	 * Changes of context the page made during the pass that no focused element can be shown to have
	 * caused: they happened outside any element's focus handling and outside any timer set there (a
	 * session-expiry redirect, a poll loop opening a window, a dialog raised on a schedule). Always
	 * `bucket: "incomplete"`, each kind and URL listed once. The session blocks these like any other
	 * (a navigation is cancelled, a window is not opened), so the page was left where it was. Absent
	 * when there were none.
	 */
	unattributed?: ContextChangeFinding[];

	summary: BaseAuditSummary;
};
