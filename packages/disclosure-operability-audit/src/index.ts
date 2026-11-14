export type { BrowserAdaptor, ElementRef } from "@a11y-pulse/browser-adaptor";
export type { DisclosureOperabilityOptions } from "./audit";
export {
	DEFAULT_ACTIVATION_TIMEOUT_MS,
	DEFAULT_RISKY_NAME_PATTERN,
	DEFAULT_TRIGGER_LIMIT,
	runDisclosureOperabilityAudit,
} from "./audit";
export type { DisclosureSkipReason } from "./browser-scripts";
export type {
	DisclosureAttempt,
	DisclosureClassification,
	DisclosureKey,
	DisclosureObservation,
	DisclosureRestore,
	DisclosureSignal,
	Verdict,
} from "./classify";
export { classifyTrigger } from "./classify";
export type {
	DisclosureOperabilityResult,
	DisclosureSkipped,
	DisclosureTrigger,
} from "./result";
