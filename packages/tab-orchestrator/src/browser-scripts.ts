/**
 * IMPORTANT: Functions in this file are serialized and injected into the audited page, so they
 * must not reference any symbols outside their own scope. This also means they cannot share code,
 * so any common logic (like descending into shadow roots) must be duplicated.
 */

import type { Rect } from "./adaptor";
import type { StyleSnapshot } from "./types";

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
