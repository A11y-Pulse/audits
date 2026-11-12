import type { EscapeKey, KeyboardTrapResult } from "@a11y-pulse/keyboard-trap-audit";
import {
	type AuditMetadata,
	type AuditNode,
	type AuditOutput,
	emptyOutput,
	evidenceCheck,
	inconclusiveOutput,
	toResult,
} from "./audit-output";

export const KEYBOARD_TRAP_AUDIT_ID = "keyboard-trap";

export const KEYBOARD_TRAP_EVIDENCE_CHECK_ID = "keyboard-trap-evidence";

const METADATA: AuditMetadata = {
	id: KEYBOARD_TRAP_AUDIT_ID,
	help: "Keyboard focus must be able to leave every component it can enter",
	description:
		"Ensures that keyboard focus is not confined to part of the page with no standard way out, as required by WCAG 2.1.2 No Keyboard Trap.",
	helpUrl: "https://github.com/A11y-Pulse/audits/tree/main/packages/keyboard-trap-audit#readme",
	impact: "serious",
	tags: ["wcag2a", "wcag212", "cat.keyboard"],
};

const KEY_NAMES: Array<[name: string, keys: EscapeKey[]]> = [
	["Tab", ["Tab"]],
	["Shift+Tab", ["Shift+Tab"]],
	["Escape", ["Escape"]],
	["arrow keys", ["ArrowDown", "ArrowRight"]],
];

/** The keys the audit pressed, as prose: "Tab, Shift+Tab or Escape". */
function keysTried(result: KeyboardTrapResult): string {
	const names = KEY_NAMES.filter(([, keys]) =>
		keys.some((key) => result.keysTried.includes(key)),
	).map(([name]) => name);

	if (names.length < 2) {
		return names[0] ?? "the keys tried";
	}

	return `${names.slice(0, -1).join(", ")} or ${names.at(-1)}`;
}

function dialogNote(result: KeyboardTrapResult): string {
	if (!result.dialog) {
		return "Enter and Space were not tried, so a close button may still free it.";
	}

	const { buttons } = result.dialog;

	if (buttons === 0) {
		return "The component is a dialog with no button to close it.";
	}

	return `The component is a dialog with ${buttons} button(s) or link(s), which were not activated, so one of them may still close it.`;
}

function failureSummary(result: KeyboardTrapResult): string {
	const rounds = result.roundsAttempted === 1 ? "1 attempt" : `${result.roundsAttempted} attempts`;

	return `Focus cycled within ${result.ringSize} element(s) and did not leave via ${keysTried(result)} across ${rounds}, leaving ${result.excludedCount} other focusable element(s) unreachable. ${dialogNote(result)} If the component tells users how to move focus away with another key it may conform; otherwise ensure focus can leave it using standard keys.`;
}

function reviewSummary(result: KeyboardTrapResult): string | null {
	switch (result.inconclusiveReason) {
		case "stuck-in-frame":
			return "Keyboard focus went into this frame and did not come back out, so the rest of the page was not reached. The frame's content could not be inspected: check that Tab and Shift+Tab can leave it.";

		case "page-edge-only":
			return `Focus cycled within ${result.ringSize} element(s). The only way out found was past the edge of the page to the browser's own interface, and the page pulled focus back when it came in again from the other end, leaving ${result.excludedCount} other focusable element(s) unreachable. Check that the rest of the page can be reached with the keyboard.`;

		case "ring-sampled": {
			const rounds =
				result.roundsAttempted === 1 ? "1 attempt" : `${result.roundsAttempted} attempts`;

			return `Focus cycled within ${result.ringSize} element(s) and did not leave via ${keysTried(result)} across ${rounds}, leaving ${result.excludedCount} other focusable element(s) unreachable. The cycle was too large to test in full: Tab and Shift+Tab were pressed only from the elements either side of where it wraps round, so a way out from an element in the middle of it was not tried. ${dialogNote(result)} Check that focus can leave the component using standard keys.`;
		}

		default:
			return null;
	}
}

const INCONCLUSIVE_REASONS: Record<
	NonNullable<KeyboardTrapResult["inconclusiveReason"]>,
	string
> = {
	"stuck-in-frame": "keyboard focus went into a frame and did not come back out.",
	"page-edge-only": "the only way out of a focus cycle was past the edge of the page.",
	"ring-sampled":
		"focus cycled through too many elements to try the standard keys from every one of them.",
	"session-ended": "the keyboard pass ended before the whole page had been tabbed through.",
	"element-limit": "the page has more tab stops than the audit's limit.",
	"timed-out": "the audit ran out of time.",
	"ring-unresolved": "the elements focus cycled through could not be found again.",
	"scattered-ring": "the elements focus cycled through share no containing component.",
	"ring-changed": "the page changed the elements focus cycled through while they were tested.",
	navigated: "the page navigated while the audit was pressing keys.",
};

const EVIDENCE_MESSAGES: Record<KeyboardTrapResult["outcome"], string> = {
	trapped: "Keys pressed to try to leave the component, and where focus went",
	inconclusive: "Keys pressed before the audit stopped, and where focus went",
	escaped: "Focus cycled here but left the component with a standard key",
	"small-ring": "Focus cycled through a small set of elements that leaves nothing out of reach",
	"no-cycle": "Focus did not cycle",
	"no-focusable": "No focusable elements",
};

/** Everything the audit recorded about the focus cycle, attached to its container. */
function containerNode(result: KeyboardTrapResult, failureSummary?: string): AuditNode[] {
	if (!result.container) {
		return [];
	}

	const node: AuditNode = {
		...result.container,
		evidence: evidenceCheck(
			KEYBOARD_TRAP_EVIDENCE_CHECK_ID,
			"serious",
			EVIDENCE_MESSAGES[result.outcome],
			{
				outcome: result.outcome,
				inconclusiveReason: result.inconclusiveReason ?? undefined,
				ring: result.ring,
				ringSize: result.ringSize,
				sampledRing: result.sampledRing,
				excludedCount: result.excludedCount,
				escapedVia: result.escapedVia,
				roundsAttempted: result.roundsAttempted,
				keysTried: result.keysTried,
				attempts: result.attempts,
				dialog: result.dialog,
			},
		),
	};

	if (failureSummary !== undefined) {
		node.failureSummary = failureSummary;
	}

	return [node];
}

export function keyboardTrapToAxe(result: KeyboardTrapResult): AuditOutput {
	switch (result.outcome) {
		case "no-focusable":
			return { ...emptyOutput(), inapplicable: [toResult(METADATA, [])] };

		case "inconclusive": {
			const summary = reviewSummary(result);

			if (!summary || !result.container) {
				return inconclusiveOutput(
					METADATA,
					result.inconclusiveReason
						? INCONCLUSIVE_REASONS[result.inconclusiveReason]
						: "the keyboard pass did not finish.",
				);
			}

			return {
				...emptyOutput(),
				incomplete: [toResult(METADATA, containerNode(result, summary))],
			};
		}

		case "trapped": {
			return {
				...emptyOutput(),
				incomplete: [toResult(METADATA, containerNode(result, failureSummary(result)))],
			};
		}

		default:
			return {
				...emptyOutput(),
				passes: [toResult(METADATA, containerNode(result))],
			};
	}
}
