import type { Result } from "axe-core";
import { type AuditOutput, emptyOutput } from "./to-axe/audit-output";

/** The id axe-core itself is reported under when it could not run at all. */
export const AXE_CORE_AUDIT_ID = "axe-core";

/** Tags every entry for an audit that could not be completed carries, so consumers can filter on it. */
export const AUDIT_FAILED_TAG = "a11y-pulse.audit-failed";

const HELP_URL =
	"https://github.com/A11y-Pulse/audits/tree/main/packages/audit-runner#audits-that-could-not-run";

/** Thrown in place of a step that outlived the time it was given. */
export class StepTimeoutError extends Error {
	constructor(milliseconds: number) {
		super(`Timed out after ${Math.round(milliseconds)}ms`);
		this.name = "StepTimeoutError";
	}
}

/**
 * Thrown when the page or the browser went away mid-run. Nothing measured after that point means
 * anything, so the run is abandoned instead of being reported as a set of incomplete audits.
 */
export class BrowserClosedError extends Error {
	constructor() {
		super(
			"The browser or the page closed during the run (it may have crashed), so there are no results to report.",
		);
		this.name = "BrowserClosedError";
	}
}

const CLOSED_MESSAGE =
	/target closed|session closed|connection closed|browser has been closed|page has been closed|browser.*disconnected|target page, context or browser has been closed/i;

/** Whether an error reads like the automation library reporting a page or browser that is gone. */
export function looksLikeClosedBrowser(error: unknown): boolean {
	return error instanceof Error && CLOSED_MESSAGE.test(error.message);
}

export function errorMessage(error: unknown): string {
	if (error instanceof Error) {
		return error.message || error.name;
	}

	return String(error);
}

/**
 * Report an audit that threw, timed out or was skipped as `incomplete`, so it is never mistaken for
 * one that ran and found nothing.
 */
export function failedAuditOutput(id: string, name: string, reason: string): AuditOutput {
	const result: Result = {
		id,
		help: `${name} could not be completed`,
		description: `${name} did not finish, so this page has not been checked by it: ${reason}`,
		helpUrl: HELP_URL,
		impact: null,
		tags: [AUDIT_FAILED_TAG],
		nodes: [],
	};

	return { ...emptyOutput(), incomplete: [result] };
}
