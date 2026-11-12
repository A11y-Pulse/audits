// Every function here is serialised and run in the page, so none may reference anything outside its
// own body.

/** One element the page scan thinks may be a control, before the browser is asked about listeners. */
export type RawCandidate = {
	/** Position in the array left on `window[stashKey]`. */
	index: number;

	/**
	 * `unreached`: not in the tab order and nothing inside or around it is. `focused`: took focus
	 * during the tab pass and is not a native control.
	 */
	kind: "unreached" | "focused";

	/** The element's own opening and closing tags, without its content. */
	html: string;
	tag: string;

	/** First token of the `role` attribute, lower-cased, or null without one. */
	role: string | null;

	/** `role` names a widget a user operates (`button`, `tab`, `option`...). */
	widgetRole: boolean;

	/** Handler properties the page set on the element, such as `onclick`. */
	handlers: string[];

	/** The computed cursor is `pointer`. */
	cursorPointer: boolean;

	/** The cursor is `pointer` here and not on the parent, so this is where the page set it. */
	cursorSetHere: boolean;

	/** The `tabindex` attribute, or null without a numeric one. */
	tabindex: number | null;

	/** A `tabindex="-1"` element beside a tabbable sibling of the same kind: a roving tab stop. */
	roving: boolean;

	/** A `<label>` whose control is not rendered, so only a pointer can operate it. */
	hiddenControlLabel: boolean;

	/** Position in `focusedSelectors` of the stop this element was, or null if it never took focus. */
	focusedAt: number | null;

	/** The element is a custom element, which can expose a role without a `role` attribute. */
	customElement: boolean;

	/** No text or graphics, and covers much of the viewport: an overlay closed by clicking it. */
	backdrop: boolean;

	/** Has many descendants or covers much of the viewport, so a listener on it may be delegated. */
	containerLike: boolean;

	/** A focused element with something else in the tab order inside it. */
	holdsTabbable: boolean;

	/** Index of the nearest ancestor that is also a candidate, or null. */
	parent: number | null;

	/** Start of the element's text, for telling candidates apart. */
	text: string;
};

export type CollectedCandidates = {
	candidates: RawCandidate[];

	/** `candidateLimit` cut the list short. */
	truncated: boolean;

	/** How many of the focused selectors still name an element. */
	focusedResolved: number;
	href: string;
};

/**
 * Find the elements that may be controls the keyboard cannot reach, and the focused elements that
 * may be controls without a role, and leave them in an array on `window[stashKey]` in the order
 * returned.
 *
 * `focusedSelectors` are the stops of the tab pass (see getSelector, whose ` >>> ` steps into a
 * shadow root). With `includeUnsignalled`, elements with no sign of being a control are returned
 * too, as far as `candidateLimit` allows, for a caller that can ask the browser about listeners.
 */
export function collectCandidatesScript(
	focusedSelectors: string[],
	stashKey: string,
	candidateLimit: number,
	includeUnsignalled: boolean,
): CollectedCandidates {
	const WIDGET_ROLES = new Set([
		"button",
		"link",
		"checkbox",
		"switch",
		"radio",
		"tab",
		"menuitem",
		"menuitemcheckbox",
		"menuitemradio",
		"option",
		"slider",
		"spinbutton",
		"textbox",
		"searchbox",
		"combobox",
		"treeitem",
	]);
	// Widgets that take one tab stop and move focus among their children themselves.
	const COMPOSITE_ROLES = new Set([
		"tablist",
		"menu",
		"menubar",
		"listbox",
		"grid",
		"treegrid",
		"radiogroup",
		"toolbar",
		"tree",
		"combobox",
	]);
	const NATIVE_TAGS = new Set([
		"button",
		"input",
		"select",
		"textarea",
		"summary",
		"iframe",
		"embed",
		"object",
		"option",
		"optgroup",
	]);
	const HANDLER_PROPERTIES = [
		"onclick",
		"ondblclick",
		"onmousedown",
		"onmouseup",
		"onpointerdown",
		"onpointerup",
		"ontouchstart",
		"ontouchend",
	];
	const KEY_HANDLER_PROPERTIES = ["onkeydown", "onkeyup", "onkeypress"];
	const CONTAINER_DESCENDANTS = 10;
	const LARGE_VIEWPORT_FRACTION = 0.3;
	const TEXT_LENGTH = 80;

	const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);

	const resolve = (selector: string): Element | null => {
		// Must stay in step with `resolveSelector` in @a11y-pulse/browser-adaptor.
		let scope: ParentNode = document;
		let element: Element | null = null;

		for (const part of selector.split(" >>> ")) {
			try {
				element = scope.querySelector(part);
			} catch {
				return null;
			}

			if (!element) {
				return null;
			}

			scope = element.shadowRoot ?? element;
		}

		return element;
	};

	const focused = new Map<Element, number>();

	for (const [position, selector] of focusedSelectors.entries()) {
		const element = resolve(selector);

		if (element) {
			focused.set(element, position);
		}
	}

	const roleOf = (element: Element): string | null => {
		const role = element.getAttribute("role")?.trim().toLowerCase().split(/\s+/)[0];

		return role ? role : null;
	};

	const tabindexOf = (element: Element): number | null => {
		const value = element.getAttribute("tabindex");

		if (value === null || !/^\s*-?\d+\s*$/.test(value)) {
			return null;
		}

		return Number(value);
	};

	const isDisabled = (element: Element): boolean => {
		try {
			if (element.matches(":disabled")) {
				return true;
			}
		} catch {
			// No :disabled support; fall through to the attribute.
		}

		return element.getAttribute("aria-disabled") === "true";
	};

	const isRendered = (element: Element): boolean => {
		const visible = (
			element as Element & { checkVisibility?: (options?: object) => boolean }
		).checkVisibility?.({ visibilityProperty: true, contentVisibilityAuto: true });

		if (visible === false) {
			return false;
		}

		const rect = element.getBoundingClientRect();

		return rect.width > 0 && rect.height > 0;
	};

	const isNative = (element: Element): boolean => {
		const tag = element.localName;

		if (NATIVE_TAGS.has(tag)) {
			return true;
		}

		if ((tag === "a" || tag === "area") && element.hasAttribute("href")) {
			return true;
		}

		if ((tag === "audio" || tag === "video") && element.hasAttribute("controls")) {
			return true;
		}

		return (element as HTMLElement).isContentEditable === true;
	};

	// In the tab order as the page stands, or known to have taken focus during the pass.
	const isTabbable = (element: Element): boolean => {
		if (focused.has(element)) {
			return true;
		}

		const tabIndex = (element as HTMLElement).tabIndex;

		return typeof tabIndex === "number" && tabIndex >= 0 && !isDisabled(element);
	};

	const childrenOf = (element: Element): Element[] => {
		const root = element.shadowRoot;

		return root
			? [...Array.from(root.children), ...Array.from(element.children)]
			: Array.from(element.children);
	};

	const parentOf = (element: Element): Element | null => {
		if (element.parentElement) {
			return element.parentElement;
		}

		const root = element.getRootNode();

		return typeof ShadowRoot !== "undefined" && root instanceof ShadowRoot ? root.host : null;
	};

	const containsTabbable = (element: Element): boolean => {
		for (const child of childrenOf(element)) {
			if (isTabbable(child) || containsTabbable(child)) {
				return true;
			}
		}

		return false;
	};

	// Elements a tabbable element points at: a popup its owner drives from the keyboard.
	const driven: Element[] = [];

	for (const owner of Array.from(
		document.querySelectorAll("[aria-controls], [aria-owns], [aria-activedescendant]"),
	)) {
		if (!isTabbable(owner) && !containsTabbable(owner)) {
			continue;
		}

		for (const attribute of ["aria-controls", "aria-owns", "aria-activedescendant"]) {
			for (const id of (owner.getAttribute(attribute) ?? "").split(/\s+/)) {
				const target = id ? document.getElementById(id) : null;

				if (target) {
					driven.push(target);
				}
			}
		}
	}

	const isManagedComposite = (element: Element): boolean =>
		isTabbable(element) ||
		element.hasAttribute("aria-activedescendant") ||
		containsTabbable(element) ||
		driven.some(
			(target) => target === element || element.contains(target) || target.contains(element),
		);

	const handlersOf = (element: Element, properties: string[]): string[] =>
		properties.filter(
			(property) => typeof (element as unknown as Record<string, unknown>)[property] === "function",
		);

	const hasGraphics = (element: Element): boolean => {
		if (element.querySelector("img, svg, picture, canvas, video") !== null) {
			return true;
		}

		const image = getComputedStyle(element).backgroundImage;

		return image !== "" && image !== "none";
	};

	const coversViewport = (element: Element): boolean => {
		const rect = element.getBoundingClientRect();
		const width = Math.min(rect.right, window.innerWidth) - Math.max(rect.left, 0);
		const height = Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0);

		return width > 0 && height > 0 && (width * height) / viewportArea > LARGE_VIEWPORT_FRACTION;
	};

	const isRoving = (element: Element): boolean => {
		const parent = parentOf(element);
		const scope = (parent && parentOf(parent)) ?? parent;

		if (!scope) {
			return false;
		}

		const role = roleOf(element);

		return Array.from(scope.querySelectorAll(element.localName)).some(
			(other) => other !== element && roleOf(other) === role && isTabbable(other),
		);
	};

	// Not drawn at all, because of the element itself or of anything around it. An element hidden
	// only from sight (clipped, transparent, off screen) still takes focus and counts as rendered.
	const isUndrawn = (element: Element): boolean => {
		const visible = (
			element as Element & { checkVisibility?: (options?: object) => boolean }
		).checkVisibility?.({ visibilityProperty: true });

		if (visible !== undefined) {
			return !visible;
		}

		if (getComputedStyle(element).visibility === "hidden") {
			return true;
		}

		for (let node: Element | null = element; node; node = parentOf(node)) {
			if (getComputedStyle(node).display === "none") {
				return true;
			}
		}

		return false;
	};

	const holdsOrIsTabbable = (element: Element): boolean =>
		!isUndrawn(element) && (isTabbable(element) || containsTabbable(element));

	// A focusable widget standing in for a hidden native control, the way Chosen and Select2 replace
	// a `<select>`: something in the tab order named by the same label, or right beside the control.
	const hasStandIn = (label: Element, control: Element): boolean => {
		if (label.id) {
			for (const named of Array.from(document.querySelectorAll("[aria-labelledby]"))) {
				if (
					(named.getAttribute("aria-labelledby") ?? "").split(/\s+/).includes(label.id) &&
					holdsOrIsTabbable(named)
				) {
					return true;
				}
			}
		}

		// A checkbox or radio is routinely hidden with nothing but its label to operate it, so a
		// neighbour only stands in for one when it says it is a control of that kind.
		const type = (control as HTMLInputElement).type;
		const toggle = control.localName === "input" && (type === "checkbox" || type === "radio");
		const toggleRoles = "[role=checkbox], [role=switch], [role=radio], [role=button]";

		for (const sibling of [control.previousElementSibling, control.nextElementSibling]) {
			if (!sibling || sibling === label || sibling.contains(label)) {
				continue;
			}

			if (!holdsOrIsTabbable(sibling)) {
				continue;
			}

			if (!toggle || sibling.matches(toggleRoles) || sibling.querySelector(toggleRoles) !== null) {
				return true;
			}
		}

		return false;
	};

	const hidesItsControl = (label: Element): boolean => {
		const control = (label as HTMLLabelElement).control;

		if (!control || isDisabled(control) || (control as HTMLInputElement).type === "hidden") {
			return false;
		}

		return isUndrawn(control) && !hasStandIn(label, control);
	};

	type Entry = {
		element: Element;
		kind: RawCandidate["kind"];
		role: string | null;
		widgetRole: boolean;
		handlers: string[];
		cursorPointer: boolean;
		cursorSetHere: boolean;
		tabindex: number | null;
		hiddenControlLabel: boolean;
		signalled: boolean;
		dropped: boolean;
	};

	const entries: Entry[] = [];

	// Only what is cheap to read for every element on the page. The rest waits for `detail`.
	const note = (
		element: Element,
		kind: RawCandidate["kind"],
		cursor: string,
		parentCursor: string,
	): Entry => {
		const role = roleOf(element);
		const cursorPointer = cursor === "pointer";
		const cursorSetHere = cursorPointer && parentCursor !== "pointer";
		const tabindex = tabindexOf(element);
		const handlers = handlersOf(
			element,
			kind === "focused" ? [...HANDLER_PROPERTIES, ...KEY_HANDLER_PROPERTIES] : HANDLER_PROPERTIES,
		);
		const widgetRole = role !== null && WIDGET_ROLES.has(role);
		const hiddenControlLabel = element.localName === "label" && hidesItsControl(element);
		const entry: Entry = {
			element,
			kind,
			role,
			widgetRole,
			handlers,
			cursorPointer,
			cursorSetHere,
			tabindex,
			hiddenControlLabel,
			signalled:
				kind === "focused" ||
				handlers.length > 0 ||
				widgetRole ||
				cursorSetHere ||
				hiddenControlLabel ||
				(tabindex !== null && tabindex < 0),
			dropped: false,
		};

		entries.push(entry);

		return entry;
	};

	/** Walk `element` and its subtree; true when it is, or holds, something in the tab order. */
	const visit = (element: Element, insideManaged: boolean, parentCursor: string): boolean => {
		if (element.getAttribute("aria-hidden") === "true" || element.hasAttribute("inert")) {
			return false;
		}

		const style = getComputedStyle(element);

		if (style.display === "none") {
			return false;
		}

		const cursor = style.cursor;

		if (isTabbable(element)) {
			if (focused.has(element) && !isNative(element)) {
				note(element, "focused", cursor, parentCursor);
			}

			// Everything inside is reached through this element.
			return true;
		}

		if (element.localName === "label") {
			const holds = containsTabbable(element);

			if (!holds && hidesItsControl(element)) {
				note(element, "unreached", cursor, parentCursor);
			}

			// A label's content acts for its control.
			return holds;
		}

		if (isNative(element) || isDisabled(element)) {
			// A native control taken out of the tab order, or switched off: not a missing tab stop.
			return false;
		}

		const role = roleOf(element);
		const managed =
			insideManaged || (role !== null && COMPOSITE_ROLES.has(role) && isManagedComposite(element));
		const isRoot = element === document.documentElement || element === document.body;
		const entry = managed || isRoot ? null : note(element, "unreached", cursor, parentCursor);
		let holdsTabbable = false;

		for (const child of childrenOf(element)) {
			if (visit(child, managed, cursor)) {
				holdsTabbable = true;
			}
		}

		// A click target around something focusable is a convenience (a card around its link) or a
		// delegated listener, not a control of its own.
		if (entry && holdsTabbable) {
			entry.dropped = true;
		}

		return holdsTabbable;
	};

	if (document.documentElement) {
		visit(document.documentElement, false, "auto");
	}

	const kept = entries.filter((entry) => !entry.dropped);
	const limit = Math.max(0, candidateLimit);
	const selected: Entry[] = [];
	let truncated = false;

	// Elements with a sign of being a control come first, so the limit cuts the others.
	for (const wanted of includeUnsignalled ? [true, false] : [true]) {
		for (const entry of kept) {
			if (entry.signalled !== wanted || !isRendered(entry.element)) {
				continue;
			}

			if (selected.length >= limit) {
				truncated = true;
				break;
			}

			selected.push(entry);
		}
	}

	const indexOf = new Map<Element, number>();

	selected.forEach((entry, index) => {
		indexOf.set(entry.element, index);
	});

	(window as unknown as Record<string, unknown>)[stashKey] = selected.map((entry) => entry.element);

	const detail = (entry: Entry, index: number): RawCandidate => {
		const { element, kind, tabindex } = entry;
		const large = coversViewport(element);
		const text = (element.textContent ?? "").replace(/\s+/g, " ").trim();
		let parent: number | null = null;

		for (let node = parentOf(element); node; node = parentOf(node)) {
			const found = indexOf.get(node);

			if (found !== undefined) {
				parent = found;
				break;
			}
		}

		return {
			index,
			kind,
			html: (element.cloneNode(false) as Element).outerHTML,
			tag: element.localName,
			role: entry.role,
			widgetRole: entry.widgetRole,
			handlers: entry.handlers,
			cursorPointer: entry.cursorPointer,
			cursorSetHere: entry.cursorSetHere,
			tabindex,
			roving: kind === "unreached" && tabindex !== null && tabindex < 0 && isRoving(element),
			hiddenControlLabel: entry.hiddenControlLabel,
			focusedAt: focused.get(element) ?? null,
			customElement: element.localName.includes("-"),
			backdrop: kind === "unreached" && large && text === "" && !hasGraphics(element),
			containerLike: large || element.querySelectorAll("*").length > CONTAINER_DESCENDANTS,
			holdsTabbable: kind === "focused" && containsTabbable(element),
			parent,
			text: text.slice(0, TEXT_LENGTH),
		};
	};

	return {
		candidates: selected.map(detail),
		truncated,
		focusedResolved: focused.size,
		href: location.href,
	};
}
