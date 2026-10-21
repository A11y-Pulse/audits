import type { FocusOrderResult, FocusOrderTransition } from "@a11y-pulse/focus-order-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	toResult,
} from "./audit-output";

export const FOCUS_ORDER_AUDIT_ID = "focus-order";

// Each offending transition is one node, and a scrambled page can produce dozens.
const NODE_LIMIT = 10;

const METADATA: AuditMetadata = {
	id: FOCUS_ORDER_AUDIT_ID,
	help: "Focus should not repeatedly jump a long way against the reading order",
	description:
		"Flags pages where keyboard focus repeatedly jumps a long way against the reading order, a sign that the focus order may not preserve meaning and operability (WCAG 2.4.3 Focus Order).",
	helpUrl: "https://github.com/A11y-Pulse/audits/tree/main/packages/focus-order-audit#readme",
	impact: "moderate",
	tags: ["wcag2a", "wcag243", "cat.keyboard"],
};

function failureSummary(
	transition: FocusOrderTransition,
	total: number,
	positiveTabindex: boolean,
): string {
	const { from, to } = transition;
	const movement =
		transition.kind === "column-thrash"
			? "across to a distant column and back"
			: "a long way back up the page";
	const cause = positiveTabindex
		? " The page uses positive tabindex values, a common cause; see the tabindex result."
		: "";

	return `Focus moved from this element ${movement} to \`${to.selector}\` (tab stops ${from.tabIndex} → ${to.tabIndex}), one of ${total} such moves on this page.${cause} Check that the focus order preserves meaning and operability; if it does not, make the source order match the reading order.`;
}

export function focusOrderToAxe(result: FocusOrderResult): AuditOutput {
	if (result.outcome !== "disordered") {
		return emptyOutput();
	}

	const nodes: AuditNode[] = [];

	for (const transition of result.transitions) {
		if (nodes.length === NODE_LIMIT) {
			break;
		}

		if (!nodes.some((node) => node.selector === transition.from.selector)) {
			nodes.push({
				selector: transition.from.selector,
				html: transition.from.html,
				failureSummary: failureSummary(
					transition,
					result.transitions.length,
					result.positiveTabindex,
				),
			});
		}
	}

	return { ...emptyOutput(), incomplete: [toResult(METADATA, nodes)] };
}
