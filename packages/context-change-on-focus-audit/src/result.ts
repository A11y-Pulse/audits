import type { BaseAuditSummary } from "@a11y-pulse/tab-orchestrator";

import type { ContextChangeFinding } from "./classify";

export type ContextChangeOnFocusElementResult = {
	/** Selector for the focused element (see getSelector). */
	selector: string;

	/** Truncated opening tag; the internal marker attribute is already stripped. */
	html: string;

	/** 1-based tab stop at which this element was reached. */
	tabIndex: number;

	/** Every context-change finding observed at this tab stop, if any. */
	findings: ContextChangeFinding[];

	/** True if any of `findings` has `bucket === "violation"`. */
	failed: boolean;
};

export type ContextChangeOnFocusResult = {
	/** Every focusable element that was checked, in tab order. */
	elements: ContextChangeOnFocusElementResult[];
	summary: BaseAuditSummary;
};
