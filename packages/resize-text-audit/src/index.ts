export type {
	ElementRef,
	ResizeTextAuditAdaptor as BrowserAdaptor,
	ResizeTextAuditAdaptor,
} from "./adaptor";
export type { ResizeTextOptions } from "./audit";
export { classifyResizedText, runResizeTextAudit } from "./audit";
export type {
	ResizeTextAxis,
	ResizeTextElementResult,
	ResizeTextFindingKind,
	ResizeTextRect,
	ResizeTextResult,
	ResizeTextViewport,
	ViewportMeta,
} from "./result";
