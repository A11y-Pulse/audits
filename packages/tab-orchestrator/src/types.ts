import type { Rect } from "@a11y-pulse/browser-adaptor";

export type StyleSnapshot = {
	element: Record<string, string>;
	before: Record<string, string>;
	after: Record<string, string>;
};

export type ActiveElementInfo = {
	index: number | null;
	isBody: boolean;
	isIframe: boolean;
	selector: string;
	html: string;
	styles: StyleSnapshot;
	rect: Rect;
	/**
	 * The element sits on a fixed or sticky ancestor (or is one), so its page position depends on
	 * scrolling rather than on where it is in the page.
	 */
	pinned?: boolean;
	/** The element is inside an open dialog, where focus management may legitimately leave the page order. */
	inDialog?: boolean;
	/**
	 * The first opaque background colour behind the element's box, from its parent outwards, or null
	 * when it cannot be told from the ancestors: a background image or a translucent colour comes
	 * first, or the element or a see-through ancestor is positioned out of the flow (absolute, fixed
	 * or sticky) and so may be painted over something else. Present when styles were read.
	 */
	backdrop?: string | null;
	/**
	 * A CSS transition or animation was running on the element, its labels or its nearest ancestors
	 * when the styles were read, so they may be part-way values. Present when styles were read.
	 */
	animating?: boolean;
};

export type Capability =
	| "baselineStyles"
	| "contextSignals"
	| "obscuring"
	| "screenshot"
	| "unfocusedPair";

/**
 * `stuck`: focus never came back out of an iframe, or never settled on an element. `limit`: the
 * session's own cap on Tab presses or duration ran out before the tab order did, so the page was
 * only partly covered. `failed`: the session threw, or, for one consumer alone, that consumer did.
 */
export type SessionEndReason =
	| "completed"
	| "lostFocus"
	| "navigation"
	| "failed"
	| "stuck"
	| "limit";

export type SessionEndDetail = {
	/**
	 * Marker index of the element whose second visit ended the session, or `null` when the session
	 * ended any other way. A `"completed"` session with an index here ended on a cycle rather than by
	 * tabbing off the end of the page.
	 */
	revisitedIndex: number | null;

	/**
	 * The iframe focus was still inside when a `"stuck"` session gave up on it. Absent or `null` when
	 * the session ended any other way.
	 */
	stuckIn?: { selector: string; html: string } | null;

	/**
	 * Present when a `"navigation"` session ended without any consumer having been shown the element
	 * that navigated: the document went before it could be read. `after` is the last tab stop the
	 * session delivered, so the element responsible is the one the next Tab press reaches. `url` is
	 * where the page went, when it could be read.
	 */
	navigation?: { after: { selector: string; html: string } | null; url: string | null };

	/**
	 * What the context observer still had to report when the session ended, for sessions with a
	 * `contextSignals` consumer: changes short timers made on behalf of the last elements in the tab
	 * order (the session waits up to a second for those timers before it ends), and changes nothing
	 * ties to a focused element. Absent when there was nothing left to report.
	 */
	contextSignals?: Pick<ContextChangeDrain, "late" | "unattributed">;
};

export type UnfocusedPair = {
	focusedScreenshot: Uint8Array;
	unfocusedScreenshot: Uint8Array;
	unfocusedStyles: StyleSnapshot;
	focusedRect: Rect;
	unfocusedRect: Rect;
	focusedClip: Rect;
	unfocusedClip: Rect;
	scale: number;

	/**
	 * What the screenshots and rects are of. The focused element itself, unless it draws nothing (the
	 * real input of a custom checkbox or switch), in which case its label or nearest visible ancestor.
	 * With a label, the screenshots also take in the input's nearest visible ancestor when that is
	 * small, since the indicator may be drawn on a sibling of the input and not on the label.
	 */
	clipTarget?: PairClipTarget;

	/** The focused element draws nothing itself: transparent, clipped to a pixel, or off the page. */
	unpainted?: boolean;

	/**
	 * Something unrelated still covered the clip target after it was centred in the viewport, so the
	 * screenshots may show that instead of the element.
	 */
	obstructed?: boolean;

	/**
	 * The element shows a text caret while focused. The caret is hidden in both screenshots, so that
	 * it cannot stand in for a focus indicator.
	 */
	caretHidden?: boolean;

	/**
	 * Focus-relevant styles of the element's nearest ancestors and its labels, with and without focus
	 * on the element. Entries whose styles differ show the focus somewhere other than the element.
	 */
	context?: PairContext[];

	/** The first opaque background colour behind the element, or null when it cannot be told. */
	background?: string | null;
};

export type PairClipTarget = "element" | "label" | "parent";

export type PairContext = {
	kind: "ancestor" | "label";
	/** The element's own tag, without its children. */
	html: string;
	focusedStyles: StyleSnapshot;
	unfocusedStyles: StyleSnapshot;
	/**
	 * It holds another tab stop besides the focused element, so a change to it shows that focus is
	 * somewhere inside, not which element has it.
	 */
	shared?: true;
	/**
	 * A CSS animation (not a transition) was running on it, so its styles differ from one read to
	 * the next whether or not focus moved.
	 */
	animating?: true;
};

export type TabStopSnapshot = {
	tabIndex: number;
	activeElement: ActiveElementInfo;
	baselineStyles?: StyleSnapshot;
	contextSignals?: ContextChangeDrain;
	obscuring?: ObscuredMeasurement;
};

export type ContextChangeDrain = {
	signals: ContextChangeSignals;
	/** What is known about each signal beyond the fact of it. */
	details?: ContextChangeDetails;
	/**
	 * Changes a short timer made on behalf of an element focus has already left. They belong to that
	 * earlier tab stop, not to this one.
	 */
	late?: LateContextChange[];
	/**
	 * Changes the page made that nothing ties to a focused element: they happened outside any
	 * element's focus handling and outside any timer set there (a session-expiry redirect, a poll
	 * loop that opens a window). They are not this stop's doing, and are reported here only because
	 * this is when they were seen.
	 */
	unattributed?: UnattributedContextChange[];
};

export type UnattributedContextChange = {
	signals: ContextChangeSignals;
	details: ContextChangeDetails;
};

export type ContextChangeDetails = {
	/** The URL passed to `window.open`. */
	openedWindowUrl?: string;
	/** The form that was submitted. `selector` is `null` when it could not be resolved. */
	submittedForm?: { selector: string | null; html: string; action: string };
	/** A soft URL change: where the address bar was and where it is now. */
	urlChange?: { from: string; to: string };
	/** Where the page navigated, or tried to. */
	navigationUrl?: string;
	/**
	 * The element that received focus and then dropped it or passed it elsewhere. Differs from the
	 * snapshot's `activeElement` when focus was redirected: that is where focus ended up.
	 */
	attributed?: { selector: string; html: string };
};

export type LateContextChange = {
	/** Marker index of the element the change belongs to, when it has been a tab stop. */
	index: number | null;
	html: string;
	signals: ContextChangeSignals;
	details: ContextChangeDetails;
};

export type ContextChangeSignals = {
	openedWindow: boolean;
	submittedForm: boolean;
	focusRemoved: boolean;
	redirect: "outside" | "same-subtree" | null;
	softUrlChange: boolean;
	navigation: boolean;
	/**
	 * The page raised a native dialog (`alert`, `confirm`, `prompt`), which the adaptor dismissed.
	 * With a `contextSignals` consumer attached the context observer says which element raised it,
	 * as for any other change; without one, a dialog the adaptor dismissed during a stop is put
	 * down to that stop. Only set by adaptors that dismiss dialogs.
	 */
	openedDialog?: boolean;
	/**
	 * The page tried to navigate to another document and the context observer cancelled it, so the
	 * session carries on. `navigation` stays for a navigation that went ahead.
	 */
	navigationPrevented?: boolean;
	/**
	 * Focus was passed on by a focus guard (an empty, unnamed, non-interactive element such as the
	 * sentinels dialogs put at their edges). Not reported as a redirect.
	 */
	focusGuard?: boolean;
};

export type ObscuredMeasurement = {
	coveredFraction: number;
	fullyObscured: boolean;
	offscreen: boolean;
	/**
	 * How the cover as a whole paints over the element: `"opaque"` when an opaque background, a
	 * background image or replaced content (an image, video, canvas or frame) lies over every sampled
	 * point; `"semi-transparent"` when the element shows through at any of them; `"unknown"` when
	 * that could not be told (a gradient with a see-through stop, an SVG, or several covers that no
	 * single box accounts for).
	 */
	opacity: "opaque" | "semi-transparent" | "unknown";
	/**
	 * The cover: the outermost fixed, sticky or absolutely positioned element the covering content
	 * belongs to, or what several covers have in common. `rect` is viewport-relative.
	 */
	obscuredBy: {
		selector: string;
		html: string;
		rect?: Rect;
		/** Computed `position` of the cover, such as `"fixed"` or `"sticky"`. */
		position?: string;
		/** The cover has `pointer-events: none`. */
		ignoresPointerEvents?: boolean;
	} | null;
	/** Viewport-relative box that was measured, clipped to the viewport unless `offscreen`. */
	rect?: Rect;
	/**
	 * `"label"` when the focused element is itself not painted (the transparent or clipped input of
	 * a custom checkbox or switch) and its label was measured in its place.
	 */
	measured?: "label";
	/** The focused element is not painted and has no label, so nothing could be measured. */
	notPainted?: boolean;
};

export type TabSessionHandle = {
	disconnect(): void;
	ensureUnfocusedPair(): Promise<UnfocusedPair>;
	/**
	 * Screenshot the currently focused element, clipped and padded. Requires the `screenshot`
	 * capability. Cached per stop, so multiple consumers calling this on the same stop only trigger
	 * one capture.
	 *
	 * `"attributed"` captures the element named by `contextSignals.details.attributed` instead: the
	 * one that took focus and then gave it away. It rejects when the stop has no such element.
	 */
	screenshotClip(target?: "focused" | "attributed"): Promise<Uint8Array>;
	/**
	 * Screenshot a strip the width of the viewport around the currently focused element, with the
	 * element's box outlined, so that an element hidden behind something can still be located.
	 * Requires the `screenshot` capability. Not cached: each call is a capture. Optional only so
	 * that a hand-written handle need not supply it; a session's own handle always does.
	 */
	screenshotContext?(): Promise<Uint8Array>;
};

/** What a session did, for monitoring its cost. */
export type TabSessionStats = {
	/** Tab stops delivered to consumers. */
	tabStops: number;
	unfocusedPairs: number;
	screenshots: number;
	/** Time spent capturing pairs and screenshots, including centring scrolls and blur/refocus. */
	captureMs: number;
	durationMs: number;
	/** Null when every consumer disconnected itself before the session ended. */
	endReason: SessionEndReason | null;
	/** Native dialogs the page raised during the session, each dismissed by the adaptor. */
	dialogsDismissed: number;
};

/** A consumer that threw from one of its callbacks, and what it threw. */
export type ConsumerFailure = {
	consumer: TabConsumer;
	error: unknown;
};

export type TabConsumer = {
	readonly capabilities: ReadonlySet<Capability>;
	onSessionStart?(session: TabSessionHandle): void | Promise<void>;
	onTabStop(snapshot: TabStopSnapshot, session: TabSessionHandle): void | Promise<void>;
	onSessionEnd?(reason: SessionEndReason, detail: SessionEndDetail): void;
};
