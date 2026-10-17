import type { KeyboardTrapResult } from "@a11y-pulse/keyboard-trap-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	toResult,
} from "./audit-output";

export const KEYBOARD_TRAP_AUDIT_ID = "keyboard-trap";

const METADATA: AuditMetadata = {
	id: KEYBOARD_TRAP_AUDIT_ID,
	help: "Keyboard focus must be able to leave every component it can enter",
	description:
		"Ensures that keyboard focus is not confined to part of the page with no standard way out, as required by WCAG 2.1.2 No Keyboard Trap.",
	helpUrl: "https://github.com/A11y-Pulse/audits/tree/main/packages/keyboard-trap-audit#readme",
	impact: "serious",
	tags: ["wcag2a", "wcag212", "cat.keyboard"],
};

function failureSummary(result: KeyboardTrapResult): string {
	const rounds = result.roundsAttempted === 1 ? "1 attempt" : `${result.roundsAttempted} attempts`;

	return `Focus cycled within ${result.ringSize} element(s) and did not leave via Tab, Shift+Tab, Escape or arrow keys across ${rounds}, leaving ${result.excludedCount} other focusable element(s) unreachable. Enter and Space were not tried, so a close button may still free it. If the component tells users how to move focus away with another key it may conform; otherwise ensure focus can leave it using standard keys.`;
}

export function keyboardTrapToAxe(result: KeyboardTrapResult): AuditOutput {
	switch (result.outcome) {
		case "no-focusable":
			return { ...emptyOutput(), inapplicable: [toResult(METADATA, [])] };

		case "inconclusive":
			return emptyOutput();

		case "trapped": {
			const container = result.container;
			const nodes: AuditNode[] = container
				? [{ ...container, failureSummary: failureSummary(result) }]
				: [];

			return { ...emptyOutput(), incomplete: [toResult(METADATA, nodes)] };
		}

		default:
			return {
				...emptyOutput(),
				passes: [toResult(METADATA, result.container ? [result.container] : [])],
			};
	}
}
