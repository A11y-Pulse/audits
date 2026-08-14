/**
 * Context change on focus (WCAG 3.2.1) finding types and classification.
 */

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

/** Raw signals drained from the page observer for one tab stop. */
export type ContextChangeSignals = {
	openedWindow: boolean;
	submittedForm: boolean;
	/** Focus landed on body/null after settle with no further Tab (F55). */
	focusRemoved: boolean;
	/**
	 * Settled activeElement relative to the element that briefly received focus
	 * this stop. `null` when there was no redirection to classify.
	 */
	redirect: "outside" | "same-subtree" | null;
	/**
	 * Soft SPA URL change (hash / pushState / replaceState) while the document
	 * context survived.
	 */
	softUrlChange: boolean;
	/** Full navigation that destroyed the execution context. */
	navigation: boolean;
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

/**
 * Whether focus destination Y is inside the subtree of intended focus X
 * (descendant or ancestor), which is legitimate delegation rather than theft.
 * Walks across open shadow roots so focusing into a host's shadow content is
 * same-subtree, not theft.
 */
export function isSameFocusSubtree(
	intended: Element,
	settled: Element,
): boolean {
	if (intended === settled) {
		return true;
	}

	return (
		composedContains(intended, settled) || composedContains(settled, intended)
	);
}

function composedContains(ancestor: Element, node: Element): boolean {
	let current: Node | null = node;

	while (current) {
		if (current === ancestor) {
			return true;
		}

		const parent: Node | null = current.parentNode;

		if (parent) {
			current = parent;
			continue;
		}

		// Open shadow root: walk up via host. Duck-typed so unit tests work
		// without a DOM ShadowRoot constructor.
		const host: Element | undefined = (current as { host?: Element }).host;

		if (host) {
			current = host;
			continue;
		}

		break;
	}

	return false;
}
