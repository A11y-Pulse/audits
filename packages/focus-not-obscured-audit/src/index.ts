export type { BrowserAdaptor, ElementRef, Rect } from "@a11y-pulse/browser-adaptor";
export type { FocusNotObscuredAudit, FocusNotObscuredOptions } from "./audit";
export {
	createFocusNotObscuredAudit,
	DEFAULT_SCREENSHOT_LIMIT,
	DEFAULT_SCROLLED_TO_TOP_LIMIT,
	runFocusNotObscuredAudit,
} from "./audit";
export type { ObscuredMeasurement, ObscuringBucket } from "./classify";
export { classifyObscuring } from "./classify";
export type {
	FocusNotObscuredElementResult,
	FocusNotObscuredResult,
} from "./result";
