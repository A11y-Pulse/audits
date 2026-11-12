import type { FocusAppearanceResult, FocusElementResult } from "@a11y-pulse/focus-appearance-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	evidenceCheck,
	toResult,
} from "./audit-output";

export const FOCUS_APPEARANCE_AUDIT_ID = "focus-appearance";

export const FOCUS_APPEARANCE_EVIDENCE_CHECK_ID = "focus-appearance-evidence";

const METADATA: AuditMetadata = {
	id: FOCUS_APPEARANCE_AUDIT_ID,
	help: "Interactive elements must have a visible focus indicator",
	description:
		"Ensures that elements which receive keyboard focus show a visible focus indicator, as required by WCAG 2.4.7 Focus Visible.",
	helpUrl: "https://github.com/A11y-Pulse/audits/tree/main/packages/focus-appearance-audit#readme",
	impact: "serious",
	tags: ["wcag2aa", "wcag247", "cat.keyboard"],
};

const REVIEW_SUMMARY: Record<NonNullable<FocusElementResult["needsReview"]>, string> = {
	caret:
		"The only visible sign of focus is the text caret. Check that the field is clearly shown as focused, for example with an outline or a border change.",
	obstructed:
		"Other content covered this element while it was measured, so its focus indicator could not be checked. Check it by hand, and that focused elements are not hidden behind other content.",
	"shared-indicator":
		"The only change on focus is on a container that holds other focusable elements too, so it shows that focus is inside the container but not on which element. Check that this element itself is clearly shown as focused.",
	animating:
		"An animation was running around this element while it was measured, so a change seen on focus may be the animation and not a focus indicator. Check it by hand.",
};

function failureSummary(element: FocusElementResult): string {
	if (element.needsReview !== undefined) {
		return `${REVIEW_SUMMARY[element.needsReview]} (tab stop #${element.tabIndex})`;
	}

	const measured =
		element.measuredOn === undefined
			? ""
			: ` The element draws nothing itself, so its ${element.measuredOn === "label" ? "label" : "parent element"} was compared with and without focus.`;

	return `Element did not show a focus indicator (tab stop #${element.tabIndex}).${measured} Ensure a visible focus indicator appears on all interactive elements when they receive keyboard focus.`;
}

function evidenceMessage(element: FocusElementResult, failed: boolean): string {
	if (element.needsReview === "obstructed") {
		return "Focus indicator could not be checked";
	}

	if (element.needsReview === "caret") {
		return "The text caret was the only visible sign of focus";
	}

	if (element.needsReview === "shared-indicator") {
		return "The only change on focus was on a container shared with other focusable elements";
	}

	if (element.needsReview === "animating") {
		return "An animation was running while the focus indicator was measured";
	}

	if (failed) {
		return "No visible focus indicator detected";
	}

	return element.detectionMethod === "pixel-diff"
		? "Focus indicator detected by comparing screenshots with and without focus"
		: "Focus indicator detected from a change in computed style";
}

function toAuditNode(element: FocusElementResult, failed: boolean): AuditNode {
	const node: AuditNode = { selector: element.selector, html: element.html };

	if (failed) {
		node.failureSummary = failureSummary(element);
	}

	// The screenshots and styles of `failureEvidence` stay at the top level of `data`, where they
	// have always been.
	node.evidence = evidenceCheck(
		FOCUS_APPEARANCE_EVIDENCE_CHECK_ID,
		"serious",
		evidenceMessage(element, failed),
		{
			tabIndex: element.tabIndex,
			detectionMethod: element.detectionMethod,
			needsReview: element.needsReview,
			changedProperties: element.changedProperties,
			indicatorOn: element.indicatorOn,
			measuredOn: element.measuredOn,
			...(failed ? element.failureEvidence : {}),
		},
	);

	return node;
}

export function focusAppearanceToAxe(result: FocusAppearanceResult): AuditOutput {
	const review = result.elements.filter((element) => element.needsReview !== undefined);
	const passed = result.elements.filter(
		(element) => element.passed && element.needsReview === undefined,
	);
	const failed = result.elements.filter(
		(element) => !element.passed && element.needsReview === undefined,
	);

	if (result.elements.length === 0) {
		return { ...emptyOutput(), inapplicable: [toResult(METADATA, [])] };
	}

	// Losing focus can only hide an indicator, never invent one: failures recorded around the loss
	// may be artefacts, while the passes stay trustworthy.
	const focusWasLost = result.summary.sessionEnd === "lostFocus";
	const violations = focusWasLost ? [] : failed;
	const incomplete = (focusWasLost ? [...failed, ...review] : review).sort(
		(a, b) => a.tabIndex - b.tabIndex,
	);

	const resultFor = (elements: FocusElementResult[], failing: boolean) =>
		elements.length > 0
			? [
					toResult(
						METADATA,
						elements.map((element) => toAuditNode(element, failing)),
					),
				]
			: [];

	return {
		...emptyOutput(),
		violations: resultFor(violations, true),
		incomplete: resultFor(incomplete, true),
		passes: resultFor(passed, false),
	};
}
