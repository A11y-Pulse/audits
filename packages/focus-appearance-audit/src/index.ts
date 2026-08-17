export type {
	ElementRef,
	FocusAppearanceAuditAdaptor as BrowserAdaptor,
	Rect,
} from "./adaptor";
export type { FocusAppearanceOptions } from "./audit";
export { runFocusAppearanceAudit } from "./audit";
export type { StyleSnapshot } from "./detection";
export { omitIdleStyleSnapshot } from "./detection";
export type {
	DetectionMethod,
	FocusAppearanceResult,
	FocusElementResult,
	FocusFailureEvidence,
	IndicatorDetection,
} from "./result";
