import {
	type BrowserAdaptor,
	releaseStashedElements,
	stashedElementSelectors,
} from "@a11y-pulse/browser-adaptor";
import { truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import { type CollectedElement, collectNamedElementsScript } from "./browser-scripts";
import { classifyName, type NameMatch, type NameSignal } from "./classify";
import { wcagCriterion } from "./criterion";
import type { SuspiciousNameElement, SuspiciousNameResult } from "./result";
import { resolveVocabulary, type VocabularyOverride } from "./vocabulary";

export const DEFAULT_ELEMENT_LIMIT = 2000;
export const DEFAULT_REPORT_LIMIT = 10;

const STASH_KEY = "__a11yPulseSuspiciousAccessibleName";

// Far longer than any identifier or placeholder, so a cut-short name is never one.
const NAME_LIMIT = 300;

const FAILED_SIGNALS: ReadonlySet<NameSignal> = new Set(["artefact", "attribute-match"]);

export type SuspiciousNameOptions = {
	/** Max named elements to check, so endless listings cannot balloon the scan. Defaults to 2000. */
	elementLimit?: number;
	/** Max elements to report in each of `failed`, `needsReview` and `passed`. Defaults to 10. */
	reportLimit?: number;
	/** Words to extend or replace the built-in English words with, for pages in other languages. */
	vocabulary?: VocabularyOverride;
};

type Classified = { index: number; element: CollectedElement; match: NameMatch | null };

async function toElements(
	adaptor: BrowserAdaptor,
	classified: readonly Classified[],
): Promise<SuspiciousNameElement[]> {
	const selectors = await stashedElementSelectors(
		adaptor,
		STASH_KEY,
		classified.map(({ index }) => index),
	);

	return classified.map(({ element, match }, i) => ({
		selector: selectors[i]!,
		html: truncateHtml(element.html),
		name: element.name,
		nameSource: element.source,
		role: element.role,
		signal: match?.signal ?? null,
		evidence: match?.evidence ?? null,
		criterion: wcagCriterion(element, match?.signal ?? null),
	}));
}

/**
 * Check the accessible name of every rendered control, link, labelled landmark, dialog and iframe
 * on the page for code, template tokens and placeholders.
 */
export async function runSuspiciousNameAudit(
	adaptor: BrowserAdaptor,
	options: SuspiciousNameOptions = {},
): Promise<SuspiciousNameResult> {
	const elementLimit = options.elementLimit ?? DEFAULT_ELEMENT_LIMIT;
	const reportLimit = options.reportLimit ?? DEFAULT_REPORT_LIMIT;
	const vocabulary = resolveVocabulary(options.vocabulary);

	const collection = await adaptor.evaluate(
		collectNamedElementsScript,
		STASH_KEY,
		elementLimit,
		NAME_LIMIT,
	);

	try {
		const classified: Classified[] = collection.elements.map((element, index) => ({
			index,
			element,
			match: element.truncated
				? null
				: classifyName(element, vocabulary.roleWords(element.lang), vocabulary),
		}));

		const failed = classified.filter(({ match }) => match && FAILED_SIGNALS.has(match.signal));
		const needsReview = classified.filter(
			({ match }) => match && !FAILED_SIGNALS.has(match.signal),
		);
		const passed = classified.filter(({ match }) => match === null);

		return {
			failed: await toElements(adaptor, failed.slice(0, reportLimit)),
			needsReview: await toElements(adaptor, needsReview.slice(0, reportLimit)),
			passed: await toElements(adaptor, passed.slice(0, reportLimit)),
			summary: {
				checked: classified.length,
				failed: failed.length,
				needsReview: needsReview.length,
				passed: passed.length,
				unchecked: collection.total - classified.length,
			},
		};
	} finally {
		await releaseStashedElements(adaptor, STASH_KEY);
	}
}
