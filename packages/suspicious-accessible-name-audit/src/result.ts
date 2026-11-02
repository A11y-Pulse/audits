import type { NameSource } from "./browser-scripts";
import type { NameSignal } from "./classify";
import type { WcagCriterion } from "./criterion";

export type SuspiciousNameElement = {
	/** Selector for the element (see getSelector). */
	selector: string;

	/** Truncated opening tag. */
	html: string;

	/** The accessible name, whitespace-collapsed. */
	name: string;

	nameSource: NameSource;

	/** The computed role, or `iframe` for an `<iframe>`. */
	role: string;

	/** What makes the name code or a placeholder, or null when nothing does. */
	signal: NameSignal | null;

	/** The matched attribute for `attribute-match`, the matched word for `role-word`. */
	evidence: string | null;

	/** The success criterion the element's name falls under, or null for best practice. */
	criterion: WcagCriterion | null;
};

export type SuspiciousNameResult = {
	/** Names that are a leftover script value, template token or the element's own identifier. */
	failed: SuspiciousNameElement[];

	/** Names that look like an identifier or placeholder, or repeat the role, for a human to check. */
	needsReview: SuspiciousNameElement[];

	passed: SuspiciousNameElement[];

	/** Full counts. Each element list stops at `reportLimit`. */
	summary: {
		/** Rendered elements with an accessible name, up to `elementLimit`. */
		checked: number;
		failed: number;
		needsReview: number;
		passed: number;
		/** Named elements past `elementLimit`, which were not checked. */
		unchecked: number;
	};
};
