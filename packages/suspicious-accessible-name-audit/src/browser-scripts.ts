/**
 * IMPORTANT: Functions in this file are serialized and injected into the audited page, so they must
 * not reference any symbols outside their own scope.
 */

/**
 * Where the accessible name came from, in the order the name computation tries them. `content` is
 * the element's own rendered text; `aria-labelledby` and `label` are text from other elements.
 */
export type NameSource =
	| "aria-labelledby"
	| "aria-label"
	| "label"
	| "value"
	| "content"
	| "title"
	| "placeholder";

/** A code value on the element that its name can be compared against. */
export type Identifier = {
	/** `id`, `class`, `name` or a `data-*` attribute name. */
	attribute: string;
	value: string;
};

export type CollectedElement = {
	/** Whitespace-collapsed. */
	name: string;
	/** The name was longer than the collection limit and has been cut short. */
	truncated: boolean;
	source: NameSource;
	/** The computed role, or `iframe` for an `<iframe>`. */
	role: string;
	/** The nearest `lang` attribute, or null when nothing declares one. */
	lang: string | null;
	identifiers: Identifier[];
	/** The host a link's `href` points at, for a link. */
	hrefHost?: string | null;
	/** A button or link with no visible letters or digits, such as one showing only an icon. */
	iconOnly: boolean;
	/** A link with other text in its paragraph, list item or table cell, or an `aria-describedby`. */
	linkContext: boolean;
	/** Shallow outerHTML. */
	html: string;
	/**
	 * Where the first `<label>` or `aria-labelledby` target the name was read from sits in the
	 * stashed array, for `label` and `aria-labelledby` sources.
	 */
	labelIndex?: number | null;
};

export type NamedElementCollection = {
	elements: CollectedElement[];
	/**
	 * Every named element. Those past the collection limit are counted from their attributes and
	 * text alone, without the full name computation.
	 */
	total: number;
};

/**
 * Collect every rendered button, link, form field, labelled landmark, dialog and iframe that has
 * an accessible name, descending open shadow roots. The collected elements are left on
 * `window[stashKey]`, in the same order, followed by the labelling elements `labelIndex` points at.
 */
export function collectNamedElementsScript(
	stashKey: string,
	elementLimit: number,
	textLimit: number,
): NamedElementCollection {
	const WIDGET_ROLES = new Set([
		"button",
		"link",
		"textbox",
		"searchbox",
		"combobox",
		"listbox",
		"checkbox",
		"radio",
		"switch",
		"slider",
		"spinbutton",
		"tab",
		"menuitem",
		"menuitemcheckbox",
		"menuitemradio",
	]);
	// Only named by `aria-label` or `aria-labelledby`; an unlabelled landmark has no name to check.
	const LABELLED_ROLES = new Set([
		"dialog",
		"alertdialog",
		"navigation",
		"complementary",
		"region",
		"form",
		"search",
		"main",
		"banner",
		"contentinfo",
	]);
	const NAME_FROM_CONTENT = new Set([
		"button",
		"link",
		"checkbox",
		"radio",
		"switch",
		"tab",
		"menuitem",
		"menuitemcheckbox",
		"menuitemradio",
	]);
	const TEXT_INPUT_TYPES = new Set(["", "text", "email", "tel", "url", "password"]);
	const BUTTON_INPUT_TYPES = new Set(["button", "submit", "reset"]);
	const LANDMARK_TAGS: Record<string, string> = {
		nav: "navigation",
		aside: "complementary",
		main: "main",
		form: "form",
		section: "region",
		search: "search",
	};

	const elements: Element[] = [];
	const labellers: Element[] = [];
	const labellerOf: (Element | null)[] = [];
	const collected: CollectedElement[] = [];
	let total = 0;
	// The element nameOf last read content from, so the icon-only check does not read it again.
	let contentCache: { el: Element; text: string } | null = null;
	// The first element the name being computed was read from.
	let labeller: Element | null = null;

	const isRendered = (el: Element): boolean =>
		typeof el.checkVisibility === "function"
			? el.checkVisibility({ visibilityProperty: true })
			: el.getClientRects().length > 0;

	const isHidden = (el: Element): boolean =>
		el.getAttribute("aria-hidden") === "true" || !isRendered(el);

	const collapse = (text: string): string => text.replace(/\s+/g, " ").trim();

	const implicitRole = (el: Element): string | null => {
		const tag = el.localName;

		if (tag === "a" || tag === "area") {
			return el.hasAttribute("href") ? "link" : null;
		}

		if (tag === "button") {
			return "button";
		}

		if (el instanceof HTMLInputElement) {
			const type = el.type.toLowerCase();

			if (BUTTON_INPUT_TYPES.has(type)) {
				return "button";
			}

			if (TEXT_INPUT_TYPES.has(type)) {
				return "textbox";
			}

			const inputRoles: Record<string, string> = {
				checkbox: "checkbox",
				radio: "radio",
				range: "slider",
				number: "spinbutton",
				search: "searchbox",
			};

			return inputRoles[type] ?? null;
		}

		if (el instanceof HTMLSelectElement) {
			return el.multiple || el.size > 1 ? "listbox" : "combobox";
		}

		if (tag === "textarea") {
			return "textbox";
		}

		if (tag === "iframe") {
			return "iframe";
		}

		if (tag === "dialog") {
			return "dialog";
		}

		// Headers and footers are only landmarks outside sectioning content.
		if (tag === "header" || tag === "footer") {
			return el.parentElement?.closest("article, aside, main, nav, section")
				? null
				: tag === "header"
					? "banner"
					: "contentinfo";
		}

		return LANDMARK_TAGS[tag] ?? null;
	};

	const roleOf = (el: Element): string | null => {
		const explicit = el.getAttribute("role")?.trim().split(/\s+/)[0]?.toLowerCase();

		if (explicit) {
			return WIDGET_ROLES.has(explicit) || LABELLED_ROLES.has(explicit) ? explicit : null;
		}

		return implicitRole(el);
	};

	const textOf = (node: Node, skipHidden: boolean): string => {
		if (node.nodeType === Node.TEXT_NODE) {
			return (node as Text).data;
		}

		if (!(node instanceof Element) || (skipHidden && isHidden(node))) {
			return "";
		}

		const label = node.getAttribute("aria-label")?.trim();
		let text: string;

		if (label) {
			text = label;
		} else if (node instanceof HTMLImageElement) {
			text = node.alt;
		} else if (node.localName === "svg") {
			// An inline SVG is named by its <title>, which is never rendered as a box.
			text =
				Array.from(node.children).find((child) => child.localName === "title")?.textContent ?? "";
		} else {
			text = Array.from(node.childNodes)
				.map((child) => textOf(child, skipHidden))
				.join("");
		}

		// Block boundaries separate words; inline ones do not.
		return getComputedStyle(node).display.startsWith("inline") ? text : ` ${text} `;
	};

	const contentOf = (el: Element, skipHidden = true): string => {
		if (skipHidden && contentCache?.el === el) {
			return contentCache.text;
		}

		const text = collapse(
			Array.from(el.childNodes)
				.map((child) => textOf(child, skipHidden))
				.join(""),
		);

		if (skipHidden) {
			contentCache = { el, text };
		}

		return text;
	};

	const labelledByText = (el: Element, ids: string): string => {
		const root = el.getRootNode() as Document | ShadowRoot;

		return collapse(
			ids
				.split(/\s+/)
				.map((id) => {
					const target = root.getElementById(id);

					labeller ??= target;

					// A hidden label still names the element, along with everything inside it.
					return target ? contentOf(target, !isHidden(target)) : "";
				})
				.join(" "),
		);
	};

	const nameOf = (el: Element, role: string): { name: string; source: NameSource } | null => {
		labeller = null;

		const labelledBy = el.getAttribute("aria-labelledby")?.trim();
		const fromLabelledBy = labelledBy ? labelledByText(el, labelledBy) : "";

		if (fromLabelledBy) {
			return { name: fromLabelledBy, source: "aria-labelledby" };
		}

		const ariaLabel = collapse(el.getAttribute("aria-label") ?? "");

		if (ariaLabel) {
			return { name: ariaLabel, source: "aria-label" };
		}

		if (LABELLED_ROLES.has(role)) {
			return null;
		}

		const labels = "labels" in el ? (el.labels as NodeListOf<HTMLLabelElement> | null) : null;
		const fromLabels = collapse(
			Array.from(labels ?? [])
				.map((label) => contentOf(label))
				.join(" "),
		);

		if (fromLabels) {
			labeller = labels?.[0] ?? null;

			return { name: fromLabels, source: "label" };
		}

		const value =
			el instanceof HTMLInputElement && BUTTON_INPUT_TYPES.has(el.type.toLowerCase())
				? collapse(el.getAttribute("value") ?? "")
				: "";

		if (value) {
			return { name: value, source: "value" };
		}

		const content = NAME_FROM_CONTENT.has(role) ? contentOf(el) : "";

		if (content) {
			return { name: content, source: "content" };
		}

		const title = collapse(el.getAttribute("title") ?? "");

		if (title) {
			return { name: title, source: "title" };
		}

		const placeholder = collapse(el.getAttribute("placeholder") ?? "");

		return placeholder ? { name: placeholder, source: "placeholder" } : null;
	};

	// A cheap stand-in for nameOf, for counting what lies past the element limit.
	const mayHaveName = (el: Element, role: string): boolean => {
		if (
			["aria-label", "aria-labelledby", "title", "placeholder"].some((attribute) =>
				el.getAttribute(attribute)?.trim(),
			)
		) {
			return true;
		}

		if (LABELLED_ROLES.has(role)) {
			return false;
		}

		if ("labels" in el && ((el.labels as NodeListOf<HTMLLabelElement> | null)?.length ?? 0) > 0) {
			return true;
		}

		if (el instanceof HTMLInputElement && BUTTON_INPUT_TYPES.has(el.type.toLowerCase())) {
			return Boolean(el.getAttribute("value")?.trim());
		}

		return (
			NAME_FROM_CONTENT.has(role) &&
			Boolean(el.textContent?.trim() || el.querySelector("img[alt]:not([alt=''])"))
		);
	};

	const identifiersOf = (el: Element): Identifier[] => {
		const identifiers: Identifier[] = [];

		for (const attribute of Array.from(el.attributes)) {
			const isIdentifier =
				["id", "name"].includes(attribute.name) || attribute.name.startsWith("data-");

			if (isIdentifier && attribute.value.trim()) {
				identifiers.push({
					attribute: attribute.name,
					value: attribute.value.trim().slice(0, textLimit),
				});
			}
		}

		for (const token of Array.from(el.classList)) {
			identifiers.push({ attribute: "class", value: token.slice(0, textLimit) });
		}

		return identifiers;
	};

	const hasLinkContext = (el: Element, name: string): boolean => {
		if (el.getAttribute("aria-describedby")?.trim()) {
			return true;
		}

		const container = el.parentElement?.closest("p, li, td, th, dd");

		return container ? collapse(container.textContent ?? "").length > name.length : false;
	};

	const visit = (root: Document | ShadowRoot): void => {
		for (const el of Array.from(root.querySelectorAll("*"))) {
			if (el.shadowRoot) {
				visit(el.shadowRoot);
			}

			const role = roleOf(el);

			if (!role || el.closest('[aria-hidden="true"]') || !isRendered(el)) {
				continue;
			}

			if (collected.length === elementLimit) {
				if (mayHaveName(el, role)) {
					total++;
				}

				continue;
			}

			const named = nameOf(el, role);

			if (!named) {
				continue;
			}

			total++;

			const isControl = role === "button" || role === "link";

			const fromOtherElement = named.source === "label" || named.source === "aria-labelledby";

			elements.push(el);
			labellerOf.push(fromOtherElement ? labeller : null);
			collected.push({
				name: named.name.slice(0, textLimit),
				truncated: named.name.length > textLimit,
				source: named.source,
				role,
				lang: el.closest("[lang]")?.getAttribute("lang") ?? null,
				identifiers: identifiersOf(el),
				hrefHost: el.matches("a[href], area[href]")
					? (el as HTMLAnchorElement | HTMLAreaElement).hostname || null
					: null,
				iconOnly: isControl && !/[\p{L}\p{N}]/u.test(contentOf(el)),
				linkContext: role === "link" && hasLinkContext(el, named.name),
				html: (el.cloneNode(false) as Element).outerHTML,
			});
		}
	};

	visit(document);

	for (const [i, label] of labellerOf.entries()) {
		if (label) {
			collected[i]!.labelIndex = elements.length + labellers.length;
			labellers.push(label);
		}
	}

	(window as unknown as Record<string, unknown>)[stashKey] = [...elements, ...labellers];

	return { elements: collected, total };
}
