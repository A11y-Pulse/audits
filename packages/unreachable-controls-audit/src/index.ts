export type {
	BrowserAdaptor,
	ElementInspection,
	ElementRef,
	UnreachableControlsAdaptor,
} from "./adaptor";
export type { UnreachableControlsOptions } from "./audit";
export {
	createUnreachableControlsAudit,
	DEFAULT_CANDIDATE_LIMIT,
	DEFAULT_FINDING_LIMIT,
	runUnreachableControlsAudit,
} from "./audit";
export type {
	ControlSignals,
	MissingRoleControl,
	MissingRoleReason,
	UnreachableControl,
	UnreachableControlsResult,
	UnreachableReason,
} from "./result";
