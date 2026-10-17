// Every function here is serialised and run in the page, so none may reference anything outside its
// own body.

export const CONTAINER_ATTR = "data-a11y-pulse-trap-container";

export type RingInspection =
	| { resolved: false }
	| {
			resolved: true;
			/** Tabbable elements on the page that the cycle never reached. */
			excludedCount: number;
			/** Elements that would be tabbable but for a modal dialog or `inert`, which the cycle never reached. */
			shutOutCount: number;
			/** The cycle's common ancestor is `<body>` or `<html>`, so it names no component. */
			containerIsRoot: boolean;
			/** Lower-case tag name of each member, to check the selectors still name the same elements. */
			tags: string[];
			/** Ring members, by position, where arrow keys move focus rather than change a value. */
			arrowSafe: boolean[];
			/** The member to press Escape from, or -1 when every member is a field Escape would clear. */
			escapeIndex: number;
			/** Nothing tabbable comes before the ring, so Shift+Tab out of it leaves the page. */
			atStart: boolean;
			/** Nothing tabbable comes after the ring, so Tab out of it leaves the page. */
			atEnd: boolean;
	  };

export type FocusProbe = {
	/** The ring member holding focus, or -1 when focus is outside the ring. */
	member: number;
	containerVisible: boolean;
	href: string;
};

/**
 * Resolve the cycle's members, count the tabbable elements it shuts out, and mark their nearest
 * common ancestor with `containerAttr`.
 */
export function inspectRingScript(
	selectors: string[],
	containerAttr: string,
	tabbableSelector: string,
): RingInspection {
	const ring = selectors.map((selector) => document.querySelector(selector));

	if (ring.some((element) => element === null)) {
		return { resolved: false };
	}

	const members = ring as Element[];

	const isVisible = (element: Element): boolean => {
		const check = (element as Element & { checkVisibility?: (options?: object) => boolean })
			.checkVisibility;

		if (typeof check === "function") {
			return check.call(element, { visibilityProperty: true });
		}

		return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
	};

	// A modal dialog makes everything outside it inert without an `inert` attribute.
	const modal = document.querySelector("dialog:modal");

	const radioIsTabStop = (radio: HTMLInputElement): boolean => {
		if (radio.checked || !radio.name) {
			return true;
		}

		const group = Array.from(
			document.querySelectorAll<HTMLInputElement>(
				`input[type="radio"][name="${CSS.escape(radio.name)}"]`,
			),
		).filter((other) => other.form === radio.form);

		return !group.some((other) => other.checked) && group[0] === radio;
	};

	const wouldBeTabbable = (element: Element): boolean => {
		if ((element as HTMLElement).tabIndex < 0 || element.matches(":disabled")) {
			return false;
		}

		if (
			element instanceof HTMLInputElement &&
			element.type === "radio" &&
			!radioIsTabStop(element)
		) {
			return false;
		}

		return isVisible(element);
	};

	const isShutOut = (element: Element): boolean =>
		element.closest("[inert]") !== null || (modal !== null && !modal.contains(element));

	const candidates = document.querySelectorAll(tabbableSelector);
	const outside = Array.from(candidates).filter(
		(element) =>
			!members.some((member) => member === element || member.contains(element)) &&
			wouldBeTabbable(element),
	);
	const excluded = outside.filter((element) => !isShutOut(element));
	const precedes = (element: Element, other: Element): boolean =>
		(element.compareDocumentPosition(other) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

	let container: Element = members[0]!;

	while (!members.every((member) => container.contains(member)) && container.parentElement) {
		container = container.parentElement;
	}

	container.setAttribute(containerAttr, "");

	// Arrows change a value or a selection in these, rather than move focus.
	const ARROW_CONSUMERS = [
		"input",
		"select",
		"textarea",
		"audio",
		"video",
		"[contenteditable]:not([contenteditable='false'])",
		"[aria-activedescendant]",
		...[
			"combobox",
			"grid",
			"gridcell",
			"listbox",
			"menu",
			"menubar",
			"menuitemcheckbox",
			"menuitemradio",
			"option",
			"radio",
			"radiogroup",
			"scrollbar",
			"separator",
			"slider",
			"spinbutton",
			"tab",
			"tablist",
			"textbox",
			"tree",
			"treegrid",
			"treeitem",
		].map((role) => `[role="${role}"]`),
	].join(", ");

	const arrowSafe = members.map((member) => !member.closest(ARROW_CONSUMERS));

	// Escape clears a search field, so it is pressed from a member that takes no text if there is one.
	const takesText = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";
	const nonText = members.findIndex((member) => !member.matches(takesText));
	const escapeIndex =
		nonText !== -1
			? nonText
			: members.findIndex((member) => !member.matches("input[type='search']"));

	return {
		resolved: true,
		excludedCount: excluded.length,
		shutOutCount: outside.length - excluded.length,
		atStart: !excluded.some((element) => members.every((member) => precedes(element, member))),
		atEnd: !excluded.some((element) => members.every((member) => precedes(member, element))),
		containerIsRoot: container === document.body || container === document.documentElement,
		tags: members.map((member) => member.tagName.toLowerCase()),
		arrowSafe,
		escapeIndex,
	};
}

/** The element marked by `inspectRingScript`, for building its selector. */
export function containerHandleScript(): Element | null {
	// Must match CONTAINER_ATTR: a handle script takes no arguments.
	return document.querySelector("[data-a11y-pulse-trap-container]");
}

/** The shallow markup of `element`, without the container marker. */
export function containerHtmlScript(element: Element, containerAttr: string): string {
	const clone = element.cloneNode(false) as Element;
	clone.removeAttribute(containerAttr);

	return clone.outerHTML;
}

export function focusSelectorScript(selector: string): boolean {
	const element = document.querySelector<HTMLElement>(selector);

	if (!element) {
		return false;
	}

	element.focus({ preventScroll: true });

	return document.activeElement === element || element.contains(document.activeElement);
}

/**
 * Which of the cycle's members holds focus, whether their container is still shown, and the page's
 * URL, so a navigation can be told apart from an escape.
 */
export function probeFocusScript(selectors: string[], containerAttr: string): FocusProbe {
	let active: Element | null = document.activeElement;

	while (active?.shadowRoot?.activeElement) {
		active = active.shadowRoot.activeElement;
	}

	const member =
		active === null || active === document.body
			? -1
			: selectors.findIndex((selector) => {
					const element = document.querySelector(selector);

					return element !== null && (element === active || element.contains(active));
				});

	const container = document.querySelector(`[${containerAttr}]`);
	const containerVisible =
		container !== null &&
		container.getClientRects().length > 0 &&
		getComputedStyle(container).visibility !== "hidden";

	return { member, containerVisible, href: location.href };
}

export function clearContainerScript(containerAttr: string): void {
	for (const element of document.querySelectorAll(`[${containerAttr}]`)) {
		element.removeAttribute(containerAttr);
	}

	(document.activeElement as HTMLElement | null)?.blur();
}
