import type { BaseAuditSummary } from "@a11y-pulse/tab-orchestrator";
import type { TransitionKind } from "./analyse";

export type FocusOrderElement = {
	/** Selector for the element (see getSelector). */
	selector: string;

	/** Truncated opening tag; the internal marker attribute is already stripped. */
	html: string;

	/** 1-based tab stop at which this element was reached. */
	tabIndex: number;
};

export type FocusOrderTransition = {
	kind: TransitionKind;
	from: FocusOrderElement;
	to: FocusOrderElement;
};

export type FocusOrderResult = {
	/**
	 * - `disordered`: focus repeatedly moved a long way against the reading order.
	 * - `unremarkable`: nothing in the sequence suggests a problem. Geometry cannot show that an
	 *   order preserves meaning, so this is not a pass.
	 * - `inconclusive`: the page navigated, or could not be read, before the sequence was judged.
	 * - `no-focusable`: nothing on the page took focus.
	 */
	outcome: "disordered" | "unremarkable" | "inconclusive" | "no-focusable";

	/** The offending transitions in tab order. Empty unless `disordered`. */
	transitions: FocusOrderTransition[];

	/** Some element on the page has a positive `tabindex`, a likely cause of disorder. */
	positiveTabindex: boolean;

	summary: BaseAuditSummary;
};
