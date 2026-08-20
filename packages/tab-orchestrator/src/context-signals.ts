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
