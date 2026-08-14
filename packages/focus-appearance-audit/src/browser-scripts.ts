/**
 * IMPORTANT: Functions in this file are serialized and injected into the audited page, so they
 * must not reference any symbols outside their own scope. This also means they cannot share code,
 * so any common logic (like descending into shadow roots) must be duplicated.
 */

import type { Rect, StyleSnapshot } from "./detection";

type BaselineElementEntry = {
	index: number;
	/** Position of this element's snapshot in the payload's `styles` table. */
	styleIndex: number;
	/** The element's page-relative rect in its unfocused (baseline) state. */
	rect: Rect;
};

/**
 * The baseline as a table of unique style snapshots plus per-element entries referencing them.
 * Elements overwhelmingly share identical snapshots (same classes), so interning keeps the
 * serialised payload O(unique styles) instead of O(elements × style size).
 */
export type BaselinePayload = {
	styles: StyleSnapshot[];
	entries: BaselineElementEntry[];
};

/**
 * Find up to `limit` focusable elements and mark them with `markerAttr` and a unique index. Then
 * return a snapshot of their styles to use as a baseline.
 */
export function baselineScript(
	props: string[],
	markerAttr: string,
	limit: number,
): BaselinePayload {
	// Bound oversized computed values (data-URI background images can run to hundreds of KB)
	// while preserving inequality via the length and a fingerprint of the full value. Must be
	// byte-identical to the copy in probeActiveElementScript, or every oversized value would
	// "change" on focus and produce a false style-check pass.
	const truncateValue = (value: string): string => {
		if (value.length <= 512) {
			return value;
		}

		let hash = 5381;

		for (let i = 0; i < value.length; i++) {
			hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0;
		}

		return `${value.slice(0, 512)}#len=${value.length}#h=${hash.toString(36)}`;
	};

	const snapshot = (el: Element): StyleSnapshot => {
		const read = (pseudo: string | undefined): Record<string, string> => {
			const cs = getComputedStyle(el, pseudo);
			const out: Record<string, string> = {};

			for (const prop of props) {
				out[prop] = truncateValue(cs.getPropertyValue(prop));
			}

			if (pseudo) {
				out.content = truncateValue(cs.getPropertyValue("content"));
			}

			return out;
		};

		return {
			element: read(undefined),
			before: read("::before"),
			after: read("::after"),
		};
	};

	const candidates: Element[] = [];
	const focusableSelector = [
		"a[href]",
		"button",
		"input",
		"select",
		"textarea",
		"[tabindex]",
		'[contenteditable=""]',
		'[contenteditable="true"]',
	].join(", ");

	// Collect focusable candidates in document order, descending into open shadow roots.
	const collect = (root: Document | ShadowRoot): void => {
		for (const el of Array.from(root.querySelectorAll("*"))) {
			if (el.matches(focusableSelector)) {
				candidates.push(el);
			}

			if (el.shadowRoot) {
				collect(el.shadowRoot);
			}
		}
	};

	collect(document);

	const styles: StyleSnapshot[] = [];
	const styleIndexByKey = new Map<string, number>();
	const entries: BaselineElementEntry[] = [];
	let idx = 0;

	for (const el of candidates) {
		if (idx >= limit) {
			break;
		}

		if (el.hasAttribute("disabled")) {
			// Skip disabled elements
			continue;
		}

		if ((el as HTMLElement).tabIndex < 0) {
			// Skip elements that are focusable but not in the tab order (negative
			// tabindex). The audit tabs through the page, so it never lands on them,
			// and counting them would waste the element-limit budget.
			continue;
		}

		// Skip non-visible elements so they don't consume the marker budget (e.g.
		// links inside a closed mega-menu). checkVisibility sees hiding applied by
		// ancestors, which per-element computed styles don't (`display` doesn't
		// inherit); fall back to the element's own styles where it's unavailable.
		const visibilityCheck = el as Element & {
			checkVisibility?: (options?: { checkVisibilityCSS?: boolean }) => boolean;
		};

		if (typeof visibilityCheck.checkVisibility === "function") {
			if (!visibilityCheck.checkVisibility({ checkVisibilityCSS: true })) {
				continue;
			}
		} else {
			const cs = getComputedStyle(el);

			if (cs.display === "none" || cs.visibility === "hidden") {
				continue;
			}
		}

		// Mark before measuring: the probe reads styles and rects while the marker
		// is present, so the baseline must be captured in the same DOM state.
		el.setAttribute(markerAttr, String(idx));

		const rect = el.getBoundingClientRect();

		// Intern the snapshot: the JSON key is deterministic because every
		// snapshot is built with the same property insertion order.
		const snap = snapshot(el);
		const key = JSON.stringify(snap);
		let styleIndex = styleIndexByKey.get(key);

		if (styleIndex === undefined) {
			styleIndex = styles.length;
			styles.push(snap);
			styleIndexByKey.set(key, styleIndex);
		}

		entries.push({
			index: idx,
			styleIndex,
			rect: {
				x: rect.left + window.scrollX,
				y: rect.top + window.scrollY,
				width: rect.width,
				height: rect.height,
			},
		});
		idx++;
	}

	return { styles, entries };
}

export type ActiveElementBase = {
	index: number | null;
	isBody: boolean;
	/**
	 * The focused element is an <iframe>. Tabbing into a frame passes focus into
	 * its embedded document, but the parent's document.activeElement is the frame
	 * element itself, so the loop uses this to skip the frame as a tab stop.
	 */
	isIframe: boolean;
	html: string;
	styles: StyleSnapshot;
	rect: Rect;
};

/**
 * Read the currently focused element (descending open shadow roots), returning
 * its marker index, opening-tag HTML (marker attribute stripped), focus-relevant
 * styles, and page-relative rect.
 */
export function probeActiveElementScript(
	props: string[],
	markerAttr: string,
): ActiveElementBase {
	let el = document.activeElement;

	while (el?.shadowRoot?.activeElement) {
		el = el.shadowRoot.activeElement;
	}

	if (!el || el === document.body) {
		return {
			index: null,
			isBody: true,
			isIframe: false,
			html: "",
			styles: { element: {}, before: {}, after: {} },
			rect: { x: 0, y: 0, width: 0, height: 0 },
		};
	}

	// Must be byte-identical to the copy in baselineScript: snapshots from the two scripts are
	// compared for equality, so they have to truncate oversized values the same way.
	const truncateValue = (value: string): string => {
		if (value.length <= 512) {
			return value;
		}

		let hash = 5381;

		for (let i = 0; i < value.length; i++) {
			hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0;
		}

		return `${value.slice(0, 512)}#len=${value.length}#h=${hash.toString(36)}`;
	};

	const read = (pseudo: string | undefined): Record<string, string> => {
		const cs = getComputedStyle(el as Element, pseudo);
		const out: Record<string, string> = {};

		for (const prop of props) {
			out[prop] = truncateValue(cs.getPropertyValue(prop));
		}

		if (pseudo) {
			out.content = truncateValue(cs.getPropertyValue("content"));
		}

		return out;
	};

	const idxAttr = el.getAttribute(markerAttr);
	const rect = el.getBoundingClientRect();

	// Shallow clone so only the opening tag is serialised, not the whole subtree;
	// drop the internal marker attribute so it never leaks into the snippet.
	const openingTag = el.cloneNode(false) as Element;
	openingTag.removeAttribute(markerAttr);

	return {
		index: idxAttr === null ? null : Number(idxAttr),
		isBody: false,
		isIframe: el.tagName === "IFRAME",
		html: openingTag.outerHTML,
		styles: {
			element: read(undefined),
			before: read("::before"),
			after: read("::after"),
		},
		rect: {
			x: rect.left + window.scrollX,
			y: rect.top + window.scrollY,
			width: rect.width,
			height: rect.height,
		},
	};
}

/**
 * Return the focused element
 */
export function activeElementHandleScript(): Element | null {
	let el = document.activeElement;

	while (el?.shadowRoot?.activeElement) {
		el = el.shadowRoot.activeElement;
	}

	return el;
}

/**
 * Get the page scroll dimensions
 */
export function pageDimensionsScript(): { width: number; height: number } {
	return {
		width: document.documentElement.scrollWidth,
		height: document.documentElement.scrollHeight,
	};
}

/**
 * The element's page-relative bounding rect
 */
export function elementRectScript(el: Element | null): Rect {
	if (!el) {
		return { x: 0, y: 0, width: 0, height: 0 };
	}

	const rect = el.getBoundingClientRect();

	return {
		x: rect.left + window.scrollX,
		y: rect.top + window.scrollY,
		width: rect.width,
		height: rect.height,
	};
}

/**
 * Whether something unrelated (e.g. a fixed cookie banner) covers the element's centre point, so
 * a screenshot of the element's box would show the covering element instead.
 */
export function isCenterObscuredScript(el: Element | null): boolean {
	if (!el) {
		return false;
	}

	const rect = el.getBoundingClientRect();
	const x = Math.min(
		Math.max(rect.left + rect.width / 2, 0),
		window.innerWidth - 1,
	);
	const y = Math.min(
		Math.max(rect.top + rect.height / 2, 0),
		window.innerHeight - 1,
	);

	let hit = document.elementFromPoint(x, y);

	// Descend into shadow roots so a hit on a shadow host resolves to the inner element.
	while (hit?.shadowRoot) {
		const inner = hit.shadowRoot.elementFromPoint(x, y);

		if (!inner || inner === hit) {
			break;
		}

		hit = inner;
	}

	if (!hit) {
		return false;
	}

	return hit !== el && !el.contains(hit) && !hit.contains(el);
}

/**
 * Scroll the element to the centre of the viewport, instantly so a screenshot taken immediately
 * afterwards isn't captured mid-animation.
 */
export function scrollToCenterScript(el: Element | null): void {
	el?.scrollIntoView({
		block: "center",
		inline: "nearest",
		behavior: "instant",
	});
}

/**
 * Blur (unfocus) an element
 */
export function blurScript(el: Element | null): void {
	(el as HTMLElement | null)?.blur();
}

/**
 * Focus an element
 */
export function focusScript(el: Element | null): void {
	(el as HTMLElement | null)?.focus({ preventScroll: true });
}

/**
 * Remove the marker attribute from all elements and blur the active element. This is a best-effort
 * attempt to reset state between audits.
 */
export function clearMarkersScript(markerAttr: string): void {
	const clear = (root: Document | ShadowRoot): void => {
		for (const el of Array.from(root.querySelectorAll(`[${markerAttr}]`))) {
			el.removeAttribute(markerAttr);
		}

		// Descend into any shadow roots to clear markers within them.
		for (const el of Array.from(root.querySelectorAll("*"))) {
			if (el.shadowRoot) {
				clear(el.shadowRoot);
			}
		}
	};

	clear(document);

	(document.activeElement as HTMLElement | null)?.blur();
}

export type MeasureObscuringResult = {
	coveredFraction: number;
	fullyObscured: boolean;
	offscreen: boolean;
	opacity: "opaque" | "semi-transparent" | "unknown";
	obscuredByHtml: string | null;
	/** True when a covering element was marked for selector resolution. */
	hasObscurer: boolean;
};

/**
 * Hit-test whether author-created content entirely hides the focused element.
 * Marks a single covering element with `obscurerAttr` when containment confirms
 * a full cover, so the host can resolve its selector via getSelector.
 */
export function measureObscuringScript(
	el: Element | null,
	obscurerAttr: string,
): MeasureObscuringResult {
	const empty: MeasureObscuringResult = {
		coveredFraction: 0,
		fullyObscured: false,
		offscreen: false,
		opacity: "opaque",
		obscuredByHtml: null,
		hasObscurer: false,
	};

	if (!el) {
		return empty;
	}

	for (const marked of Array.from(
		document.querySelectorAll(`[${obscurerAttr}]`),
	)) {
		marked.removeAttribute(obscurerAttr);
	}

	const rect = el.getBoundingClientRect();
	const left = Math.max(rect.left, 0);
	const top = Math.max(rect.top, 0);
	const right = Math.min(rect.right, window.innerWidth);
	const bottom = Math.min(rect.bottom, window.innerHeight);

	if (right <= left || bottom <= top) {
		return { ...empty, offscreen: true };
	}

	const width = right - left;
	const height = bottom - top;

	const points: Array<{ x: number; y: number }> = [
		{ x: left, y: top },
		{ x: right - 0.5, y: top },
		{ x: left, y: bottom - 0.5 },
		{ x: right - 0.5, y: bottom - 0.5 },
		{ x: left + width / 2, y: top },
		{ x: left + width / 2, y: bottom - 0.5 },
		{ x: left, y: top + height / 2 },
		{ x: right - 0.5, y: top + height / 2 },
		{ x: left + width / 2, y: top + height / 2 },
	];

	if (width > 80 || height > 80) {
		points.push(
			{ x: left + width * 0.25, y: top + height * 0.25 },
			{ x: left + width * 0.75, y: top + height * 0.25 },
			{ x: left + width * 0.25, y: top + height * 0.75 },
			{ x: left + width * 0.75, y: top + height * 0.75 },
		);
	}

	const hitAt = (x: number, y: number): Element | null => {
		const px = Math.min(Math.max(x, 0), window.innerWidth - 1);
		const py = Math.min(Math.max(y, 0), window.innerHeight - 1);
		const stack =
			typeof document.elementsFromPoint === "function"
				? document.elementsFromPoint(px, py)
				: [document.elementFromPoint(px, py)].filter(Boolean);

		for (let candidate of stack as Element[]) {
			while (candidate?.shadowRoot) {
				const inner = candidate.shadowRoot.elementFromPoint(px, py);

				if (!inner || inner === candidate) {
					break;
				}

				candidate = inner;
			}

			if (!candidate) {
				continue;
			}

			if (
				candidate === el ||
				el.contains(candidate) ||
				candidate.contains(el)
			) {
				return null;
			}

			return candidate;
		}

		return null;
	};

	let covered = 0;
	const coverCounts = new Map<Element, number>();

	for (const point of points) {
		const cover = hitAt(point.x, point.y);

		if (cover) {
			covered++;
			coverCounts.set(cover, (coverCounts.get(cover) ?? 0) + 1);
		}
	}

	const coveredFraction = points.length === 0 ? 0 : covered / points.length;

	if (coveredFraction < 1) {
		return {
			...empty,
			coveredFraction,
			fullyObscured: false,
		};
	}

	let topCover: Element | null = null;
	let topCount = 0;

	for (const [candidate, count] of coverCounts) {
		if (count > topCount) {
			topCover = candidate;
			topCount = count;
		}
	}

	if (!topCover) {
		return {
			...empty,
			coveredFraction: 1,
			fullyObscured: false,
			opacity: "unknown",
		};
	}

	const coverRect = topCover.getBoundingClientRect();
	const containsFully =
		coverRect.left <= rect.left &&
		coverRect.top <= rect.top &&
		coverRect.right >= rect.right &&
		coverRect.bottom >= rect.bottom;

	if (!containsFully) {
		// Joint multi-element cover: cannot confirm a single opaque container.
		return {
			coveredFraction: 1,
			fullyObscured: true,
			offscreen: false,
			opacity: "unknown",
			obscuredByHtml: null,
			hasObscurer: false,
		};
	}

	const classifyOpacity = (
		node: Element,
	): "opaque" | "semi-transparent" | "unknown" => {
		const cs = getComputedStyle(node);
		const opacity = Number.parseFloat(cs.opacity);

		if (!Number.isFinite(opacity)) {
			return "unknown";
		}

		if (opacity < 1) {
			return "semi-transparent";
		}

		const bg = cs.backgroundColor;
		const rgba = bg.match(
			/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)(?:\s*,\s*([\d.]+))?\s*\)/,
		);

		if (rgba) {
			const alpha = rgba[4] === undefined ? 1 : Number.parseFloat(rgba[4]);

			if (alpha < 1) {
				return alpha <= 0 ? "semi-transparent" : "semi-transparent";
			}

			return "opaque";
		}

		if (cs.backgroundImage && cs.backgroundImage !== "none") {
			return "unknown";
		}

		return "unknown";
	};

	const opacity = classifyOpacity(topCover);
	const openingTag = topCover.cloneNode(false) as Element;
	openingTag.removeAttribute(obscurerAttr);
	topCover.setAttribute(obscurerAttr, "1");

	return {
		coveredFraction: 1,
		fullyObscured: true,
		offscreen: false,
		opacity,
		obscuredByHtml: openingTag.outerHTML,
		hasObscurer: true,
	};
}

/** Return the element marked as the obscurer, if any. */
export function obscurerHandleScript(): Element | null {
	return document.querySelector("[data-a11y-obscurer]");
}

export function clearObscurerScript(obscurerAttr: string): void {
	for (const marked of Array.from(
		document.querySelectorAll(`[${obscurerAttr}]`),
	)) {
		marked.removeAttribute(obscurerAttr);
	}
}

type ContextObserverState = {
	baselineHref: string;
	openedWindow: boolean;
	submittedForm: boolean;
	/** Elements that received focusin since the last drain. */
	focusIns: Element[];
	softUrlChange: boolean;
	installed: boolean;
};

declare global {
	interface Window {
		__a11yContextObserver?: ContextObserverState;
	}
}

/**
 * Install once: wrap window.open (record + inert stub), capture-phase submit
 * (record + preventDefault), track focusin and soft URL changes.
 */
export function installContextObserverScript(): void {
	if (window.__a11yContextObserver?.installed) {
		return;
	}

	const state: ContextObserverState = {
		baselineHref: location.href,
		openedWindow: false,
		submittedForm: false,
		focusIns: [],
		softUrlChange: false,
		installed: true,
	};

	window.__a11yContextObserver = state;

	const originalOpen = window.open.bind(window);

	window.open = (..._args: Parameters<typeof window.open>) => {
		state.openedWindow = true;

		return {
			closed: true,
			close() {},
			focus() {},
			blur() {},
			opener: null,
			location: { href: "" },
		} as unknown as Window;
	};

	// Keep a reference so tooling does not tree-shake the bind as unused.
	void originalOpen;

	document.addEventListener(
		"submit",
		(event) => {
			state.submittedForm = true;
			event.preventDefault();
			event.stopPropagation();
		},
		true,
	);

	document.addEventListener(
		"focus",
		(event) => {
			const target = event.target;

			// Prefer nodeType: instanceof can be brittle across some embeddings.
			if (target && (target as Node).nodeType === 1) {
				state.focusIns.push(target as Element);
			}
		},
		true,
	);

	const noteSoftNav = (): void => {
		if (location.href !== state.baselineHref) {
			state.softUrlChange = true;
		}
	};

	window.addEventListener("hashchange", noteSoftNav);
	window.addEventListener("popstate", noteSoftNav);

	const wrapHistory = (method: "pushState" | "replaceState"): void => {
		const original = history[method].bind(history);

		history[method] = ((...args: Parameters<History["pushState"]>) => {
			const result = original(...args);
			noteSoftNav();

			return result;
		}) as History["pushState"];
	};

	wrapHistory("pushState");
	wrapHistory("replaceState");
}

export type DrainContextObserverResult = {
	openedWindow: boolean;
	submittedForm: boolean;
	focusRemoved: boolean;
	redirect: "outside" | "same-subtree" | null;
	softUrlChange: boolean;
	navigation: boolean;
	attributedHtml: string | null;
	/** True when an attributed element was marked for selector resolution. */
	hasAttributed: boolean;
};

/**
 * Drain observer signals for the current tab stop and reset per-stop flags.
 * Classification of focus removal / redirection uses the post-Tab settle
 * activeElement and the focusin history from this stop only.
 */
export function drainContextObserverScript(
	markerAttr: string,
): DrainContextObserverResult {
	// Must be a string literal inside this function: it is serialized into the page.
	const attributedAttr = "data-a11y-ctx-attr";

	const empty: DrainContextObserverResult = {
		openedWindow: false,
		submittedForm: false,
		focusRemoved: false,
		redirect: null,
		softUrlChange: false,
		navigation: false,
		attributedHtml: null,
		hasAttributed: false,
	};

	const state = window.__a11yContextObserver;

	if (!state) {
		return empty;
	}

	for (const marked of Array.from(
		document.querySelectorAll(`[${attributedAttr}]`),
	)) {
		marked.removeAttribute(attributedAttr);
	}

	const openedWindow = state.openedWindow;
	const submittedForm = state.submittedForm;
	const softUrlChange = state.softUrlChange;
	const focusIns = state.focusIns.slice();

	state.openedWindow = false;
	state.submittedForm = false;
	state.softUrlChange = false;
	state.focusIns = [];

	let active = document.activeElement;

	while (active?.shadowRoot?.activeElement) {
		active = active.shadowRoot.activeElement;
	}

	const intended =
		focusIns.find(
			(el) => el !== document.body && el !== document.documentElement,
		) ?? null;

	const openingHtml = (node: Element): string => {
		const clone = node.cloneNode(false) as Element;
		clone.removeAttribute(markerAttr);
		clone.removeAttribute(attributedAttr);

		return clone.outerHTML;
	};

	let focusRemoved = false;
	let redirect: "outside" | "same-subtree" | null = null;
	let attributedHtml: string | null = null;
	let hasAttributed = false;

	const bodyOrNone =
		!active || active === document.body || active === document.documentElement;

	if (intended && bodyOrNone) {
		focusRemoved = true;
		attributedHtml = openingHtml(intended);
		intended.setAttribute(attributedAttr, "1");
		hasAttributed = true;
	} else if (intended && active && intended !== active) {
		const composedContains = (ancestor: Element, node: Element): boolean => {
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

				if (current instanceof ShadowRoot) {
					current = current.host;
					continue;
				}

				break;
			}

			return false;
		};

		const same =
			composedContains(intended, active) || composedContains(active, intended);

		redirect = same ? "same-subtree" : "outside";
		attributedHtml = openingHtml(intended);
		intended.setAttribute(attributedAttr, "1");
		hasAttributed = true;
	}

	return {
		openedWindow,
		submittedForm,
		focusRemoved,
		redirect,
		softUrlChange,
		navigation: false,
		attributedHtml,
		hasAttributed,
	};
}

export function attributedHandleScript(): Element | null {
	return document.querySelector("[data-a11y-ctx-attr]");
}

export function clearAttributedScript(): void {
	for (const marked of Array.from(
		document.querySelectorAll("[data-a11y-ctx-attr]"),
	)) {
		marked.removeAttribute("data-a11y-ctx-attr");
	}
}

/**
 * Drop focusin history accumulated after drain (e.g. pixel-diff blur/refocus)
 * so the next tab stop does not mis-attribute F55 or redirects.
 */
export function clearContextFocusInsScript(): void {
	const state = window.__a11yContextObserver;

	if (state) {
		state.focusIns = [];
		state.openedWindow = false;
		state.submittedForm = false;
		state.softUrlChange = false;
	}
}

/** Current location.href for navigation comparison in the host. */
export function locationHrefScript(): string {
	return location.href;
}
