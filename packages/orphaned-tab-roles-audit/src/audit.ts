import {
	type BrowserAdaptor,
	releaseStashedElements,
	stashedElementSelectors,
} from "@a11y-pulse/browser-adaptor";
import { truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import { type CollectedTabRole, collectTabRolesScript } from "./browser-scripts";
import { classifyTabRoles, type TabRoleClassification, type TabRoleVerdict } from "./classify";
import type { OrphanedTabRolesElement, OrphanedTabRolesResult } from "./result";

export const DEFAULT_REPORT_LIMIT = 10;

const STASH_KEY = "__a11yPulseOrphanedTabRoles";

export type OrphanedTabRolesOptions = {
	/** Max elements to report in each of `failed`, `needsReview` and `passed`. Defaults to 10. */
	reportLimit?: number;
};

type Classified = TabRoleClassification & { index: number; element: CollectedTabRole };

async function toElements(
	adaptor: BrowserAdaptor,
	classified: readonly Classified[],
): Promise<OrphanedTabRolesElement[]> {
	const selectors = await stashedElementSelectors(
		adaptor,
		STASH_KEY,
		classified.map(({ index }) => index),
	);

	return classified.map(({ element, finding }, i) => ({
		selector: selectors[i]!,
		html: truncateHtml(element.html),
		role: element.role,
		finding,
	}));
}

/**
 * Check that every tab on the page has a tab panel and every tab panel has a tab.
 */
export async function runOrphanedTabRolesAudit(
	adaptor: BrowserAdaptor,
	options: OrphanedTabRolesOptions = {},
): Promise<OrphanedTabRolesResult> {
	const reportLimit = options.reportLimit ?? DEFAULT_REPORT_LIMIT;

	const elements = await adaptor.evaluate(collectTabRolesScript, STASH_KEY);

	try {
		const classified: Classified[] = classifyTabRoles(elements).map((classification, index) => ({
			...classification,
			index,
			element: elements[index]!,
		}));
		const withVerdict = (verdict: TabRoleVerdict) =>
			classified.filter((entry) => entry.verdict === verdict);

		const failed = withVerdict("failed");
		const needsReview = withVerdict("needs-review");
		const passed = withVerdict("passed");

		return {
			failed: await toElements(adaptor, failed.slice(0, reportLimit)),
			needsReview: await toElements(adaptor, needsReview.slice(0, reportLimit)),
			passed: await toElements(adaptor, passed.slice(0, reportLimit)),
			summary: {
				checked: classified.length,
				failed: failed.length,
				needsReview: needsReview.length,
				passed: passed.length,
			},
		};
	} finally {
		await releaseStashedElements(adaptor, STASH_KEY);
	}
}
