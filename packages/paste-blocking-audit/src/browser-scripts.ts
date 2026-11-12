/**
 * IMPORTANT: Functions in this file are serialized and injected into the audited page, so they must
 * not reference any symbols outside their own scope.
 */

/** What an authentication field takes. `new-password` is a password being chosen or confirmed. */
export type AuthFieldKind = "password" | "new-password" | "username" | "one-time-code";

/**
 * A way the page refused a paste: it cancelled the `paste` event, cancelled the `beforeinput`
 * event for a paste, or cancelled the Ctrl+V or Cmd+V key press.
 */
export type BlockMechanism = "paste" | "beforeinput" | "shortcut";

/**
 * Something the page tried to do while a field was being pasted into: submit a form (`submit`), or
 * send a request with `fetch`, `XMLHttpRequest` or `navigator.sendBeacon` (`request`).
 */
export type SuppressedAction = "submit" | "request";

export type InspectedField = {
	kind: AuthFieldKind;
	/** Shallow outerHTML. */
	html: string;
	/** The field's own `autocomplete`, lower-cased, or its form's when it has none. Null if unset. */
	autocomplete: string | null;
	/** Every way the page refused the paste, with the field left unchanged. */
	blocked: BlockMechanism[];
	/** An `onpaste` attribute on the field or an ancestor, as opposed to a script's listener. */
	inlineHandler: boolean;
	/** The page put the pasted text into the field itself. */
	handled: boolean;
	/** The field was `readonly` until it was focused. */
	readonlyUntilFocus: boolean;
	/** How many single-character boxes the field is split into, or 0 for an ordinary field. */
	boxes: number;
	/** A lone password field in a form whose submit button says "sign in" or "log in". */
	signIn: boolean;
	/**
	 * The pasted text was a digit short of what the field takes, as it is for a one-time code or a
	 * numeric PIN, so that the page cannot take it for a complete value and send it.
	 */
	partialProbe: boolean;
	/** What the page tried to do in response to the paste, and was stopped from doing. */
	suppressed: SuppressedAction[];
};

export type AuthFieldInspection = {
	fields: InspectedField[];
	/** Every authentication field, including those past the limit. */
	total: number;
};

/**
 * Find every rendered password, username and one-time-code field, descending open shadow roots,
 * and paste into each with synthetic events to see whether the page refuses. Any value the page
 * writes in response is put back, including one written a moment later, and focus is returned to
 * where it was. While the fields are pasted into, form submission and requests made with `fetch`,
 * `XMLHttpRequest` and `sendBeacon` are stopped, and a one-time code is pasted a digit short, so
 * the page cannot send the pasted text anywhere. The inspected elements are left on
 * `window[stashKey]`, in the same order.
 */
export async function inspectAuthFieldsScript(
	stashKey: string,
	fieldLimit: number,
): Promise<AuthFieldInspection> {
	const TEXT_TYPES = new Set(["text", "tel", "number", "email", "password", "search", "url"]);
	const USERNAME_TYPES = new Set(["text", "email", "tel"]);

	const CODE_HINT =
		/\b(otp|totp|2fa|mfa|one time|verification code|verify code|auth code|authentication code|passcode|pass code|sms code|\d+ digit code)\b/;
	const NOT_A_SIGN_IN_CODE =
		/\b(post|postal|postcode|zip|promo|coupon|discount|voucher|gift|country|area|referral|invite|card|cvv|cvc|product|sku|tracking|order|dial)\b/;
	const USERNAME_HINT = /\b(user|username|email|e mail|login|account|phone|mobile)\b/;
	const SIGN_IN = /\b(sign in|log in|login|signin)\b/;

	// How long a cancelled paste is given for the page to write the text in itself.
	const REFUSAL_WAIT_MS = 150;
	const POLL_MS = 25;
	// How long after the last paste the fields are looked at again for a value written late.
	const FINAL_SETTLE_MS = 300;
	const RECHECK_MS = 100;

	const isRendered = (el: Element): boolean =>
		typeof el.checkVisibility === "function"
			? el.checkVisibility({ visibilityProperty: true })
			: el.getClientRects().length > 0;

	const words = (text: string): string =>
		text
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, " ")
			.trim();

	const inputsIn = (root: Document | ShadowRoot): HTMLInputElement[][] => {
		const groups: HTMLInputElement[][] = [];
		const own: HTMLInputElement[] = [];

		for (const el of root.querySelectorAll("*")) {
			if (el instanceof HTMLInputElement) {
				const type = el.type.toLowerCase();

				if (TEXT_TYPES.has(type) && !el.disabled && isRendered(el)) {
					own.push(el);
				}
			}

			if (el.shadowRoot) {
				groups.push(...inputsIn(el.shadowRoot));
			}
		}

		return [own, ...groups];
	};

	const scopeOf = (el: HTMLInputElement): Node =>
		el.form ??
		el.closest("[role=form], fieldset, dialog, [role=dialog], section, main") ??
		el.getRootNode();

	const autocompleteOf = (el: HTMLInputElement): string | null => {
		const own = el.getAttribute("autocomplete")?.trim().toLowerCase();

		if (own) {
			return own;
		}

		return el.form?.getAttribute("autocomplete")?.trim().toLowerCase() || null;
	};

	const hintOf = (el: HTMLInputElement): string => {
		const labels = Array.from(el.labels ?? [], (label) => label.textContent ?? "");

		return words(
			[
				el.name,
				el.id,
				el.getAttribute("placeholder"),
				el.getAttribute("aria-label"),
				el.getAttribute("title"),
				...labels,
			].join(" "),
		);
	};

	const isNumeric = (el: HTMLInputElement): boolean => {
		const pattern = el.getAttribute("pattern") ?? "";

		return (
			el.getAttribute("inputmode")?.toLowerCase() === "numeric" ||
			el.type === "number" ||
			el.type === "tel" ||
			pattern.includes("\\d") ||
			pattern.includes("0-9")
		);
	};

	const isCodeField = (el: HTMLInputElement): boolean => {
		const autocomplete = autocompleteOf(el) ?? "";

		if (autocomplete.split(/\s+/).includes("one-time-code")) {
			return true;
		}

		if (el.type === "password" || el.type === "email" || autocomplete.startsWith("cc-")) {
			return false;
		}

		const hint = hintOf(el);

		if (NOT_A_SIGN_IN_CODE.test(hint)) {
			return false;
		}

		return CODE_HINT.test(hint) || (isNumeric(el) && /\bcode\b/.test(hint));
	};

	const signInScope = (scope: Node): boolean => {
		if (!(scope instanceof Element)) {
			return false;
		}

		const buttons = scope.querySelectorAll(
			"button, input[type=submit], input[type=button], [role=button]",
		);

		return Array.from(buttons).some((button) =>
			SIGN_IN.test(
				words(button instanceof HTMLInputElement ? button.value : (button.textContent ?? "")),
			),
		);
	};

	type Candidate = {
		el: HTMLInputElement;
		kind: AuthFieldKind;
		boxes: HTMLInputElement[];
		signIn: boolean;
	};

	const candidates: Candidate[] = [];

	for (const inputs of inputsIn(document)) {
		const taken = new Set<HTMLInputElement>();

		// A run of four or more single-character boxes is a split code entry, reported at its first box.
		for (let start = 0; start < inputs.length; start++) {
			let end = start;

			while (end < inputs.length && inputs[end]!.maxLength === 1) {
				end++;
			}

			if (end - start >= 4) {
				const boxes = inputs.slice(start, end);

				for (const box of boxes) {
					taken.add(box);
				}

				candidates.push({ el: boxes[0]!, kind: "one-time-code", boxes, signIn: false });
			}

			start = Math.max(start, end - 1);
		}

		const passwordsByScope = new Map<Node, HTMLInputElement[]>();

		for (const el of inputs) {
			if (el.type === "password") {
				const scope = scopeOf(el);
				passwordsByScope.set(scope, [...(passwordsByScope.get(scope) ?? []), el]);
			}
		}

		for (const el of inputs) {
			if (taken.has(el)) {
				continue;
			}

			const scope = scopeOf(el);
			const passwords = passwordsByScope.get(scope) ?? [];

			if (el.type === "password") {
				const signIn = passwords.length === 1 && signInScope(scope);
				const choosing =
					passwords.length > 1 || (!signIn && (autocompleteOf(el) ?? "").includes("new-password"));

				candidates.push({ el, kind: choosing ? "new-password" : "password", boxes: [el], signIn });
			} else if (isCodeField(el)) {
				candidates.push({ el, kind: "one-time-code", boxes: [el], signIn: false });
			} else if (passwords.length > 0 && USERNAME_TYPES.has(el.type)) {
				const autocomplete = autocompleteOf(el) ?? "";

				if (
					el.type === "email" ||
					/\b(username|email|tel)\b/.test(autocomplete) ||
					USERNAME_HINT.test(hintOf(el))
				) {
					candidates.push({ el, kind: "username", boxes: [el], signIn: false });
				}
			}
		}
	}

	const setValue = (el: HTMLInputElement, value: string): void => {
		const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;

		if (setter) {
			setter.call(el, value);
		} else {
			el.value = value;
		}

		el.dispatchEvent(new Event("input", { bubbles: true }));
	};

	const pasteEvent = (text: string): Event => {
		const init = { bubbles: true, cancelable: true, composed: true };

		try {
			const data = new DataTransfer();
			data.setData("text/plain", text);

			const event = new ClipboardEvent("paste", { ...init, clipboardData: data });

			if (event.clipboardData?.getData("text/plain") === text) {
				return event;
			}
		} catch {
			// Fall through to a plain event carrying the text.
		}

		const event = new Event("paste", init);
		const clipboardData = { getData: () => text, types: ["text/plain"], items: [], files: [] };
		Object.defineProperty(event, "clipboardData", { value: clipboardData });

		return event;
	};

	const DIGITS = "1234567890123456";

	/** How many characters the field expects, when its markup says. */
	const expectedLength = (candidate: Candidate): number | null => {
		const { el, boxes } = candidate;

		if (boxes.length > 1) {
			return boxes.length;
		}

		if (el.maxLength > 0) {
			return el.maxLength;
		}

		const quantifier = /\{(\d+)(?:,\d*)?\}/.exec(el.getAttribute("pattern") ?? "");
		const said = /\b(\d+) digit\b/.exec(hintOf(el));
		const length = Number(quantifier?.[1] ?? said?.[1] ?? 0);

		return length > 0 ? length : null;
	};

	type Probe = { text: string; partial: boolean };

	/**
	 * The text to paste, shaped to what the field takes so that it is not turned away for being the
	 * wrong kind. A one-time code or numeric PIN is pasted a digit short of its length, or three
	 * digits when the length is unknown, so the page never holds a complete code it could send.
	 */
	const probeFor = (candidate: Candidate): Probe => {
		const { el, kind } = candidate;
		const fit = (text: string): string => (el.maxLength > 0 ? text.slice(0, el.maxLength) : text);

		if (kind === "one-time-code" || (kind !== "username" && isNumeric(el))) {
			const length = expectedLength(candidate) ?? 4;

			return { text: DIGITS.slice(0, Math.max(1, Math.min(length - 1, 16))), partial: true };
		}

		if (kind === "username") {
			return { text: fit(isNumeric(el) ? "5550100" : "probe@example.com"), partial: false };
		}

		return { text: fit("Probe-4f9a-Paste"), partial: false };
	};

	const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

	const waitFor = async (done: () => boolean, ms: number): Promise<void> => {
		const end = performance.now() + ms;

		while (!done() && performance.now() < end) {
			await sleep(POLL_MS);
		}
	};

	const suppressedLog: SuppressedAction[] = [];
	const unhooks: (() => void)[] = [];

	/** Replace a method until the inspection ends, unless the page has swapped it again by then. */
	const hook = (target: object, key: string, replacement: unknown): void => {
		const own = Object.getOwnPropertyDescriptor(target, key);

		try {
			Object.defineProperty(target, key, {
				configurable: true,
				writable: true,
				value: replacement,
			});
		} catch {
			return;
		}

		unhooks.push(() => {
			if ((target as Record<string, unknown>)[key] !== replacement) {
				return;
			}

			if (own) {
				Object.defineProperty(target, key, own);
			} else {
				delete (target as Record<string, unknown>)[key];
			}
		});
	};

	const stopSubmit = (event: Event): void => {
		suppressedLog.push("submit");
		event.preventDefault();
		event.stopImmediatePropagation();
	};

	const guardedForms = new Set<HTMLFormElement>();

	/** `submit` does not cross a shadow root, so a form inside one is guarded directly. */
	const guardForm = (form: HTMLFormElement | null): void => {
		if (form && !guardedForms.has(form)) {
			guardedForms.add(form);
			form.addEventListener("submit", stopSubmit, true);
		}
	};

	/**
	 * Keep the page from sending anything while its fields are pasted into: a handler that submits
	 * or verifies as soon as a field looks complete would otherwise act on the pasted text.
	 */
	const installGuards = (): void => {
		window.addEventListener("submit", stopSubmit, true);
		unhooks.push(() => {
			window.removeEventListener("submit", stopSubmit, true);

			for (const form of guardedForms) {
				form.removeEventListener("submit", stopSubmit, true);
			}
		});

		const noSubmit = (): void => {
			suppressedLog.push("submit");
		};

		if (typeof HTMLFormElement !== "undefined") {
			hook(HTMLFormElement.prototype, "submit", noSubmit);
			hook(HTMLFormElement.prototype, "requestSubmit", noSubmit);
		}

		if (typeof window.fetch === "function") {
			hook(window, "fetch", () => {
				suppressedLog.push("request");

				return Promise.reject(new DOMException("Stopped while the page is audited", "AbortError"));
			});
		}

		if (typeof XMLHttpRequest !== "undefined") {
			hook(XMLHttpRequest.prototype, "send", function (this: XMLHttpRequest) {
				suppressedLog.push("request");

				try {
					this.abort();
				} catch {
					// Not opened: there is nothing to abort.
				}

				setTimeout(() => {
					for (const type of ["error", "loadend"]) {
						this.dispatchEvent(
							typeof ProgressEvent === "function" ? new ProgressEvent(type) : new Event(type),
						);
					}
				}, 0);
			});
		}

		if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
			// Reported as queued, so the page does not fall back to another way of sending.
			hook(navigator, "sendBeacon", () => {
				suppressedLog.push("request");

				return true;
			});
		}
	};

	type Attempt = { blocked: BlockMechanism[]; handled: boolean; suppressed: SuppressedAction[] };

	const restore = (boxes: readonly HTMLInputElement[], originals: readonly string[]): boolean => {
		let restored = false;

		boxes.forEach((box, i) => {
			if (box.value !== originals[i]) {
				setValue(box, originals[i]!);
				restored = true;
			}
		});

		return restored;
	};

	/** The page has put text of its own choosing into the field, as opposed to emptying it. */
	const wroteInto = (boxes: readonly HTMLInputElement[], originals: readonly string[]): boolean =>
		boxes.some((box, i) => box.value !== originals[i] && box.value !== "");

	const attemptPaste = async (
		candidate: Candidate,
		text: string,
		originals: readonly string[],
	): Promise<Attempt> => {
		const { el, boxes } = candidate;
		const wrote = (): boolean => wroteInto(boxes, originals);
		const init = { bubbles: true, cancelable: true, composed: true };
		const mark = suppressedLog.length;

		const blocked: BlockMechanism[] = [];
		let suppressed: SuppressedAction[] = [];
		let handled = false;

		// A refusal only counts once the page has had a moment to write the text in itself.
		const refused = async (event: Event): Promise<boolean> => {
			if (!event.defaultPrevented) {
				return false;
			}

			await waitFor(wrote, REFUSAL_WAIT_MS);

			if (wrote()) {
				handled = true;

				return false;
			}

			return true;
		};

		try {
			for (const modifier of ["ctrlKey", "metaKey"] as const) {
				const press = new KeyboardEvent("keydown", {
					...init,
					key: "v",
					code: "KeyV",
					[modifier]: true,
				});
				el.dispatchEvent(press);

				if ((await refused(press)) && !blocked.includes("shortcut")) {
					blocked.push("shortcut");
				}
			}

			if (!handled) {
				const beforeInput = new InputEvent("beforeinput", {
					...init,
					inputType: "insertFromPaste",
					data: text,
				});
				el.dispatchEvent(beforeInput);

				if (await refused(beforeInput)) {
					blocked.push("beforeinput");
				}
			}

			if (!handled) {
				const paste = pasteEvent(text);
				el.dispatchEvent(paste);

				if (await refused(paste)) {
					blocked.push("paste");
				} else {
					// Split boxes are only handled if the page spreads the code, which it may do in a moment.
					if (boxes.length > 1 && !paste.defaultPrevented) {
						await waitFor(wrote, REFUSAL_WAIT_MS);
					}

					if (wrote()) {
						handled = true;
					}
				}
			}
		} finally {
			// Taken before the values go back, so that what restoring sets off is not counted.
			suppressed = Array.from(new Set(suppressedLog.slice(mark)));
			restore(boxes, originals);
		}

		return handled ? { blocked: [], handled, suppressed } : { blocked, handled, suppressed };
	};

	const withFocus = async <T>(el: HTMLInputElement, run: () => Promise<T>): Promise<T> => {
		const root = el.getRootNode() as Document | ShadowRoot;
		const wasFocused = root.activeElement === el;

		if (!wasFocused) {
			el.focus({ preventScroll: true });

			if (root.activeElement !== el) {
				el.dispatchEvent(new FocusEvent("focus"));
				el.dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
			}
		}

		try {
			return await run();
		} finally {
			if (!wasFocused) {
				el.blur();
			}
		}
	};

	const focusedElement = (): Element | null => {
		let active = document.activeElement;

		while (active?.shadowRoot?.activeElement) {
			active = active.shadowRoot.activeElement;
		}

		return active;
	};

	const focusedBefore = focusedElement();
	let selectionBefore: [number, number, "forward" | "backward" | "none"] | null = null;

	if (focusedBefore instanceof HTMLInputElement || focusedBefore instanceof HTMLTextAreaElement) {
		try {
			const { selectionStart, selectionEnd, selectionDirection } = focusedBefore;

			if (selectionStart !== null && selectionEnd !== null) {
				selectionBefore = [selectionStart, selectionEnd, selectionDirection ?? "none"];
			}
		} catch {
			// Some input types have no selection to read.
		}
	}

	/** Put focus back where it was: a page that moves on to the next box as one fills leaves it elsewhere. */
	const restoreFocus = (): void => {
		const now = focusedElement();

		if (now !== focusedBefore) {
			if (
				focusedBefore instanceof HTMLElement &&
				focusedBefore !== document.body &&
				focusedBefore.isConnected
			) {
				focusedBefore.focus({ preventScroll: true });
			} else if (now instanceof HTMLElement) {
				now.blur();
			}
		}

		if (
			selectionBefore &&
			(focusedBefore instanceof HTMLInputElement || focusedBefore instanceof HTMLTextAreaElement)
		) {
			try {
				focusedBefore.setSelectionRange(...selectionBefore);
			} catch {
				// Some input types have no selection to set.
			}
		}
	};

	type Probed = { boxes: HTMLInputElement[]; originals: string[]; field: InspectedField };

	const elements: Element[] = [];
	const fields: InspectedField[] = [];
	const probed: Probed[] = [];

	installGuards();

	try {
		for (const candidate of candidates.slice(0, fieldLimit)) {
			const { el, boxes } = candidate;
			const probe = probeFor(candidate);
			const originals = boxes.map((box) => box.value);
			const startedReadOnly = el.readOnly;
			const suppressed = new Set<SuppressedAction>();

			let readonlyUntilFocus = false;
			let attempt: Attempt = { blocked: [], handled: false, suppressed: [] };

			const paste = async (): Promise<Attempt> => {
				const result = await attemptPaste(candidate, probe.text, originals);

				for (const action of result.suppressed) {
					suppressed.add(action);
				}

				return result;
			};

			guardForm(el.form);

			if (startedReadOnly) {
				// Only focus can tell a field that is never editable from one a script unlocks on focus.
				attempt = await withFocus(el, async () => {
					readonlyUntilFocus = !el.readOnly;

					return el.readOnly ? attempt : paste();
				});

				el.readOnly = true;
			} else {
				attempt = await paste();

				// A handler that inserts through the selection needs focus, so check a refusal again with it.
				if (attempt.blocked.length > 0) {
					attempt = await withFocus(el, paste);
				}
			}

			const field: InspectedField = {
				kind: candidate.kind,
				html: (el.cloneNode(false) as Element).outerHTML,
				autocomplete: autocompleteOf(el),
				blocked: attempt.blocked,
				inlineHandler: el.closest("[onpaste]") !== null,
				handled: attempt.handled,
				readonlyUntilFocus,
				boxes: boxes.length > 1 ? boxes.length : 0,
				signIn: candidate.signIn,
				partialProbe: probe.partial,
				suppressed: Array.from(suppressed),
			};

			elements.push(el);
			fields.push(field);
			probed.push({ boxes, originals, field });
		}

		// A page may write the pasted text in well after the event, so look once more before leaving:
		// a value that turns up late is put back, and shows that the paste was taken after all.
		if (probed.length > 0) {
			await sleep(FINAL_SETTLE_MS);

			for (let round = 0; round < 2; round++) {
				let restored = false;

				for (const { boxes, originals, field } of probed) {
					if (wroteInto(boxes, originals)) {
						field.handled = true;
						field.blocked = [];
					}

					restored = restore(boxes, originals) || restored;
				}

				if (!restored) {
					break;
				}

				await sleep(RECHECK_MS);
			}
		}
	} finally {
		for (const { boxes, originals } of probed) {
			restore(boxes, originals);
		}

		for (const unhook of unhooks.reverse()) {
			unhook();
		}

		restoreFocus();
	}

	(window as unknown as Record<string, unknown>)[stashKey] = elements;

	return { fields, total: candidates.length };
}
