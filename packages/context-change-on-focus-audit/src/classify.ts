/**
 * Context change on focus (WCAG 3.2.1) finding types and classification.
 */

export type { ContextChangeSignals } from "@a11y-pulse/tab-orchestrator";

import type { ContextChangeSignals } from "@a11y-pulse/tab-orchestrator";

export type ContextChangeKind =
	| "new-window"
	| "auto-submit"
	| "focus-removed"
	| "focus-redirected-outside"
	| "focus-redirected-same-subtree"
	| "url-changed"
	| "navigation";

export type ContextChangeBucket = "violation" | "incomplete";

export type ContextChangeFinding = {
	kind: ContextChangeKind;
	bucket: ContextChangeBucket;
};

export function classifyContextSignals(
	signals: ContextChangeSignals,
): ContextChangeFinding[] {
	const findings: ContextChangeFinding[] = [];

	if (signals.openedWindow) {
		findings.push({ kind: "new-window", bucket: "violation" });
	}

	if (signals.submittedForm) {
		findings.push({ kind: "auto-submit", bucket: "violation" });
	}

	if (signals.focusRemoved) {
		findings.push({ kind: "focus-removed", bucket: "violation" });
	}

	if (signals.redirect === "outside") {
		findings.push({ kind: "focus-redirected-outside", bucket: "violation" });
	} else if (signals.redirect === "same-subtree") {
		findings.push({
			kind: "focus-redirected-same-subtree",
			bucket: "incomplete",
		});
	}

	if (signals.navigation) {
		findings.push({ kind: "navigation", bucket: "violation" });
	} else if (signals.softUrlChange) {
		findings.push({ kind: "url-changed", bucket: "incomplete" });
	}

	return findings;
}
