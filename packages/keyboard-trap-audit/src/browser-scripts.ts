// Every function here is serialised and run in the page, so none may reference anything outside its
// own body.

export const CONTAINER_ATTR = "data-a11y-pulse-trap-container";

export type RingDialog = {
	role: "dialog" | "alertdialog";
	native: boolean;
	modal: boolean;
	buttons: number;
};

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
			/** The dialog the ring sits in, if any. */
			dialog?: RingDialog | null;
	  };

/**
 * What `focusOutsideScript` did: `focused` an element outside the ring, found `none` because the
 * ring leaves nothing out, or found the ones it left out `gone` with nothing in their place.
 */
export type OutsideFocus = "focused" | "none" | "gone";

export type FocusProbe = {
	/** The ring member holding focus, or -1 when focus is outside the ring. */
	member: number;
	containerVisible: boolean;
	href: string;
	/** Opening tag of the focused element, or `null` when focus is on nothing or on `<body>`. */
	landed?: string | null;
};

/**
 * What the page keeps between the escape protocol's scripts: the ring's elements, so each probe
 * need not find them again by selector, and what was seen since Escape was last pressed.
 */
type TrapState = {
	members: Element[];
	positions: Map<Element, number>;
	container: Element | null;
	/** Tabbable elements outside the ring that nothing shuts out, in document order. */
	excluded: Element[];
	/** The same list as the page stands now, for when it has re-created those elements since. */
	outsideNow: () => Element[];
	/** The element outside the ring that was last given focus, and what to put back afterwards. */
	outside?: {
		target: HTMLElement;
		/** What a form control held before it was focused, or `null` for anything else. */
		value: string | null;
		observer: MutationObserver | null;
		mutated: boolean;
	};
	escape?: {
		listener: (event: KeyboardEvent) => void;
		observer: MutationObserver;
		event: KeyboardEvent | null;
		mutated: boolean;
		/**
		 * When the last short timer set while the page handled Escape comes due, on the
		 * `performance.now()` clock. 0 when it set none.
		 */
		timerDue: number;
		/** Put `setTimeout` back as it was before the key was dispatched. */
		restoreTimers: () => void;
	};
};

type TrapWindow = Window & { __a11yPulseTrap?: TrapState };

/**
 * Resolve the cycle's members, count the tabbable elements it shuts out, and mark their nearest
 * common ancestor with `containerAttr`. Elements inside open shadow roots count like any other.
 */
export function inspectRingScript(
	selectors: string[],
	containerAttr: string,
	tabbableSelector: string,
): RingInspection {
	// A selector for an element in a shadow root lists each host first, joined by " >>> ". Must
	// stay in step with `resolveSelector` in @a11y-pulse/browser-adaptor.
	const find = (selector: string): HTMLElement | null => {
		let scope: ParentNode = document;
		let element: HTMLElement | null = null;

		for (const part of selector.split(" >>> ")) {
			try {
				element = scope.querySelector<HTMLElement>(part);
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

	const ring = selectors.map((selector) => find(selector));

	if (ring.some((element) => element === null)) {
		return { resolved: false };
	}

	const members = ring as Element[];

	// The parent in the flattened tree: out of a shadow root to its host.
	const parentOf = (element: Element): Element | null => {
		if (element.parentElement) {
			return element.parentElement;
		}

		const root = element.getRootNode();

		return root instanceof ShadowRoot ? root.host : null;
	};

	const contains = (ancestor: Element, element: Element): boolean => {
		for (let node: Element | null = element; node; node = parentOf(node)) {
			if (node === ancestor) {
				return true;
			}
		}

		return false;
	};

	const queryAll = (root: ParentNode, selector: string): Element[] => {
		const found = Array.from(root.querySelectorAll(selector));

		for (const element of root.querySelectorAll("*")) {
			if (element.shadowRoot) {
				found.push(...queryAll(element.shadowRoot, selector));
			}
		}

		return found;
	};

	// The element and the shadow hosts it sits in, outermost first.
	const hostChain = (element: Element): Element[] => {
		const chain = [element];

		for (let root = element.getRootNode(); root instanceof ShadowRoot; ) {
			chain.unshift(root.host);
			root = root.host.getRootNode();
		}

		return chain;
	};

	const precedes = (element: Element, other: Element): boolean => {
		const a = hostChain(element);
		const b = hostChain(other);
		let depth = 0;

		while (depth < a.length - 1 && depth < b.length - 1 && a[depth] === b[depth]) {
			depth++;
		}

		const x = a[depth]!;
		const y = b[depth]!;

		if (x === y) {
			return a.length < b.length;
		}

		return (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
	};

	const isVisible = (element: Element): boolean => {
		const check = (element as Element & { checkVisibility?: (options?: object) => boolean })
			.checkVisibility;

		if (typeof check === "function") {
			return check.call(element, { visibilityProperty: true });
		}

		return element.getClientRects().length > 0 && getComputedStyle(element).visibility !== "hidden";
	};

	const matches = (element: Element, selector: string): boolean => {
		try {
			return element.matches(selector);
		} catch {
			return false;
		}
	};

	// A modal dialog makes everything outside it inert without an `inert` attribute.
	const openModal = (): Element | null =>
		queryAll(document, "dialog").find((dialog) => matches(dialog, ":modal")) ?? null;
	const modal = openModal();

	const radioIsTabStop = (radio: HTMLInputElement): boolean => {
		if (radio.checked || !radio.name) {
			return true;
		}

		const group = Array.from(
			(radio.getRootNode() as ParentNode).querySelectorAll<HTMLInputElement>(
				`input[type="radio"][name="${CSS.escape(radio.name)}"]`,
			),
		).filter((other) => other.form === radio.form);

		return !group.some((other) => other.checked) && group[0] === radio;
	};

	const wouldBeTabbable = (element: Element): boolean => {
		if ((element as HTMLElement).tabIndex < 0 || matches(element, ":disabled")) {
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

	const isShutOut = (element: Element, modal: Element | null): boolean => {
		if (modal !== null && !contains(modal, element)) {
			return true;
		}

		for (let node: Element | null = element; node; node = parentOf(node)) {
			if (node.hasAttribute("inert")) {
				return true;
			}
		}

		return false;
	};

	/** The tabbable elements outside `ring`, and those of them that nothing shuts out, in order. */
	const survey = (ring: Element[]): { outside: Element[]; excluded: Element[] } => {
		const shutOutBy = openModal();
		const outside = queryAll(document, tabbableSelector).filter(
			(element) =>
				!ring.some((member) => member === element || contains(member, element)) &&
				wouldBeTabbable(element),
		);
		const excluded = outside
			.filter((element) => !isShutOut(element, shutOutBy))
			.sort((a, b) => (a === b ? 0 : precedes(a, b) ? -1 : 1));

		return { outside, excluded };
	};

	const { outside, excluded } = survey(members);

	let container: Element = members[0]!;

	while (!members.every((member) => contains(container, member))) {
		const parent = parentOf(container);

		if (!parent) {
			break;
		}

		container = parent;
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

	let dialog: RingDialog | null = null;

	for (let node: Element | null = container; node && !dialog; node = parentOf(node)) {
		const native = node.tagName === "DIALOG";
		const role = node.getAttribute("role");

		if (native || role === "dialog" || role === "alertdialog") {
			const buttons = queryAll(
				node,
				"button, [role='button'], input[type='button'], input[type='submit'], input[type='reset'], a[href]",
			).filter((button) => !matches(button, ":disabled") && isVisible(button));

			dialog = {
				role: role === "alertdialog" ? "alertdialog" : "dialog",
				native,
				modal: native ? node === modal : node.getAttribute("aria-modal") === "true",
				buttons: buttons.length,
			};
		}
	}

	const positions = new Map<Element, number>();

	members.forEach((member, index) => {
		if (!positions.has(member)) {
			positions.set(member, index);
		}
	});

	// A ring inspected before on this page, and never cleared, must not go on watching it.
	const stale = (window as TrapWindow).__a11yPulseTrap;

	if (stale?.escape) {
		window.removeEventListener("keydown", stale.escape.listener, true);
		stale.escape.observer.disconnect();
		stale.escape.restoreTimers();
	}

	stale?.outside?.observer?.disconnect();

	const state: TrapState = {
		members,
		positions,
		container,
		excluded,
		// The ring's members are read when this is called: the page may have re-created them too.
		outsideNow: () => survey(state.members.filter((member) => member.isConnected)).excluded,
	};
	(window as TrapWindow).__a11yPulseTrap = state;

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
		dialog,
	};
}

/** The element marked by `inspectRingScript`, for building its selector. */
export function containerHandleScript(): Element | null {
	return (window as TrapWindow).__a11yPulseTrap?.container ?? null;
}

/** The shallow markup of `element`, without the container marker. */
export function containerHtmlScript(element: Element, containerAttr: string): string {
	const clone = element.cloneNode(false) as Element;
	clone.removeAttribute(containerAttr);

	return clone.outerHTML;
}

/** Focus a ring member: the element `inspectRingScript` resolved, or `selector` if that has gone. */
export function focusSelectorScript(selector: string, index = -1): boolean {
	// A selector for an element in a shadow root lists each host first, joined by " >>> ". Must
	// stay in step with `resolveSelector` in @a11y-pulse/browser-adaptor.
	const find = (selector: string): HTMLElement | null => {
		let scope: ParentNode = document;
		let element: HTMLElement | null = null;

		for (const part of selector.split(" >>> ")) {
			try {
				element = scope.querySelector<HTMLElement>(part);
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

	const known = (window as TrapWindow).__a11yPulseTrap?.members[index] as HTMLElement | undefined;
	const element = known?.isConnected ? known : find(selector);

	if (!element) {
		return false;
	}

	element.focus({ preventScroll: true });

	let active: Element | null = document.activeElement;

	while (active?.shadowRoot?.activeElement) {
		active = active.shadowRoot.activeElement;
	}

	return active === element || element.contains(active);
}

/**
 * Focus the tabbable element outside the ring that keyboard focus would reach after leaving the
 * page past one edge and coming back in at the other: the `last` one after Shift+Tab off the
 * start, the `first` after Tab off the end.
 *
 * A page that has re-created those elements since the ring was inspected has them looked for
 * again, so that a re-render cannot pass for a page with nothing outside the ring. What the element
 * held and whether focusing it changed the document are noted, for `leaveOutsideScript` to undo.
 */
export function focusOutsideScript(which: "first" | "last"): OutsideFocus {
	const state = (window as TrapWindow).__a11yPulseTrap;

	if (!state || state.excluded.length === 0) {
		return "none";
	}

	if (state.excluded.some((element) => !element.isConnected)) {
		try {
			state.excluded = state.outsideNow();
		} catch {
			state.excluded = state.excluded.filter((element) => element.isConnected);
		}

		if (state.excluded.length === 0) {
			return "gone";
		}
	}

	const target = (
		which === "first" ? state.excluded[0] : state.excluded[state.excluded.length - 1]
	) as HTMLElement;

	state.outside?.observer?.disconnect();

	const held = (target as HTMLElement & { value?: unknown }).value;
	const watch: NonNullable<TrapState["outside"]> = {
		target,
		value: target.matches("input, textarea, select") && typeof held === "string" ? held : null,
		observer: null,
		mutated: false,
	};

	if (typeof MutationObserver === "function") {
		// What the ring does to itself as focus leaves it is its own business.
		const elsewhere = (records: MutationRecord[]): boolean =>
			records.some((record) => !state.container?.contains(record.target));

		watch.observer = new MutationObserver((records) => {
			watch.mutated ||= elsewhere(records);
		});
		watch.observer.observe(document, { attributes: true, childList: true, subtree: true });
	}

	state.outside = watch;
	target.focus({ preventScroll: true });

	return "focused";
}

/**
 * Whether giving focus to the element outside the ring made the page show something, such as a
 * search field's suggestions, that Escape can be pressed to put away: focus is still on that
 * element, the document changed when it took focus, and it is not a field holding text, which
 * Escape could clear.
 */
export function outsideOpenedScript(): boolean {
	const watch = (window as TrapWindow).__a11yPulseTrap?.outside;

	if (!watch) {
		return false;
	}

	let active: Element | null = document.activeElement;

	while (active?.shadowRoot?.activeElement) {
		active = active.shadowRoot.activeElement;
	}

	if (active !== watch.target) {
		return false;
	}

	// Records queued but not yet delivered still count as a change.
	const pending = watch.observer?.takeRecords() ?? [];
	const container = (window as TrapWindow).__a11yPulseTrap?.container;

	if (!watch.mutated && !pending.some((record) => !container?.contains(record.target))) {
		return false;
	}

	watch.mutated = true;

	if (watch.value !== null && watch.value !== "") {
		return false;
	}

	const editable = watch.target.closest("[contenteditable]:not([contenteditable='false'])");

	return !editable || (editable.textContent ?? "").trim() === "";
}

/**
 * Undo what can be undone of `focusOutsideScript`: stop watching the document, give a form control
 * back what it held, and take focus off the element if it still has it.
 */
export function leaveOutsideScript(): void {
	const state = (window as TrapWindow).__a11yPulseTrap;
	const watch = state?.outside;

	if (!state || !watch) {
		return;
	}

	watch.observer?.disconnect();
	delete state.outside;

	const control = watch.target as HTMLElement & { value?: string };

	if (watch.value !== null && control.value !== watch.value) {
		try {
			control.value = watch.value;
		} catch {}
	}

	let active: Element | null = document.activeElement;

	while (active?.shadowRoot?.activeElement) {
		active = active.shadowRoot.activeElement;
	}

	if (active === watch.target) {
		watch.target.blur();
	}
}

/**
 * Which of the cycle's members holds focus, whether their container is still shown, and the page's
 * URL, so a navigation can be told apart from an escape.
 */
export function probeFocusScript(selectors: string[], containerAttr: string): FocusProbe {
	// A selector for an element in a shadow root lists each host first, joined by " >>> ". Must
	// stay in step with `resolveSelector` in @a11y-pulse/browser-adaptor.
	const find = (selector: string): HTMLElement | null => {
		let scope: ParentNode = document;
		let element: HTMLElement | null = null;

		for (const part of selector.split(" >>> ")) {
			try {
				element = scope.querySelector<HTMLElement>(part);
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

	const parentOf = (element: Element): Element | null => {
		if (element.parentElement) {
			return element.parentElement;
		}

		const root = element.getRootNode();

		return root instanceof ShadowRoot ? root.host : null;
	};

	const state = (window as TrapWindow).__a11yPulseTrap;

	let active: Element | null = document.activeElement;

	while (active?.shadowRoot?.activeElement) {
		active = active.shadowRoot.activeElement;
	}

	if (active === document.body || active === document.documentElement) {
		active = null;
	}

	let member = -1;

	if (active !== null) {
		// The elements resolved at inspection answer almost every probe without a selector lookup.
		for (let node: Element | null = active; node && member === -1 && state; node = parentOf(node)) {
			member = state.positions.get(node) ?? -1;
		}

		// Focus on an element the ring did not hold at inspection has either left the ring, or
		// landed on a member the page has re-created since.
		if (member === -1) {
			member = selectors.findIndex((selector) => {
				const element = find(selector);

				return element !== null && (element === active || element.contains(active));
			});

			if (member !== -1 && state) {
				const element = find(selectors[member]!)!;
				state.members[member] = element;
				state.positions.set(element, member);
			}
		}
	}

	let container: Element | null = state?.container ?? null;

	if (!container?.isConnected) {
		container = document.querySelector(`[${containerAttr}]`);
	}

	const containerVisible =
		container !== null &&
		container.getClientRects().length > 0 &&
		getComputedStyle(container).visibility !== "hidden";

	let landed: string | null = null;

	if (active !== null) {
		const clone = active.cloneNode(false) as Element;
		clone.removeAttribute(containerAttr);
		landed = clone.outerHTML;
	}

	return { member, containerVisible, href: location.href, landed };
}

/** Start watching for what the page does with the Escape key about to be pressed. */
export function watchEscapeScript(): void {
	const state = (window as TrapWindow).__a11yPulseTrap;

	if (!state || typeof MutationObserver !== "function") {
		return;
	}

	if (state.escape) {
		window.removeEventListener("keydown", state.escape.listener, true);
		state.escape.observer.disconnect();
		state.escape.restoreTimers();
	}

	const watch: NonNullable<TrapState["escape"]> = {
		event: null,
		mutated: false,
		timerDue: 0,
		restoreTimers: () => {},
		listener: (event) => {
			if (event.key !== "Escape") {
				return;
			}

			watch.event = event;

			// A handler that closes its dialog from a timer shows nothing until the timer fires. So
			// that the wait is not cut short on it, the timers set while this one event is handled are
			// noted, and `setTimeout` is put back as soon as its handlers have run.
			try {
				const previous = window.setTimeout;
				let live = true;
				const noting = function (this: unknown, ...args: unknown[]) {
					const delay = Number(args[1]) || 0;

					if (live && delay <= 1000) {
						watch.timerDue = Math.max(watch.timerDue, performance.now() + delay);
					}

					return (previous as (...values: unknown[]) => unknown).apply(window, args);
				} as unknown as typeof window.setTimeout;

				watch.restoreTimers = () => {
					live = false;

					// A page that has wrapped `setTimeout` again since keeps its own wrapper, which
					// goes on working through this one.
					if (window.setTimeout === noting) {
						try {
							window.setTimeout = previous;
						} catch {}
					}
				};

				window.setTimeout = noting;
				previous.call(window, () => watch.restoreTimers(), 0);
			} catch {
				// A page that has locked its timers down is only ever waited on in full.
				watch.timerDue = Number.POSITIVE_INFINITY;
			}
		},
		observer: new MutationObserver(() => {
			watch.mutated = true;
		}),
	};

	window.addEventListener("keydown", watch.listener, true);
	watch.observer.observe(document, {
		attributes: true,
		childList: true,
		characterData: true,
		subtree: true,
	});
	state.escape = watch;
}

/**
 * Whether the page visibly did nothing with the last Escape press: it reached the page, nothing
 * cancelled it, the document has not changed since, nothing is animating, and no short timer set
 * while the key was handled is still to fire. A dialog that is going to close after an exit
 * animation or a delay fails at least one of these.
 */
export function escapeIgnoredScript(): boolean {
	const watch = (window as TrapWindow).__a11yPulseTrap?.escape;

	if (!watch?.event || watch.event.defaultPrevented) {
		return false;
	}

	watch.restoreTimers();

	if (watch.timerDue > performance.now()) {
		return false;
	}

	// Records queued but not yet delivered still count as a change.
	if (watch.mutated || watch.observer.takeRecords().length > 0) {
		return false;
	}

	if (typeof document.getAnimations !== "function") {
		return false;
	}

	return !document.getAnimations().some((animation) => animation.playState === "running");
}

export function clearContainerScript(containerAttr: string): void {
	const win = window as TrapWindow;
	const state = win.__a11yPulseTrap;

	if (state?.escape) {
		window.removeEventListener("keydown", state.escape.listener, true);
		state.escape.observer.disconnect();
		state.escape.restoreTimers();
	}

	state?.outside?.observer?.disconnect();
	state?.container?.removeAttribute(containerAttr);
	delete win.__a11yPulseTrap;

	for (const element of document.querySelectorAll(`[${containerAttr}]`)) {
		element.removeAttribute(containerAttr);
	}

	let active: Element | null = document.activeElement;

	while (active?.shadowRoot?.activeElement) {
		active = active.shadowRoot.activeElement;
	}

	(active as HTMLElement | null)?.blur();
}
