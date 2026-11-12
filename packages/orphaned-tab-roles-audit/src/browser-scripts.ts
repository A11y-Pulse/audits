/**
 * IMPORTANT: Functions in this file are serialized and injected into the audited page, so they must
 * not reference any symbols outside their own scope.
 */

export type TabRole = "tab" | "tabpanel";

export type ControlsTarget = {
	id: string;
	/** An element with this id is in the document. */
	found: boolean;
	/** The target's explicit role, or null when it has none or is not in the document. */
	role: string | null;
	/** The target's lowercase tag name, or null when it is not in the document. */
	tag: string | null;
};

export type CollectedTabRole = {
	role: TabRole;
	/** Indices of the collected elements this element's `aria-controls` resolves to. */
	controls: number[];
	/** `aria-controls` lists at least one id, whether or not it resolves. */
	hasControls: boolean;
	/** `aria-controls` resolves to an element that is not a tab panel. */
	controlsOther: boolean;
	/** Indices of the collected elements this element's `aria-labelledby` resolves to. */
	labelledBy: number[];
	/** A link to another document, so activating it navigates instead of switching panels. */
	navigates: boolean;
	/** Where that link goes, resolved against the page, or null when the element does not navigate. */
	href?: string | null;
	/** `aria-selected="true"`. */
	selected?: boolean;
	/**
	 * Identifies the tablist a tab belongs to: its nearest ancestor with role `tablist`, or the
	 * tablist whose `aria-owns` names it. The number is the tablist's index in the stash, after
	 * every tab and tab panel. Null outside a tablist.
	 */
	tablist?: number | null;
	/** Every id in `aria-controls`, with what it resolves to. */
	controlsTargets?: ControlsTarget[];
	/** Shallow outerHTML. */
	html: string;
};

/**
 * Collect every element whose role is `tab` or `tabpanel` in the main document, hidden ones
 * included, and resolve their `aria-controls` and `aria-labelledby` references. The collected
 * elements are left on `window[stashKey]`, in the same order, followed by the tablists the tabs
 * belong to.
 */
export function collectTabRolesScript(stashKey: string): CollectedTabRole[] {
	const roleOf = (el: Element): string =>
		(el.getAttribute("role") ?? "").trim().split(/\s+/)[0]?.toLowerCase() ?? "";

	const elements = Array.from(document.querySelectorAll("[role]")).filter((el) => {
		const role = roleOf(el);

		return role === "tab" || role === "tabpanel";
	});

	const idrefs = (el: Element, attribute: string): Element[] =>
		(el.getAttribute(attribute) ?? "")
			.split(/\s+/)
			.filter(Boolean)
			.flatMap((id) => {
				const target = document.getElementById(id);

				return target ? [target] : [];
			});

	// Fragment-only and same-document hrefs are how Bootstrap-style tab anchors point at panels.
	const navigationTarget = (el: Element): string | null => {
		const link = el.closest("a[href]") as HTMLAnchorElement | null;

		if (!link) {
			return null;
		}

		const href = link.getAttribute("href") ?? "";

		if (href.startsWith("#") || /^\s*javascript:/i.test(href)) {
			return null;
		}

		const target = new URL(link.href, document.baseURI);
		const here = new URL(location.href);

		return target.origin !== here.origin ||
			target.pathname !== here.pathname ||
			target.search !== here.search
			? target.href
			: null;
	};

	const tablists: Element[] = [];
	const ownedBy = new Map<Element, Element>();

	for (const list of Array.from(document.querySelectorAll("[role][aria-owns]"))) {
		if (roleOf(list) === "tablist") {
			for (const owned of idrefs(list, "aria-owns")) {
				ownedBy.set(owned, list);
			}
		}
	}

	const tablistOf = (el: Element): number | null => {
		let list: Element | null = null;

		for (let node: Element | null = el; node && !list; node = node.parentElement) {
			list = ownedBy.get(node) ?? null;

			if (!list && node !== el && roleOf(node) === "tablist") {
				list = node;
			}
		}

		if (!list) {
			return null;
		}

		if (!tablists.includes(list)) {
			tablists.push(list);
		}

		return elements.length + tablists.indexOf(list);
	};

	const controlsTargets = (el: Element): ControlsTarget[] =>
		(el.getAttribute("aria-controls") ?? "")
			.split(/\s+/)
			.filter(Boolean)
			.map((id) => {
				const target = document.getElementById(id);

				return {
					id,
					found: target !== null,
					role: target ? roleOf(target) || null : null,
					tag: target ? target.tagName.toLowerCase() : null,
				};
			});

	const collected = elements.map((el): CollectedTabRole => {
		const controlled = idrefs(el, "aria-controls");
		const href = navigationTarget(el);
		const role = roleOf(el) as TabRole;

		return {
			role,
			controls: controlled.map((target) => elements.indexOf(target)).filter((i) => i !== -1),
			hasControls: Boolean(el.getAttribute("aria-controls")?.trim()),
			controlsOther: controlled.some((target) => roleOf(target) !== "tabpanel"),
			labelledBy: idrefs(el, "aria-labelledby")
				.map((target) => elements.indexOf(target))
				.filter((i) => i !== -1),
			navigates: href !== null,
			href,
			selected: el.getAttribute("aria-selected") === "true",
			tablist: role === "tab" ? tablistOf(el) : null,
			controlsTargets: controlsTargets(el),
			html: (el.cloneNode(false) as Element).outerHTML,
		};
	});

	(window as unknown as Record<string, unknown>)[stashKey] = [...elements, ...tablists];

	return collected;
}
