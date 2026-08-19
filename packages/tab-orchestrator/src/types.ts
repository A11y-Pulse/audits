import type { Rect } from "./adaptor";

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
};

export type Capability =
	| "baselineStyles"
	| "contextSignals"
	| "obscuring"
	| "unfocusedPair";

export type SessionEndReason =
	| "completed"
	| "lostFocus"
	| "navigation"
	| "failed";

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

/** Filled in Task 10. Optional on the snapshot until then. */
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

/** Filled in Task 8. Optional on the snapshot until then. */
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
};

export type TabConsumer = {
	readonly capabilities: ReadonlySet<Capability>;
	onSessionStart?(session: TabSessionHandle): void | Promise<void>;
	onTabStop(
		snapshot: TabStopSnapshot,
		session: TabSessionHandle,
	): void | Promise<void>;
	onSessionEnd?(reason: SessionEndReason): void;
};
