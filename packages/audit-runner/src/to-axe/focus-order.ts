import type {
	FocusOrderElement,
	FocusOrderResult,
	FocusOrderTransition,
} from "@a11y-pulse/focus-order-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	evidenceCheck,
	inconclusiveOutput,
	toResult,
} from "./audit-output";

export const FOCUS_ORDER_AUDIT_ID = "focus-order";

export const FOCUS_ORDER_EVIDENCE_CHECK_ID = "focus-order-evidence";

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

const BACKWARDS: Record<FocusOrderTransition["direction"], string> = {
	up: "back up the page",
	down: "back down the page",
	left: "back towards the left of the page",
	right: "back towards the right of the page",
};

function failureSummary(
	transition: FocusOrderTransition,
	total: number,
	positiveTabindex: boolean,
): string {
	const { from, to } = transition;
	// Backwards is up the page only where lines run across it: on a vertical page it is sideways.
	const back = BACKWARDS[transition.direction];
	const movements: Record<FocusOrderTransition["kind"], string> = {
		"backwards-jump": `a long way ${back}`,
		"backwards-drift": `steadily ${back}, one element at a time,`,
		"column-thrash": "across to a distant column and back",
	};
	const movement = movements[transition.kind];
	const own = [from, to].find((element) => element.positiveTabindex !== undefined);
	let cause = "";

	if (own) {
		cause = ` \`${own.selector}\` has tabindex="${own.positiveTabindex}", which takes it out of the source order; see the tabindex result.`;
	} else if (positiveTabindex) {
		cause = " The page uses positive tabindex values, a common cause; see the tabindex result.";
	}

	const count = total > 1 ? `, one of ${total} such moves on this page` : "";

	return `Focus moved from this element ${movement} to \`${to.selector}\` (tab stops ${from.tabIndex} → ${to.tabIndex})${count}.${cause} Check that the focus order preserves meaning and operability; if it does not, make the source order match the reading order.`;
}

const SESSION_ENDS: Record<NonNullable<FocusOrderResult["summary"]["sessionEnd"]>, string> = {
	completed: "the keyboard pass did not visit enough of the page to judge its order.",
	lostFocus: "the page lost keyboard focus part of the way through.",
	navigation: "the page navigated away part of the way through the keyboard pass.",
	failed: "the keyboard pass failed part of the way through.",
	stuck: "keyboard focus got stuck part of the way through the page.",
	limit: "the keyboard pass reached its limit before the whole page had been tabbed through.",
};

/** One end of a transition, without the HTML the node already carries. */
function endpoint(element: FocusOrderElement): Record<string, unknown> {
	return {
		selector: element.selector,
		tabIndex: element.tabIndex,
		rect: element.rect,
		...(element.positiveTabindex === undefined
			? {}
			: { positiveTabindex: element.positiveTabindex }),
	};
}

export function focusOrderToAxe(result: FocusOrderResult): AuditOutput {
	if (result.outcome === "no-focusable") {
		return { ...emptyOutput(), inapplicable: [toResult(METADATA, [])] };
	}

	if (result.outcome === "inconclusive") {
		return inconclusiveOutput(METADATA, SESSION_ENDS[result.summary.sessionEnd ?? "completed"]);
	}

	// Geometry cannot show that an order preserves meaning, so an unremarkable page is never a pass.
	// Its absence still means the audit ran: an audit that could not is reported above.
	if (result.outcome === "unremarkable") {
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
				evidence: evidenceCheck(
					FOCUS_ORDER_EVIDENCE_CHECK_ID,
					"moderate",
					"Where focus moved from and to, in CSS pixels relative to the document",
					{
						kind: transition.kind,
						direction: transition.direction,
						distance: transition.distance,
						steps: transition.steps,
						from: endpoint(transition.from),
						to: endpoint(transition.to),
						totalTransitions: result.transitions.length,
					},
				),
			});
		}
	}

	return { ...emptyOutput(), incomplete: [toResult(METADATA, nodes)] };
}
