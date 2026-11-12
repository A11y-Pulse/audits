/** Why a trigger was found but left alone. */
export type DisclosureSkipReason =
	/** Not rendered, so no one can operate it as the page stands. */
	| "hidden"
	/** Disabled, `aria-disabled` or inside inert content. */
	| "disabled"
	/** A link that would leave the page, or a control inside one. */
	| "navigating-link"
	/** A submit or reset button, which would send or clear its form. */
	| "submits-form"
	/** A checkbox, radio button or switch: operating it changes a value, and Enter in a native one submits its form. */
	| "checkable"
	/** Its name suggests an action that cannot be undone, such as "Delete account" or "Sign out". */
	| "risky-name"
	/** A text field or combobox, which opens by typing or arrow keys, not Enter. */
	| "text-entry"
	/** A tree item, grid row or similar, which expands with arrow keys inside its widget. */
	| "composite-item"
	/** Not focusable itself but wraps something that is: the state sits on a container. */
	| "state-on-container";

/** A trigger as it was found, before anything was pressed. */
export type CollectedTrigger = {
	/** `outerHTML`, cut to a sane length. Truncate to the opening tag on the host. */
	html: string;
	/** The explicit `role`, or null. */
	role: string | null;
	/**
	 * `aria-expanded` as written. Null only for a trigger that has `aria-controls` alone, which is
	 * found when `includeControlsOnly` is set.
	 */
	expanded: string | null;
	/** Whether an `aria-controls` id resolved to an element. */
	hasControlled: boolean;
	/** Whether it can be reached with Tab (`tabIndex >= 0`). */
	inTabOrder: boolean;
	/** Whether it sits in a widget that moves focus with arrow keys (menu, toolbar, …). */
	inComposite: boolean;
	/** Whether Space must operate it: a `<button>` or `role="button"`. */
	spaceExpected: boolean;
	/** Whether it is a native link, which Space does not activate. */
	link: boolean;
};

export type CollectedSkip = { html: string; reason: DisclosureSkipReason };

export type DisclosureCollection = {
	/** Triggers to exercise, in document order. `window[stashKey][i]` is the element. */
	triggers: CollectedTrigger[];
	/** Triggers left alone, up to `skipLimit`. Their elements follow the triggers in the stash. */
	skipped: CollectedSkip[];
	/** Every trigger left alone, including those past `skipLimit`. */
	skippedTotal: number;
	/** Triggers that could have been exercised, including those past `triggerLimit`. */
	eligible: number;
};

/** What a trigger and the page around it look like at one moment. */
export type DisclosureReading = {
	/** False once the trigger has left the document. */
	connected: boolean;
	/** `aria-expanded` now. */
	expanded: string | null;
	/** Whether any `aria-controls` target is rendered, or null when none resolves. */
	controlled: boolean | null;
	/**
	 * Elements outside the trigger that are rendered now and were not when the trigger was begun,
	 * and the reverse. Null on a page too large to scan.
	 */
	appeared: number | null;
	disappeared: number | null;
	/** Whether the trigger has keyboard focus. */
	focused: boolean;
	/**
	 * Whether the trigger's content is still on the move: a transition or finite animation is
	 * running on it, or its `aria-controls` target changed size since the last reading.
	 */
	settling: boolean;
	/** Clicks the browser itself delivered to the trigger since it was begun, as a key press does. */
	clicks: number;
	/** Form submissions and navigations to another document stopped since the trigger was begun. */
	blocked: { submits: number; navigations: number };
};

/** What the audit is about to do to a trigger. */
export type DisclosureAction = "key" | "click";

export type DisclosureInstallOptions = {
	/** Also treat a button with `aria-controls`, no `aria-expanded` and a hidden target as a trigger. */
	includeControlsOnly?: boolean;
	/** Source of a case-insensitive pattern: a trigger whose name matches is not operated. */
	riskyNamePattern?: string | null;
};

export type DisclosureApi = {
	begin(index: number): DisclosureReading;
	focus(index: number): boolean;
	read(index: number): DisclosureReading;
	/**
	 * Whether it is safe to act on the trigger now. A key needs the trigger to hold keyboard focus;
	 * a click needs focus not to have moved elsewhere. Neither is safe behind a modal dialog.
	 */
	ready(index: number, action: DisclosureAction): boolean;
	blur(index: number): void;
	click(index: number): void;
	hover(index: number, on: boolean): void;
	end(index: number): void;
	finish(): void;
};

/** The document the audit started on has gone: the page navigated. */
export type DisclosureGone = { gone: true };

/**
 * Find the page's disclosure triggers, stash them on `window[stashKey]` (their first controlled
 * elements on `window[stashKey + "Controls"]`) and leave the functions the audit drives them with
 * on `window[stashKey + "Api"]`.
 *
 * A trigger is an element with `aria-expanded`. With `includeControlsOnly`, so is a button-like
 * element whose `aria-controls` names content that is not rendered. Native `<details>` and
 * `<select>` are not triggers.
 *
 * Until `finish` is called, form submissions and navigations to another document are stopped, so
 * that nothing a trigger does can send data or leave the page.
 */
export function installDisclosureScript(
	stashKey: string,
	triggerLimit: number,
	skipLimit: number,
	scanLimit: number,
	options: DisclosureInstallOptions = {},
): DisclosureCollection {
	const HTML_LIMIT = 2000;
	const COMPOSITE = "[role=menu],[role=menubar],[role=toolbar],[role=tablist],[role=listbox]";
	const COMPOSITE_ITEM = new Set([
		"treeitem",
		"row",
		"gridcell",
		"columnheader",
		"rowheader",
		"option",
		"tab",
	]);
	const NOT_A_DISCLOSURE = new Set([
		"tab",
		"combobox",
		"scrollbar",
		"slider",
		"spinbutton",
		"textbox",
		"searchbox",
		"radio",
		"checkbox",
		"switch",
		"option",
		"treeitem",
		"row",
		"gridcell",
	]);
	const CHECKABLE = new Set(["checkbox", "radio", "switch", "menuitemcheckbox", "menuitemradio"]);
	const riskyName = options.riskyNamePattern ? new RegExp(options.riskyNamePattern, "i") : null;
	const FOCUSABLE =
		"a[href],button,input,select,textarea,summary,[tabindex],[contenteditable=''],[contenteditable=true]";

	function everyElement(root: ParentNode, out: Element[]): Element[] {
		for (const element of root.querySelectorAll("*")) {
			out.push(element);

			if (element.shadowRoot) {
				everyElement(element.shadowRoot, out);
			}
		}

		return out;
	}

	/**
	 * Whether the element is on show to the user. With `anywhere`, an element parked outside the
	 * document still counts: only whether it is rendered at all is asked.
	 */
	function isShown(element: Element, anywhere = false): boolean {
		const rect = element.getBoundingClientRect();

		if (rect.width <= 0 || rect.height <= 0) {
			return false;
		}

		// Parked off the top or either side of the document, where no scrolling reaches it.
		const pageWidth = Math.max(document.documentElement.scrollWidth, window.innerWidth);

		if (
			!anywhere &&
			(rect.right + window.scrollX <= 0 ||
				rect.bottom + window.scrollY <= 0 ||
				rect.left + window.scrollX >= pageWidth)
		) {
			return false;
		}

		if (typeof element.checkVisibility !== "function") {
			return true;
		}

		return element.checkVisibility({
			opacityProperty: true,
			visibilityProperty: true,
			// The older names, for engines that shipped before the rename.
			checkOpacity: true,
			checkVisibilityCSS: true,
		});
	}

	function role(element: Element): string | null {
		return element.getAttribute("role")?.trim().toLowerCase() || null;
	}

	function controlled(element: Element): Element[] {
		const root = element.getRootNode() as Document | ShadowRoot;
		const found: Element[] = [];

		for (const id of (element.getAttribute("aria-controls") ?? "").split(/\s+/)) {
			const target =
				id && typeof root.getElementById === "function" ? root.getElementById(id) : null;

			if (target) {
				found.push(target);
			}
		}

		return found;
	}

	function navigates(element: Element): boolean {
		const link = element.closest("a[href], area[href]");

		if (!link) {
			return false;
		}

		const href = (link.getAttribute("href") ?? "").trim();

		return !(href === "" || href.startsWith("#") || /^javascript:/i.test(href));
	}

	function submits(element: Element): boolean {
		if (element instanceof HTMLButtonElement) {
			return element.form !== null && element.type !== "button";
		}

		if (element instanceof HTMLInputElement) {
			return element.type === "submit" || element.type === "image" || element.type === "reset";
		}

		return false;
	}

	/** A control that holds a value. Operating it changes the value, and Enter in a native one submits. */
	function isCheckable(element: Element): boolean {
		if (element instanceof HTMLInputElement) {
			return element.type === "checkbox" || element.type === "radio";
		}

		const elementRole = role(element);

		return elementRole !== null && CHECKABLE.has(elementRole);
	}

	/** The trigger's name, near enough to match words in: labels first, then its own text. */
	function nameOf(element: Element): string {
		const root = element.getRootNode() as Document | ShadowRoot;
		let parts: string[] = [];

		for (const id of (element.getAttribute("aria-labelledby") ?? "").split(/\s+/)) {
			const label =
				id && typeof root.getElementById === "function" ? root.getElementById(id) : null;

			if (label) {
				parts.push(label.textContent ?? "");
			}
		}

		if (parts.join("").trim() === "") {
			parts = [element.getAttribute("aria-label") ?? ""];
		}

		if (parts.join("").trim() === "") {
			parts = [element.textContent ?? ""];

			for (const named of element.querySelectorAll("img[alt], [aria-label]")) {
				parts.push(named.getAttribute("alt") ?? named.getAttribute("aria-label") ?? "");
			}

			if (element instanceof HTMLInputElement) {
				parts.push(element.value);
			}

			parts.push(element.getAttribute("title") ?? "");
		}

		return parts.join(" ").replace(/\s+/g, " ").trim();
	}

	function isTextEntry(element: Element): boolean {
		if (role(element) === "combobox" || element instanceof HTMLTextAreaElement) {
			return true;
		}

		if (element instanceof HTMLInputElement) {
			return !["button", "checkbox", "radio"].includes(element.type);
		}

		return element instanceof HTMLElement && element.isContentEditable;
	}

	function isDisabled(element: Element): boolean {
		return (
			(element as HTMLButtonElement).disabled === true ||
			element.getAttribute("aria-disabled") === "true" ||
			element.closest("[inert]") !== null ||
			element.closest("fieldset[disabled]") !== null
		);
	}

	function isButtonLike(element: Element): boolean {
		const tag = element.localName;

		return (
			tag === "button" ||
			role(element) === "button" ||
			role(element) === "menuitem" ||
			(element instanceof HTMLInputElement && element.type === "button") ||
			(tag === "a" && !navigates(element)) ||
			element.hasAttribute("tabindex")
		);
	}

	/** Whether `element` declares itself a disclosure trigger. */
	function isTrigger(element: Element): boolean {
		const tag = element.localName;

		if (tag === "details" || tag === "summary" || tag === "select" || tag === "option") {
			return false;
		}

		if (element.hasAttribute("aria-expanded")) {
			return true;
		}

		if (!options.includeControlsOnly || !element.hasAttribute("aria-controls")) {
			return false;
		}

		// With no expanded state, only a button whose target is not on show can be a disclosure.
		// A dialog's opener is not one: a dialog has no expanded state to report.
		const elementRole = role(element);
		const popup = element.getAttribute("aria-haspopup");

		if (
			(elementRole !== null && NOT_A_DISCLOSURE.has(elementRole)) ||
			popup === "dialog" ||
			!isButtonLike(element) ||
			isTextEntry(element)
		) {
			return false;
		}

		const targets = controlled(element);

		return targets.length > 0 && targets.every((target) => !isShown(target));
	}

	function skipReason(element: Element): DisclosureSkipReason | null {
		if (!isShown(element)) {
			return "hidden";
		}

		if (isDisabled(element)) {
			return "disabled";
		}

		if (isCheckable(element)) {
			return "checkable";
		}

		if (isTextEntry(element)) {
			return "text-entry";
		}

		const elementRole = role(element);

		if (elementRole !== null && COMPOSITE_ITEM.has(elementRole)) {
			return "composite-item";
		}

		if (navigates(element)) {
			return "navigating-link";
		}

		if (submits(element)) {
			return "submits-form";
		}

		if (riskyName?.test(nameOf(element))) {
			return "risky-name";
		}

		const focusable = element instanceof HTMLElement && element.tabIndex >= 0;

		if (!focusable && !element.hasAttribute("tabindex") && element.querySelector(FOCUSABLE)) {
			return "state-on-container";
		}

		return null;
	}

	function html(element: Element): string {
		return element.outerHTML.slice(0, HTML_LIMIT);
	}

	const eligible: Element[] = [];
	const skippedElements: Element[] = [];
	const skipped: CollectedSkip[] = [];
	let skippedTotal = 0;

	for (const element of everyElement(document, [])) {
		if (!isTrigger(element)) {
			continue;
		}

		const reason = skipReason(element);

		if (reason === null) {
			eligible.push(element);
			continue;
		}

		skippedTotal++;

		if (skipped.length < skipLimit) {
			skipped.push({ html: html(element), reason });
			skippedElements.push(element);
		}
	}

	// Past the limit, take an even sample so a long page is covered from top to bottom.
	const sampled =
		eligible.length <= triggerLimit
			? eligible
			: Array.from(
					{ length: triggerLimit },
					(_, i) => eligible[Math.floor((i * eligible.length) / triggerLimit)]!,
				);

	const store = window as unknown as Record<string, unknown>;

	store[stashKey] = [...sampled, ...skippedElements];
	store[`${stashKey}Controls`] = sampled.map((trigger) => controlled(trigger)[0] ?? null);

	function deepActiveElement(): Element | null {
		let active = document.activeElement;

		while (active?.shadowRoot?.activeElement) {
			active = active.shadowRoot.activeElement;
		}

		return active;
	}

	const originalFocus = deepActiveElement();
	const originalScroll = { x: window.scrollX, y: window.scrollY };

	let baseline: Set<Element> | null = null;
	let scroll = originalScroll;
	let current: Element | null = null;
	let focusAtBegin: Element | null = null;
	let clicks = 0;
	let geometry = "";
	const blocked = { submits: 0, navigations: 0 };

	// Nothing a trigger does may send a form or leave the page while the audit is running.
	const onSubmit = (event: Event): void => {
		event.preventDefault();
		event.stopImmediatePropagation();
		blocked.submits++;
	};

	// A click the browser delivers, as it does when Enter or Space activates a button.
	const onClick = (event: Event): void => {
		if (event.isTrusted && current !== null && event.composedPath().includes(current)) {
			clicks++;
		}
	};

	type NavigateEventLike = Event & {
		hashChange?: boolean;
		destination?: { sameDocument?: boolean };
	};

	const onNavigate = (event: NavigateEventLike): void => {
		// Fragment and history-state changes stay in the document, so they are let through.
		if (event.hashChange || event.destination?.sameDocument || !event.cancelable) {
			return;
		}

		event.preventDefault();
		blocked.navigations++;
	};

	const navigation = (window as unknown as { navigation?: EventTarget }).navigation;
	const formPrototype = typeof HTMLFormElement === "function" ? HTMLFormElement.prototype : null;
	const originalSubmit = formPrototype?.submit;
	const originalRequestSubmit = formPrototype?.requestSubmit;

	window.addEventListener("submit", onSubmit, true);
	window.addEventListener("click", onClick, true);
	navigation?.addEventListener("navigate", onNavigate);

	if (formPrototype) {
		formPrototype.submit = function submit(): void {
			blocked.submits++;
		};

		if (originalRequestSubmit) {
			formPrototype.requestSubmit = function requestSubmit(): void {
				blocked.submits++;
			};
		}
	}

	function unblock(): void {
		window.removeEventListener("submit", onSubmit, true);
		window.removeEventListener("click", onClick, true);
		navigation?.removeEventListener("navigate", onNavigate);

		if (formPrototype && originalSubmit) {
			formPrototype.submit = originalSubmit;
		}

		if (formPrototype && originalRequestSubmit) {
			formPrototype.requestSubmit = originalRequestSubmit;
		}
	}

	/** The boxes of the trigger's `aria-controls` targets, to tell when one is still changing size. */
	function geometryOf(targets: readonly Element[]): string {
		return targets
			.map((target) => {
				const rect = target.getBoundingClientRect();

				return `${Math.round(rect.width)}x${Math.round(rect.height)}`;
			})
			.join(",");
	}

	/** Whether a transition or an animation that will end is running on the trigger's content. */
	function inMotion(trigger: Element, targets: readonly Element[]): boolean {
		if (typeof document.getAnimations !== "function") {
			return false;
		}

		for (const animation of document.getAnimations()) {
			const effect = animation.effect as KeyframeEffect | null;
			const timing = effect?.getComputedTiming?.();

			// An endless animation, such as a spinner, never settles and is not waited for.
			if (
				animation.playState !== "running" ||
				!timing ||
				timing.iterations === Number.POSITIVE_INFINITY
			) {
				continue;
			}

			const target = effect?.target ?? null;

			if (
				target === null ||
				targets.length === 0 ||
				trigger.contains(target) ||
				targets.some((controlled) => controlled.contains(target) || target.contains(controlled))
			) {
				return true;
			}
		}

		return false;
	}

	/** A shown modal dialog that the trigger is not part of: whatever is pressed would land in it. */
	function behindModal(trigger: Element): boolean {
		for (const modal of document.querySelectorAll("dialog[open], [aria-modal=true]")) {
			if (modal.contains(trigger)) {
				continue;
			}

			if (modal.localName !== "dialog") {
				if (isShown(modal)) {
					return true;
				}

				continue;
			}

			try {
				if (modal.matches(":modal")) {
					return true;
				}
			} catch {
				// An engine without :modal: an open dialog is taken to be modeless.
			}
		}

		return false;
	}

	function shownOutside(trigger: Element): Element[] | null {
		const elements = everyElement(document.body ?? document, []);

		if (elements.length > scanLimit) {
			return null;
		}

		// Across the whole page only being rendered counts, not where. A carousel or ticker moves
		// its slides in and out of the document for ever, and counting those as content that
		// appeared would put down to a key press what the page did by itself. Content that is moved
		// into view is still seen where `aria-controls` names it.
		return elements.filter((element) => !trigger.contains(element) && isShown(element, true));
	}

	function read(index: number): DisclosureReading {
		const trigger = sampled[index]!;
		const targets = controlled(trigger);
		let appeared: number | null = null;
		let disappeared: number | null = null;

		if (baseline !== null) {
			const now = shownOutside(trigger);

			if (now !== null) {
				const seen = new Set(now);

				appeared = now.filter((element) => !baseline!.has(element)).length;
				disappeared = [...baseline].filter((element) => !seen.has(element)).length;
			}
		}

		const nowGeometry = geometryOf(targets);
		const resized = nowGeometry !== geometry;

		geometry = nowGeometry;

		return {
			connected: trigger.isConnected,
			expanded: trigger.getAttribute("aria-expanded"),
			controlled: targets.length > 0 ? targets.some((target) => isShown(target)) : null,
			appeared,
			disappeared,
			focused: deepActiveElement() === trigger,
			settling: resized || inMotion(trigger, targets),
			clicks,
			blocked: { ...blocked },
		};
	}

	function pointer(target: Element, types: readonly string[], bubbles: boolean): void {
		for (const type of types) {
			const init = { bubbles, cancelable: true, composed: true };

			target.dispatchEvent(
				type.startsWith("pointer") && typeof PointerEvent === "function"
					? new PointerEvent(type, init)
					: new MouseEvent(type, init),
			);
		}
	}

	const api: DisclosureApi = {
		begin(index) {
			const trigger = sampled[index]!;
			const shown = shownOutside(trigger);

			scroll = { x: window.scrollX, y: window.scrollY };
			baseline = shown === null ? null : new Set(shown);
			current = trigger;
			focusAtBegin = deepActiveElement();
			clicks = 0;
			blocked.submits = 0;
			blocked.navigations = 0;
			geometry = geometryOf(controlled(trigger));

			return read(index);
		},

		focus(index) {
			const trigger = sampled[index]!;

			if (trigger instanceof HTMLElement || trigger instanceof SVGElement) {
				trigger.focus({ preventScroll: true });
			}

			return deepActiveElement() === trigger;
		},

		read,

		ready(index, action) {
			const trigger = sampled[index]!;

			if (!trigger.isConnected || trigger.closest("[inert]") !== null || behindModal(trigger)) {
				return false;
			}

			const active = deepActiveElement();

			if (action === "key") {
				return active === trigger;
			}

			// A click is safe while focus is where the audit left it: on the trigger, or wherever it
			// was before a trigger that cannot take focus was begun.
			return (
				active === trigger || active === null || active === document.body || active === focusAtBegin
			);
		},

		blur(index) {
			const trigger = sampled[index]!;

			if (trigger instanceof HTMLElement || trigger instanceof SVGElement) {
				trigger.blur();
			}
		},

		click(index) {
			const trigger = sampled[index]!;

			if (trigger instanceof HTMLElement) {
				trigger.click();
			} else {
				pointer(trigger, ["click"], true);
			}
		},

		hover(index, on) {
			const trigger = sampled[index]!;

			pointer(trigger, on ? ["pointerover", "mouseover"] : ["pointerout", "mouseout"], true);

			// Enter and leave events do not bubble: the browser fires one on each ancestor the pointer
			// crosses into, and a menu usually listens on the item around its trigger.
			for (let target: Element | null = trigger; target; target = target.parentElement) {
				pointer(
					target,
					on ? ["pointerenter", "mouseenter"] : ["pointerleave", "mouseleave"],
					false,
				);
			}
		},

		end() {
			baseline = null;
			current = null;
			window.scrollTo(scroll.x, scroll.y);
		},

		finish() {
			const active = deepActiveElement();

			if (
				originalFocus?.isConnected &&
				originalFocus !== document.body &&
				(originalFocus instanceof HTMLElement || originalFocus instanceof SVGElement)
			) {
				originalFocus.focus({ preventScroll: true });
			} else if (active instanceof HTMLElement && active !== document.body) {
				active.blur();
			}

			window.scrollTo(originalScroll.x, originalScroll.y);

			unblock();

			delete store[`${stashKey}Api`];
		},
	};

	store[`${stashKey}Api`] = api;

	return {
		triggers: sampled.map((trigger) => ({
			html: html(trigger),
			role: role(trigger),
			expanded: trigger.getAttribute("aria-expanded"),
			hasControlled: controlled(trigger).length > 0,
			inTabOrder: trigger instanceof HTMLElement && trigger.tabIndex >= 0,
			inComposite: trigger.closest(COMPOSITE) !== null,
			spaceExpected: trigger.localName === "button" || role(trigger) === "button",
			link: trigger.localName === "a" && trigger.hasAttribute("href"),
		})),
		skipped,
		skippedTotal,
		eligible: eligible.length,
	};
}

/**
 * Call one of the functions installDisclosureScript left on the page. Answers `{ gone: true }` when
 * they are no longer there, which means the document was replaced.
 */
export function callDisclosureScript(
	stashKey: string,
	method: keyof DisclosureApi,
	...args: unknown[]
): unknown {
	const api = (window as unknown as Record<string, unknown>)[`${stashKey}Api`] as
		| Record<string, (...args: unknown[]) => unknown>
		| undefined;

	if (!api) {
		return { gone: true } satisfies DisclosureGone;
	}

	return api[method]!(...args) ?? null;
}

/** Whether the functions installDisclosureScript left on the page are still there. */
export function isDisclosureInstalledScript(stashKey: string): boolean {
	return `${stashKey}Api` in window;
}
