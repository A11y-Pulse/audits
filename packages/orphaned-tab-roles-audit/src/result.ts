import type { TabRole } from "./browser-scripts";
import type { TabRoleFinding } from "./classify";

export type OrphanedTabRolesElement = {
	/** Selector for the element (see getSelector). */
	selector: string;

	/** Truncated opening tag. */
	html: string;

	role: TabRole;

	/** What is wrong with the element's association, or null when it has one. */
	finding: TabRoleFinding | null;
};

export type OrphanedTabRolesResult = {
	/** Tabs and tab panels that provably have no counterpart. */
	failed: OrphanedTabRolesElement[];

	/** Tabs and tab panels with no declared counterpart, for a human to check. */
	needsReview: OrphanedTabRolesElement[];

	passed: OrphanedTabRolesElement[];

	/** Full counts. Each element list stops at `reportLimit`. */
	summary: {
		/** Elements with role `tab` or `tabpanel`. */
		checked: number;
		failed: number;
		needsReview: number;
		passed: number;
	};
};
