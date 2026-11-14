import type { SkipLinkFocusPosition, SkipLinkUnreachableReason } from "./browser-scripts";

export type { SkipLinkFocusPosition, SkipLinkUnreachableReason };

export type SkipLinkFailureReason = "target-missing" | "target-hidden" | "activation-no-effect";

/** The element a skip link's fragment resolves to. */
export type SkipLinkTarget = {
	/** Selector for the target, by `id` or `a[name]`. */
	selector: string;

	/** Truncated opening tag. */
	html: string;

	/** False when the target or one of its ancestors is not rendered, such as `display: none`. */
	rendered: boolean;
};

/** Where keyboard focus was after a key press. */
export type SkipLinkFocusLanding = {
	/** Where the focused element sits relative to the skip link and its target. */
	position: SkipLinkFocusPosition;

	/** Selector for the focused element, or null when nothing was focused. */
	selector: string | null;

	/** Truncated opening tag of the focused element, or null when nothing was focused. */
	html: string | null;
};

export type SkipLinkElementResult = {
	/** Selector for the skip-link element (see getSelector). */
	selector: string;

	/** Truncated opening tag. */
	html: string;

	/** The href fragment, e.g. "#main". */
	fragment: string;

	/** 1-based tab stop at which this skip link was reached. */
	tabIndex: number;

	/** Whether activating the skip link moved keyboard focus to the target. */
	passed: boolean;

	/** Why the candidate failed, or null when it passed. */
	failureReason: SkipLinkFailureReason | null;

	/** Text of the link, falling back to its `aria-label`. */
	linkText?: string;

	/** The element the fragment resolves to, or null when nothing in the page matches it. */
	target?: SkipLinkTarget | null;

	/** Where focus was once Enter had been pressed on the link. */
	focusAfterEnter?: SkipLinkFocusLanding;

	/**
	 * Where focus was after the follow-up Tab, which is only pressed when Enter did not visibly move
	 * focus. Null when it was not pressed.
	 */
	focusAfterTab?: SkipLinkFocusLanding | null;

	/** PNG bytes of the focused skip link, clipped and padded. Only captured when it failed. */
	screenshot?: Uint8Array;
};

/** A skip link that is in the document but can never receive keyboard focus. */
export type SkipLinkUnreachableResult = {
	/** Selector for the skip-link element (see getSelector). */
	selector: string;

	/** Truncated opening tag. */
	html: string;

	/** The href fragment, e.g. "#main". */
	fragment: string;

	/** Text of the link, falling back to its `aria-label`. */
	linkText: string;

	/** Why the link cannot be focused. */
	reason: SkipLinkUnreachableReason;
};

export type SkipLinkResult = {
	/** Skip-link candidates found in the first tab stops. Empty when none were found. */
	skipLinks: SkipLinkElementResult[];

	/**
	 * Skip links that exist in the document but can never be focused. Only looked for when no skip
	 * link was reached by tabbing.
	 */
	unreachable: SkipLinkUnreachableResult[];

	summary: {
		found: number;
		passed: number;
		failed: number;
		unreachable: number;
	};
};
