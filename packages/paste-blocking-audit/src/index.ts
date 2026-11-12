export type { BrowserAdaptor, ElementRef } from "@a11y-pulse/browser-adaptor";
export type { PasteBlockingOptions } from "./audit";
export { DEFAULT_FIELD_LIMIT, DEFAULT_REPORT_LIMIT, runPasteBlockingAudit } from "./audit";
export type {
	AuthFieldKind,
	BlockMechanism,
	InspectedField,
	SuppressedAction,
} from "./browser-scripts";
export type { FieldClassification, PasteBlockingSignal, Verdict } from "./classify";
export { classifyField } from "./classify";
export type { PasteBlockDetection, PasteBlockingField, PasteBlockingResult } from "./result";
