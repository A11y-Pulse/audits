export type { BrowserAdaptor, ElementRef, Rect } from "@a11y-pulse/browser-adaptor";
export type { MovingContentOptions } from "./audit";
export {
	DEFAULT_CONTROL_NAME_PATTERN,
	DEFAULT_LARGE_REGION_AREA,
	DEFAULT_MIN_REGION_AREA,
	DEFAULT_OBSERVATION_WINDOW,
	DEFAULT_REGION_LIMIT,
	DEFAULT_SCREENSHOT_INTERVAL,
	DEFAULT_SCREENSHOT_LIMIT,
	DURATION_LIMIT_MS,
	runMovingContentAudit,
} from "./audit";
export type { DetectedBy, MotionKind, MovingContentFinding } from "./classify";
export type {
	MovingContentAnimation,
	MovingContentPauseControl,
	MovingContentRegion,
	MovingContentResult,
} from "./result";
