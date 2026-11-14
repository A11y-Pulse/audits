/**
 * Context change on focus (WCAG 3.2.1) finding types and classification.
 */

export type { ContextChangeDetails, ContextChangeSignals } from "@a11y-pulse/tab-orchestrator";

import type { ContextChangeDetails, ContextChangeSignals } from "@a11y-pulse/tab-orchestrator";

export type ContextChangeKind =
	| "new-window"
	| "auto-submit"
	| "focus-removed"
	| "focus-redirected-outside"
	| "focus-redirected-same-subtree"
	| "url-changed"
	| "navigation"
	| "dialog";

export type ContextChangeBucket = "violation" | "incomplete";

export type ContextChangeFinding = {
	kind: ContextChangeKind;
	bucket: ContextChangeBucket;

	/**
	 * `new-window`: the URL passed to `window.open` (empty when none was). `navigation`: where the
	 * page tried to go, when the attempt was caught before the document was lost.
	 */
	url?: string;

	/** `url-changed`: the address before and after. */
	from?: string;
	to?: string;

	/** `auto-submit`: the form that was submitted. `selector` is `null` if it could not be resolved. */
	form?: { selector: string | null; html: string; action: string };

	/** `focus-redirected-*`: where focus ended up. The element result is the one that gave it away. */
	redirectedTo?: { selector: string; html: string };

	/**
	 * The change came from a short timer the element set when focused, and happened after focus had
	 * moved on to a later tab stop.
	 */
	delayed?: boolean;
};

export function classifyContextSignals(
	signals: ContextChangeSignals,
	details: ContextChangeDetails = {},
): ContextChangeFinding[] {
	const findings: ContextChangeFinding[] = [];

	if (signals.openedWindow) {
		const finding: ContextChangeFinding = { kind: "new-window", bucket: "violation" };

		if (details.openedWindowUrl !== undefined) {
			finding.url = details.openedWindowUrl;
		}

		findings.push(finding);
	}

	if (signals.submittedForm) {
		const finding: ContextChangeFinding = { kind: "auto-submit", bucket: "violation" };

		if (details.submittedForm) {
			finding.form = details.submittedForm;
		}

		findings.push(finding);
	}

	if (signals.openedDialog) {
		findings.push({ kind: "dialog", bucket: "violation" });
	}

	if (signals.focusRemoved) {
		findings.push({ kind: "focus-removed", bucket: "violation" });
	}

	// A focus guard passing focus on (`signals.focusGuard`) is how dialogs keep focus inside
	// themselves, not a control losing its focus, and the orchestrator reports no redirect for it.
	if (signals.redirect === "outside") {
		findings.push({ kind: "focus-redirected-outside", bucket: "violation" });
	} else if (signals.redirect === "same-subtree") {
		findings.push({
			kind: "focus-redirected-same-subtree",
			bucket: "incomplete",
		});
	}

	if (signals.navigation || signals.navigationPrevented) {
		const finding: ContextChangeFinding = { kind: "navigation", bucket: "violation" };

		if (details.navigationUrl !== undefined) {
			finding.url = details.navigationUrl;
		}

		findings.push(finding);
	}

	// A soft URL change is reported beside a navigation attempt only if it is its own event; the
	// attempt itself changes no URL once cancelled.
	if (signals.softUrlChange && !signals.navigation) {
		const finding: ContextChangeFinding = { kind: "url-changed", bucket: "incomplete" };

		if (details.urlChange) {
			finding.from = details.urlChange.from;
			finding.to = details.urlChange.to;
		}

		findings.push(finding);
	}

	return findings;
}
