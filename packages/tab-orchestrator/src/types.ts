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
};

export type Capability =
	| "baselineStyles"
	| "contextSignals"
	| "obscuring"
	| "screenshot"
	| "unfocusedPair";

/** `stuck`: focus never came back out of an iframe. */
export type SessionEndReason = "completed" | "lostFocus" | "navigation" | "failed" | "stuck";

export type SessionEndDetail = {
	/**
	 * Marker index of the element whose second visit ended the session, or `null` when the session
	 * ended any other way. A `"completed"` session with an index here ended on a cycle rather than by
	 * tabbing off the end of the page.
	 */
	revisitedIndex: number | null;
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
};

export type ContextChangeSignals = {
	openedWindow: boolean;
	submittedForm: boolean;
	focusRemoved: boolean;
	redirect: "outside" | "same-subtree" | null;
	softUrlChange: boolean;
	navigation: boolean;
};

export type ObscuredMeasurement = {
	coveredFraction: number;
	fullyObscured: boolean;
	offscreen: boolean;
	opacity: "opaque" | "semi-transparent" | "unknown";
	obscuredBy: { selector: string; html: string } | null;
};

export type TabSessionHandle = {
	disconnect(): void;
	ensureUnfocusedPair(): Promise<UnfocusedPair>;
	/**
	 * Screenshot the currently focused element, clipped and padded. Requires the `screenshot`
	 * capability. Cached per stop, so multiple consumers calling this on the same stop only trigger
	 * one capture.
	 */
	screenshotClip(): Promise<Uint8Array>;
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
};

export type TabConsumer = {
	readonly capabilities: ReadonlySet<Capability>;
	onSessionStart?(session: TabSessionHandle): void | Promise<void>;
	onTabStop(snapshot: TabStopSnapshot, session: TabSessionHandle): void | Promise<void>;
	onSessionEnd?(reason: SessionEndReason, detail: SessionEndDetail): void;
};
