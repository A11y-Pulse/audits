/**
 * IMPORTANT: Functions in this file that are serialized and injected into the
 * audited page must not reference any symbols outside their own scope. Common
 * logic (fragment parsing, target resolution, shadow-root descent) is therefore
 * duplicated inside each injected function.
 */

/**
 * Return the in-page fragment for a skip-link-like href, or null if the href is
 * not a same-document hash (including the bare `#` and `#top`, which have no
 * element target).
 */
export function parseInPageFragment(href: string | null): string | null {
	if (href === null || href === "") {
		return null;
	}

	if (!href.startsWith("#")) {
		return null;
	}

	if (href === "#" || href === "#top") {
		return null;
	}

	// Hash-router and hashbang paths are not element ids.
	if (href.startsWith("#/") || href.startsWith("#!/")) {
		return null;
	}

	return href;
}

/**
 * Resolve a fragment to an element, preferring `id` then a matching `name`.
 * Serialized and run in the page; must stay self-contained.
 */
export function resolveFragmentTargetScript(fragment: string): Element | null {
	const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
	let decoded = raw;

	try {
		decoded = decodeURIComponent(raw);
	} catch {
		// Keep the raw id when it is not valid percent-encoding.
	}

	return (
		document.getElementById(decoded) ??
		document.getElementsByName(decoded)[0] ??
		null
	);
}

export type SkipLinkActiveElementBase = {
	isBody: boolean;
	html: string;
	/** In-page fragment such as "#main", or null when the focused node is not a skip-link candidate. */
	fragment: string | null;
	targetResolves: boolean;
};

/**
 * Read the currently focused element (descending open shadow roots) and report
 * whether it is a skip-link-like in-page fragment anchor.
 */
export function probeActiveElementScript(): SkipLinkActiveElementBase {
	let el = document.activeElement;

	while (el?.shadowRoot?.activeElement) {
		el = el.shadowRoot.activeElement;
	}

	if (!el || el === document.body) {
		return {
			isBody: true,
			html: "",
			fragment: null,
			targetResolves: false,
		};
	}

	const openingTag = (el.cloneNode(false) as Element).outerHTML;
	const href =
		el.tagName === "A" ? (el as HTMLAnchorElement).getAttribute("href") : null;

	let fragment: string | null = null;

	if (
		href?.startsWith("#") &&
		href !== "#" &&
		href !== "#top" &&
		!href.startsWith("#/") &&
		!href.startsWith("#!/")
	) {
		fragment = href;
	}

	let targetResolves = false;

	if (fragment) {
		const raw = fragment.slice(1);
		let decoded = raw;

		try {
			decoded = decodeURIComponent(raw);
		} catch {
			// Keep the raw id when it is not valid percent-encoding.
		}

		targetResolves = Boolean(
			document.getElementById(decoded) ??
				document.getElementsByName(decoded)[0],
		);
	}

	return {
		isBody: false,
		html: openingTag,
		fragment,
		targetResolves,
	};
}

/**
 * Return the focused element, descending open shadow roots.
 */
export function activeElementHandleScript(): Element | null {
	let el = document.activeElement;

	while (el?.shadowRoot?.activeElement) {
		el = el.shadowRoot.activeElement;
	}

	return el;
}

/**
 * Whether document.activeElement is the fragment target or inside it.
 */
export function isFocusInsideTargetScript(fragment: string): boolean {
	const raw = fragment.startsWith("#") ? fragment.slice(1) : fragment;
	let decoded = raw;

	try {
		decoded = decodeURIComponent(raw);
	} catch {
		// Keep the raw id when it is not valid percent-encoding.
	}

	const target =
		document.getElementById(decoded) ??
		document.getElementsByName(decoded)[0] ??
		null;

	if (!target) {
		return false;
	}

	let el = document.activeElement;

	while (el?.shadowRoot?.activeElement) {
		el = el.shadowRoot.activeElement;
	}

	if (!el) {
		return false;
	}

	return el === target || target.contains(el);
}

/**
 * Focus an element.
 */
export function focusScript(el: Element | null): void {
	(el as HTMLElement | null)?.focus();
}
