/**
 * IMPORTANT: Functions in this file are serialized and injected into the audited page, so they must
 * not reference any symbols outside their own scope.
 */

export type TabRole = "tab" | "tabpanel";

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
	/** Shallow outerHTML. */
	html: string;
};

/**
 * Collect every element whose role is `tab` or `tabpanel` in the main document, hidden ones
 * included, and resolve their `aria-controls` and `aria-labelledby` references. The collected
 * elements are left on `window[stashKey]`, in the same order.
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
	const navigates = (el: Element): boolean => {
		const link = el.closest("a[href]") as HTMLAnchorElement | null;

		if (!link) {
			return false;
		}

		const href = link.getAttribute("href") ?? "";

		if (href.startsWith("#") || /^\s*javascript:/i.test(href)) {
			return false;
		}

		const target = new URL(link.href, document.baseURI);
		const here = new URL(location.href);

		return (
			target.origin !== here.origin ||
			target.pathname !== here.pathname ||
			target.search !== here.search
		);
	};

	const collected = elements.map((el): CollectedTabRole => {
		const controlled = idrefs(el, "aria-controls");

		return {
			role: roleOf(el) as TabRole,
			controls: controlled.map((target) => elements.indexOf(target)).filter((i) => i !== -1),
			hasControls: Boolean(el.getAttribute("aria-controls")?.trim()),
			controlsOther: controlled.some((target) => roleOf(target) !== "tabpanel"),
			labelledBy: idrefs(el, "aria-labelledby")
				.map((target) => elements.indexOf(target))
				.filter((i) => i !== -1),
			navigates: navigates(el),
			html: (el.cloneNode(false) as Element).outerHTML,
		};
	});

	(window as unknown as Record<string, unknown>)[stashKey] = elements;

	return collected;
}
