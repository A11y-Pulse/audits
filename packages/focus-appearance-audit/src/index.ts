export type {
	BrowserAdaptor,
	ElementRef,
	FocusAppearanceAuditAdaptor,
	Rect,
} from "./adaptor";
export type { FocusAppearanceOptions } from "./audit";
export { runFocusAppearanceAudit } from "./audit";
export type {
	ContextChangeBucket,
	ContextChangeFinding,
	ContextChangeKind,
} from "./context-change";
export type {
	ObscuredBy,
	ObscuredMeasurement,
	ObscuredOpacity,
	ObscuringBucket,
} from "./obscuring";
export type {
	DetectionMethod,
	FocusAppearanceResult,
	FocusElementResult,
} from "./result";
