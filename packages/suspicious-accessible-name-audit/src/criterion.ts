import type { CollectedElement } from "./browser-scripts";
import type { NameSignal } from "./classify";

/**
 * - `1.1.1`: an icon-only button or link, or an iframe, whose name does not replace what it shows
 *   (failure F30).
 * - `2.4.4`: a link whose name does not give its purpose, with no surrounding text that does.
 * - `2.4.6`: any other control, landmark or dialog whose label does not describe its purpose.
 */
export type WcagCriterion = "1.1.1" | "2.4.4" | "2.4.6";

/**
 * The success criterion a suspicious name on `element` falls under, or null for a role word, which
 * is best practice rather than a WCAG failure.
 */
export function wcagCriterion(
	element: Pick<CollectedElement, "role" | "iconOnly" | "linkContext">,
	signal: NameSignal | null,
): WcagCriterion | null {
	if (signal === "role-word") {
		return null;
	}

	if (element.role === "iframe" || element.iconOnly) {
		return "1.1.1";
	}

	// Surrounding text can give a link its purpose at Level A, leaving only 2.4.6.
	if (element.role === "link" && !element.linkContext) {
		return "2.4.4";
	}

	return "2.4.6";
}
