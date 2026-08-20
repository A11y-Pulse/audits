export type {
	BrowserAdaptor,
	ElementRef,
	Rect,
} from "@a11y-pulse/tab-orchestrator";
export type { FocusNotObscuredOptions } from "./audit";
export {
	createFocusNotObscuredAudit,
	runFocusNotObscuredAudit,
} from "./audit";
export type { ObscuredMeasurement, ObscuringBucket } from "./classify";
export { classifyObscuring } from "./classify";
export type {
	FocusNotObscuredElementResult,
	FocusNotObscuredResult,
} from "./result";
