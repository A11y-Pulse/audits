import {
	type BrowserAdaptor,
	releaseStashedElements,
	stashedElementSelectors,
} from "@a11y-pulse/browser-adaptor";
import { truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import { type InspectedField, inspectAuthFieldsScript } from "./browser-scripts";
import { classifyField, type FieldClassification } from "./classify";
import type { PasteBlockingField, PasteBlockingResult } from "./result";

export const DEFAULT_FIELD_LIMIT = 50;
export const DEFAULT_REPORT_LIMIT = 10;

const STASH_KEY = "__a11yPulsePasteBlocking";

export type PasteBlockingOptions = {
	/** Max authentication fields to inspect. Defaults to 50. */
	fieldLimit?: number;
	/** Max fields to report in each of `failed`, `needsReview` and `passed`. Defaults to 10. */
	reportLimit?: number;
};

type Classified = { index: number; field: InspectedField; classification: FieldClassification };

async function toFields(
	adaptor: BrowserAdaptor,
	classified: readonly Classified[],
): Promise<PasteBlockingField[]> {
	const selectors = await stashedElementSelectors(
		adaptor,
		STASH_KEY,
		classified.map(({ index }) => index),
	);

	return classified.map(({ field, classification }, i) => {
		const refused = field.blocked.length > 0;

		return {
			selector: selectors[i]!,
			html: truncateHtml(field.html),
			kind: field.kind,
			signals: classification.signals,
			blocked: field.blocked,
			detectedBy: refused ? (field.inlineHandler ? "inline-handler" : "event-listener") : null,
			autocomplete: field.autocomplete,
			boxes: field.boxes > 0 ? field.boxes : null,
			partialProbe: field.partialProbe,
			suppressed: field.suppressed,
		};
	});
}

/**
 * Find the page's password, username and one-time-code fields and check that nothing stops a
 * password manager or a paste from filling them. Pastes are simulated with synthetic events and
 * the clipboard is not touched. So that the page cannot act on the pasted text, a one-time code is
 * pasted a digit short, and form submission and `fetch`, `XMLHttpRequest` and `sendBeacon` requests
 * are stopped until every field value and the focus are back as they were found.
 */
export async function runPasteBlockingAudit(
	adaptor: BrowserAdaptor,
	options: PasteBlockingOptions = {},
): Promise<PasteBlockingResult> {
	const fieldLimit = options.fieldLimit ?? DEFAULT_FIELD_LIMIT;
	const reportLimit = options.reportLimit ?? DEFAULT_REPORT_LIMIT;

	// Focusing a field to see whether it unlocks only fires its handlers on a page that has focus.
	await adaptor.ensureFocusReporting();

	const inspection = await adaptor.evaluate(inspectAuthFieldsScript, STASH_KEY, fieldLimit);

	try {
		const classified: Classified[] = inspection.fields.map((field, index) => ({
			index,
			field,
			classification: classifyField(field),
		}));

		const failed = classified.filter(({ classification }) => classification.verdict === "failed");
		const needsReview = classified.filter(
			({ classification }) => classification.verdict === "review",
		);
		const passed = classified.filter(({ classification }) => classification.verdict === null);

		return {
			failed: await toFields(adaptor, failed.slice(0, reportLimit)),
			needsReview: await toFields(adaptor, needsReview.slice(0, reportLimit)),
			passed: await toFields(adaptor, passed.slice(0, reportLimit)),
			summary: {
				checked: classified.length,
				failed: failed.length,
				needsReview: needsReview.length,
				passed: passed.length,
				unchecked: inspection.total - classified.length,
			},
		};
	} finally {
		await releaseStashedElements(adaptor, STASH_KEY);
	}
}
