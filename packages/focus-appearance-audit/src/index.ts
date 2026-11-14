export type { BrowserAdaptor, ElementRef, Rect } from "@a11y-pulse/browser-adaptor";
export type { FocusAppearanceOptions } from "./audit";
export {
	createFocusAppearanceAudit,
	DEFAULT_SCREENSHOT_LIMIT,
	hasLowContrastIndicator,
	runFocusAppearanceAudit,
} from "./audit";
export type { StyleSnapshot } from "./detection";
export { MIN_LIGHTNESS_CONTRAST, omitIdleStyleSnapshot } from "./detection";
export { MIN_INDICATOR_CONTRAST } from "./indicator-contrast";
export type {
	ColorOnlyChange,
	DetectionMethod,
	FocusAppearanceResult,
	FocusAppearanceSummary,
	FocusElementResult,
	FocusFailureEvidence,
	IndicatorContrast,
	IndicatorDetection,
	NeedsReviewReason,
} from "./result";
