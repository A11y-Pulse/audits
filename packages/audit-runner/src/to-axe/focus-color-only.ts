import type {
	ColorOnlyChange,
	FocusAppearanceResult,
	FocusElementResult,
} from "@a11y-pulse/focus-appearance-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	toResult,
} from "./audit-output";

export const FOCUS_COLOR_ONLY_AUDIT_ID = "focus-color-only";

// WCAG 1.4.1 Understanding: colours whose luminance differs by 3:1 are distinguishable by lightness,
// not by colour alone.
const MIN_LIGHTNESS_CONTRAST = 3;

const METADATA: AuditMetadata = {
	id: FOCUS_COLOR_ONLY_AUDIT_ID,
	help: "Focus must not be shown by a change of text color alone",
	description:
		"Ensures that elements whose only focus indicator is a change of text color use colors that differ in lightness by at least 3:1, as required by WCAG 1.4.1 Use of Color.",
	helpUrl:
		"https://github.com/A11y-Pulse/audits/tree/main/packages/focus-appearance-audit#colour-only-focus-indicators",
	impact: "serious",
	tags: ["wcag2a", "wcag141", "cat.color"],
};

type ColorOnlyElement = FocusElementResult & { colorOnly: ColorOnlyChange };

function formatRatio(ratio: number): string {
	return (Math.floor(ratio * 100) / 100).toFixed(2);
}

function failureSummary({ colorOnly, tabIndex }: ColorOnlyElement): string {
	const change = `Focus is shown only by the text color changing from ${colorOnly.unfocusedColor} to ${colorOnly.focusedColor}`;

	if (colorOnly.contrastRatio === null) {
		return `${change}, and the contrast between the two colors could not be measured (tab stop #${tabIndex}). Check that the colors differ in lightness by at least 3:1, or add a focus indicator that does not rely on color, such as an outline or underline.`;
	}

	return `${change}, a contrast ratio of ${formatRatio(colorOnly.contrastRatio)}:1 (tab stop #${tabIndex}). Add a focus indicator that does not rely on color, such as an outline or underline, or use colors that differ in lightness by at least 3:1.`;
}

function toAuditNode(element: ColorOnlyElement, failed: boolean): AuditNode {
	const node: AuditNode = { selector: element.selector, html: element.html };

	if (failed) {
		node.failureSummary = failureSummary(element);
	}

	return node;
}

function resultFor(elements: readonly ColorOnlyElement[], failed: boolean) {
	return elements.length > 0
		? [
				toResult(
					METADATA,
					elements.map((element) => toAuditNode(element, failed)),
				),
			]
		: [];
}

export function focusColorOnlyToAxe(result: FocusAppearanceResult): AuditOutput {
	const measured = result.elements.filter(
		(element): element is ColorOnlyElement => element.colorOnly !== undefined,
	);
	const unmeasurable = measured.filter((element) => element.colorOnly.contrastRatio === null);
	const failed = measured.filter(
		(element) =>
			element.colorOnly.contrastRatio !== null &&
			element.colorOnly.contrastRatio < MIN_LIGHTNESS_CONTRAST,
	);
	const passed = measured.filter(
		(element) =>
			element.colorOnly.contrastRatio !== null &&
			element.colorOnly.contrastRatio >= MIN_LIGHTNESS_CONTRAST,
	);

	return {
		...emptyOutput(),
		violations: resultFor(failed, true),
		incomplete: resultFor(unmeasurable, true),
		passes: resultFor(passed, false),
	};
}
