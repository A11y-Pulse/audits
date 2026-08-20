export type {
	ElementRef,
	TextSpacingAuditAdaptor,
	TextSpacingAuditAdaptor as BrowserAdaptor,
} from "./adaptor";
export type { TextSpacingOptions } from "./audit";
export { classifyTextSpacing, runTextSpacingAudit } from "./audit";
export type {
	CandidateSnapshot,
	TextSpacingElementResult,
	TextSpacingFindingKind,
	TextSpacingRect,
	TextSpacingResult,
} from "./result";
