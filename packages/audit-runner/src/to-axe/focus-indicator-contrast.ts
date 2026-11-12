import {
	type FocusAppearanceResult,
	type FocusElementResult,
	hasLowContrastIndicator,
	type IndicatorContrast,
	MIN_INDICATOR_CONTRAST,
} from "@a11y-pulse/focus-appearance-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	evidenceCheck,
	toResult,
} from "./audit-output";

export const FOCUS_INDICATOR_CONTRAST_AUDIT_ID = "focus-indicator-contrast";

export const FOCUS_INDICATOR_CONTRAST_EVIDENCE_CHECK_ID = "focus-indicator-contrast-evidence";

const METADATA: AuditMetadata = {
	id: FOCUS_INDICATOR_CONTRAST_AUDIT_ID,
	help: "Focus indicators must have sufficient contrast",
	description:
		"Ensures that a focus indicator (an outline, border, box-shadow or background fill) has a contrast ratio of at least 3:1 against the colors next to it, as required by WCAG 1.4.11 Non-text Contrast. How much the indicator differs from the unfocused state is not judged here.",
	helpUrl:
		"https://github.com/A11y-Pulse/audits/tree/main/packages/focus-appearance-audit#focus-indicator-contrast",
	impact: "serious",
	tags: ["wcag2aa", "wcag21aa", "wcag1411", "cat.color"],
};

type MeasuredElement = FocusElementResult & { indicatorContrast: IndicatorContrast };

function formatRatio(ratio: number): string {
	return (Math.floor(ratio * 100) / 100).toFixed(2);
}

const PART_NAMES: Record<NonNullable<IndicatorContrast["property"]>, string> = {
	outline: "outline",
	border: "border",
	"box-shadow": "box-shadow",
	"background-color": "background color",
};

const AGAINST: Record<NonNullable<IndicatorContrast["comparedAgainst"]>, string> = {
	surroundings: "the background around the element",
	"own-background": "the element's own background",
	"adjacent-pixels": "the color next to it",
};

const REASONS: Record<NonNullable<IndicatorContrast["reason"]>, string> = {
	translucent: "its color is translucent or a soft glow",
	"background-image": "it is drawn over the element's background image or gradient",
	"background-unresolved":
		"a background image, gradient or translucent color is behind the element, or the element is positioned over other content",
	"too-small": "too few pixels change on focus to take a color from",
	noisy: "the area that changes, or what is next to it, has no single color",
	transitioning: "it was still animating in when it was measured",
};

function indicatorName(contrast: IndicatorContrast): string {
	return contrast.property ? `focus ${PART_NAMES[contrast.property]}` : "focus indicator";
}

function failureSummary({ indicatorContrast: contrast, tabIndex }: MeasuredElement): string {
	const name = indicatorName(contrast);

	if (contrast.ratio === null) {
		const why = contrast.reason ? REASONS[contrast.reason] : "its colors could not be read";

		return `The contrast of the ${name} could not be measured because ${why} (tab stop #${tabIndex}). Check that it has a contrast ratio of at least 3:1 against the colors next to it.`;
	}

	const colors =
		contrast.indicatorColor && contrast.adjacentColor
			? ` (${contrast.indicatorColor} on ${contrast.adjacentColor})`
			: "";
	const against = contrast.comparedAgainst ? ` against ${AGAINST[contrast.comparedAgainst]}` : "";

	return `The ${name} has a contrast ratio of ${formatRatio(contrast.ratio)}:1${against}${colors} (tab stop #${tabIndex}). Use an indicator color with a contrast ratio of at least 3:1.`;
}

function toAuditNode(element: MeasuredElement, failed: boolean): AuditNode {
	const node: AuditNode = { selector: element.selector, html: element.html };

	if (failed) {
		node.failureSummary = failureSummary(element);
	}

	const { evidence, ...contrast } = element.indicatorContrast;
	const name = indicatorName(element.indicatorContrast);

	// The screenshots of `evidence` sit at the top level of `data`, as they do for `focus-color-only`.
	node.evidence = evidenceCheck(
		FOCUS_INDICATOR_CONTRAST_EVIDENCE_CHECK_ID,
		"serious",
		contrast.ratio === null
			? `The contrast of the ${name} could not be measured`
			: `The ${name} has a contrast ratio of ${formatRatio(contrast.ratio)}:1`,
		{ tabIndex: element.tabIndex, ...contrast, ...evidence },
	);

	return node;
}

function resultFor(elements: readonly MeasuredElement[], failed: boolean) {
	return elements.length > 0
		? [
				toResult(
					METADATA,
					elements.map((element) => toAuditNode(element, failed)),
				),
			]
		: [];
}

/**
 * Report the contrast of each measured focus indicator: under 3:1 is a violation, an indicator
 * whose contrast could not be determined is incomplete, and the rest pass.
 *
 * An element whose only focus change is one color is left to `focus-color-only` when that audit
 * could measure the change, so that it is not reported twice. When it could not, the element is
 * reported here: a measurable contrast is never dropped.
 */
export function focusIndicatorContrastToAxe(result: FocusAppearanceResult): AuditOutput {
	const measured = result.elements.filter(
		(element): element is MeasuredElement =>
			element.indicatorContrast !== undefined &&
			(element.colorOnly === undefined || element.colorOnly.contrastRatio === null),
	);
	const ratioOf = (element: MeasuredElement) => element.indicatorContrast.ratio;

	return {
		...emptyOutput(),
		// The same test `summary.lowContrastIndicators` counts with, so the two always agree.
		violations: resultFor(measured.filter(hasLowContrastIndicator), true),
		incomplete: resultFor(
			measured.filter((element) => ratioOf(element) === null),
			true,
		),
		passes: resultFor(
			measured.filter((element) => {
				const ratio = ratioOf(element);

				return ratio !== null && ratio >= MIN_INDICATOR_CONTRAST;
			}),
			false,
		),
	};
}
