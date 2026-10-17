export type { BrowserAdaptor, ElementRef, Rect } from "@a11y-pulse/browser-adaptor";
export type { KeyboardTrapOptions } from "./audit";
export {
	createKeyboardTrapAudit,
	DEFAULT_ESCAPE_ATTEMPT_ROUNDS,
	RING_ELEMENT_LIMIT,
	runKeyboardTrapAudit,
} from "./audit";
export type {
	EscapeRoute,
	KeyboardTrapElement,
	KeyboardTrapOutcome,
	KeyboardTrapResult,
} from "./result";
