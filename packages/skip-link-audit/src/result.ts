export type SkipLinkFailureReason = "target-missing" | "activation-no-effect";

export type SkipLinkElementResult = {
	/** Selector for the skip-link element (see getSelector). */
	selector: string;

	/** Truncated opening tag. */
	html: string;

	/** The href fragment, e.g. "#main". */
	fragment: string;

	/** 1-based tab stop at which this skip link was reached. */
	tabIndex: number;

	/** Whether activating the skip link moved keyboard focus to the target. */
	passed: boolean;

	/** Why the candidate failed, or null when it passed. */
	failureReason: SkipLinkFailureReason | null;
};

export type SkipLinkResult = {
	/** Skip-link candidates found in the first tab stops. Empty when none were found. */
	skipLinks: SkipLinkElementResult[];
	summary: {
		found: number;
		passed: number;
		failed: number;
	};
};
