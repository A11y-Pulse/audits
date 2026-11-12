/**
 * The page-side text measurement behind the audit: baseline, re-measure, describe and restore
 * scripts, and the overlap comparison. Exported for audits that measure the same thing under a
 * different change to the page, such as `@a11y-pulse/resize-text-audit`.
 */
export type {
	BaselineConfig,
	BaselinePayload,
	DescribePayload,
	DescribeRequest,
	ElementDescription,
	OverlapInput,
	OverlapPair,
	RemeasurePayload,
	RestorePayload,
} from "./browser-scripts";
export {
	collectBaselineScript,
	describeFindingsScript,
	FREEZE_CSS,
	findOverlapPairs,
	MAX_TEXT_RECTS,
	remeasureScript,
	restoreAndVerifyScript,
} from "./browser-scripts";
export type { CandidateSnapshot, TextSpacingRect } from "./result";
