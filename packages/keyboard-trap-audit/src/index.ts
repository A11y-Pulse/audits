export type { BrowserAdaptor, ElementRef, Rect } from "@a11y-pulse/browser-adaptor";
export type { EscapeKey, KeyboardTrapOptions } from "./audit";
export {
	createKeyboardTrapAudit,
	DEFAULT_ESCAPE_ATTEMPT_ROUNDS,
	RING_ELEMENT_LIMIT,
	RING_SAMPLE_SPAN,
	RING_WALK_LIMIT,
	runKeyboardTrapAudit,
} from "./audit";
export type {
	EscapeAttempt,
	EscapeRoute,
	InconclusiveReason,
	KeyboardTrapElement,
	KeyboardTrapOutcome,
	KeyboardTrapResult,
	TrapDialog,
} from "./result";
