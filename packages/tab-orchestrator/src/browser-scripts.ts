/**
 * IMPORTANT: Functions in this file are serialized and injected into the audited page, so they must
 * not reference any symbols outside their own scope. This also means they cannot share code, so any
 * common logic (like descending into shadow roots) must be duplicated.
 */

import type { Rect } from "@a11y-pulse/browser-adaptor";
import type { StyleSnapshot } from "./types";

export {
	elementRectScript,
	needsCentringScript,
	pageDimensionsScript,
	scrollToCenterScript,
} from "@a11y-pulse/browser-adaptor";

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
	// Bound oversized computed values (data-URI background images can run to hundreds of KB) while
	// preserving inequality via the length and a fingerprint of the full value. Must be
	// byte-identical to the copy in probeActiveElementScript, or every oversized value would "change"
	// on focus and produce a false style-check pass.
	const truncateValue = (value: string): string => {
		const MAX_STYLE_VALUE_LENGTH = 512;

		if (value.length <= MAX_STYLE_VALUE_LENGTH) {
			return value;
		}

		let hash = 5381;

		for (let i = 0; i < value.length; i++) {
			hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0;
		}

		return `${value.slice(0, MAX_STYLE_VALUE_LENGTH)}#len=${value.length}#h=${hash.toString(36)}`;
	};

	const snapshot = (el: Element): StyleSnapshot => {
		const read = (pseudo: string | undefined): Record<string, string> => {
			// No consumer wants styles: skip the computed-style reads altogether.
			if (props.length === 0) {
				return {};
			}

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
			continue;
		}

		if ((el as HTMLElement).tabIndex < 0) {
			// Skip elements that are focusable but not in the tab order (negative tabindex). The audit
			// tabs through the page, so it never lands on them, and counting them would waste the
			// element-limit budget.
			continue;
		}

		// Skip non-visible elements so they don't consume the marker budget (e.g. links inside a closed
		// mega-menu). checkVisibility sees hiding applied by ancestors, which per-element computed
		// styles don't (`display` doesn't inherit); fall back to the element's own styles where it's
		// unavailable.
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

		// Mark before measuring: the probe reads styles and rects while the marker is present, so the
		// baseline must be captured in the same DOM state.
		el.setAttribute(markerAttr, String(idx));

		const rect = el.getBoundingClientRect();

		// Intern the snapshot: the JSON key is deterministic because every snapshot is built with the
		// same property insertion order.
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

/** Every element that can be a sequential focus stop, before tabindex, state and visibility. */
export const TABBABLE_SELECTOR = [
	"a[href]",
	"area[href]",
	"button",
	"input:not([type='hidden'])",
	"select",
	"textarea",
	"iframe",
	"summary",
	"audio[controls]",
	"video[controls]",
	"[tabindex]",
	"[contenteditable]:not([contenteditable='false'])",
].join(", ");

type TabObserverWindow = Window & {
	__a11yPulseTabListener?: (event: KeyboardEvent) => void;
	__a11yPulseLastTab?: KeyboardEvent;
	__a11yPulseFocusListener?: (event: FocusEvent) => void;
	__a11yPulseUnloadListener?: () => void;
	/**
	 * The page has started to leave for another document. Until the new one arrives the old one stays
	 * alive, and in some browsers (Firefox) goes on taking focus, for as long as the server takes.
	 */
	__a11yPulseLeaving?: boolean;
	/** The first element to receive focus since the most recent Tab press. */
	__a11yPulseFocusedSinceTab?: Element | null;
	/**
	 * When the last short timer the page has set since the most recent Tab press comes due, on the
	 * `performance.now()` clock. 0 when it has set none.
	 */
	__a11yPulseTimerDue?: number;
	/** The latest due time, since the most recent Tab press, of a short timer whose callback has run. */
	__a11yPulseTimerRan?: number;
	/**
	 * The page's `setTimeout` as the observer found it, and what it put in its place. `live` goes
	 * false at teardown, after which the wrapper does nothing but call through: a page that wrapped
	 * `setTimeout` again during the session keeps the observer's wrapper in its chain for good.
	 */
	__a11yPulseTimers?: {
		original: typeof window.setTimeout;
		wrapped: typeof window.setTimeout;
		live: boolean;
	};
};

/**
 * Keep the most recent Tab key event, and the first element focused after it. The listeners sit on
 * the window in the capture phase, so the page cannot stop them seeing the events, and
 * `defaultPrevented` is read once dispatch has finished.
 *
 * Also note when the timers the page sets come due, so that `settleScript` can wait for exactly the
 * ones a focus handler deferred its work to rather than for a fixed time after every press.
 */
export function installTabObserverScript(): void {
	const win = window as TabObserverWindow;

	if (win.__a11yPulseTabListener) {
		return;
	}

	win.__a11yPulseTabListener = (event) => {
		if (event.key === "Tab") {
			win.__a11yPulseLastTab = event;
			win.__a11yPulseFocusedSinceTab = null;
			win.__a11yPulseTimerDue = 0;
			win.__a11yPulseTimerRan = 0;
		}
	};

	try {
		const original = window.setTimeout;
		const timers = { original, wrapped: original, live: true };
		const wrapped = ((...args: Parameters<typeof window.setTimeout>) => {
			if (!timers.live) {
				return original.apply(window, args);
			}

			let owned = false;

			try {
				// A short timer belongs to an element only when there is evidence that the element set
				// it: it was set while that element's focus event was being dispatched, or from inside
				// a timer that already belongs to it (see the context observer). A timer the page set
				// for reasons of its own (a poll loop re-arming itself, a session-expiry countdown)
				// belongs to nobody, whatever happens to be focused when it is set.
				const callback = args[0] as unknown;
				const observer = window.__a11yContextObserver;
				const owner = observer ? (observer.timerOwner ?? observer.dispatchOwner) : null;

				if (observer && owner && typeof callback === "function" && (Number(args[1]) || 0) <= 1000) {
					owned = true;
					args[0] = function (this: unknown, ...rest: unknown[]) {
						const current = window.__a11yContextObserver;
						const previous = current?.timerOwner ?? null;

						if (current) {
							current.timerOwner = owner;
						}

						try {
							return (callback as (...values: unknown[]) => unknown).apply(this, rest);
						} finally {
							if (current) {
								current.timerOwner = previous;
							}
						}
					} as (...values: unknown[]) => void;
				}
			} catch {}

			const delay = Number(args[1]) || 0;
			const due = performance.now() + delay;

			try {
				const callback = args[0] as unknown;

				// A timer's due time can pass before its callback runs, so the settle is told when it
				// has actually run.
				if (delay <= 1000 && typeof callback === "function") {
					args[0] = function (this: unknown, ...rest: unknown[]) {
						try {
							return (callback as (...values: unknown[]) => unknown).apply(this, rest);
						} finally {
							win.__a11yPulseTimerRan = Math.max(win.__a11yPulseTimerRan ?? 0, due);

							const observer = owned ? window.__a11yContextObserver : undefined;

							if (observer) {
								observer.ownedRan = Math.max(observer.ownedRan, due);
							}
						}
					} as (...values: unknown[]) => void;
				}
			} catch {}

			const id = original.apply(window, args);

			try {
				// Anything longer is out of reach of any settle delay, and not worth tracking.
				if (delay <= 1000) {
					win.__a11yPulseTimerDue = Math.max(win.__a11yPulseTimerDue ?? 0, due);

					const observer = window.__a11yContextObserver;

					if (owned && observer) {
						observer.ownedDue = Math.max(observer.ownedDue, due);
					}
				}
			} catch {}

			return id;
		}) as typeof window.setTimeout;

		timers.wrapped = wrapped;
		window.setTimeout = wrapped;
		win.__a11yPulseTimers = timers;
	} catch {
		// A page that has locked its timers down just gets the whole settle delay after each press.
	}
	win.__a11yPulseFocusListener = (event) => {
		const target = event.target as Node | null;

		if (!win.__a11yPulseFocusedSinceTab && target && target.nodeType === 1) {
			win.__a11yPulseFocusedSinceTab = target as Element;
		}
	};
	// Fired as a navigation to another document starts, and not for one the page (or the context
	// observer) cancelled.
	win.__a11yPulseUnloadListener = () => {
		win.__a11yPulseLeaving = true;
	};
	window.addEventListener("keydown", win.__a11yPulseTabListener, true);
	window.addEventListener("focus", win.__a11yPulseFocusListener, true);
	window.addEventListener("beforeunload", win.__a11yPulseUnloadListener);
}

/** Whether the page cancelled the most recent Tab key press, as seen by `installTabObserverScript`. */
export function tabPreventedScript(): boolean {
	return (window as TabObserverWindow).__a11yPulseLastTab?.defaultPrevented === true;
}

export function removeTabObserverScript(): void {
	const win = window as TabObserverWindow;

	if (win.__a11yPulseTabListener) {
		window.removeEventListener("keydown", win.__a11yPulseTabListener, true);
	}

	if (win.__a11yPulseFocusListener) {
		window.removeEventListener("focus", win.__a11yPulseFocusListener, true);
	}

	if (win.__a11yPulseUnloadListener) {
		window.removeEventListener("beforeunload", win.__a11yPulseUnloadListener);
	}

	if (win.__a11yPulseTimers) {
		// From here on the wrapper only calls through, so that one the page has since wrapped again,
		// and which therefore stays in its chain, leaves no trace of the session behind.
		win.__a11yPulseTimers.live = false;

		// Only put `setTimeout` back if it is still the observer's: a page that has since wrapped it
		// again keeps its own wrapper, which goes on working through the observer's.
		if (window.setTimeout === win.__a11yPulseTimers.wrapped) {
			try {
				window.setTimeout = win.__a11yPulseTimers.original;
			} catch {}
		}
	}

	delete win.__a11yPulseTabListener;
	delete win.__a11yPulseLastTab;
	delete win.__a11yPulseFocusListener;
	delete win.__a11yPulseUnloadListener;
	delete win.__a11yPulseLeaving;
	delete win.__a11yPulseFocusedSinceTab;
	delete win.__a11yPulseTimerDue;
	delete win.__a11yPulseTimerRan;
	delete win.__a11yPulseTimers;
}

/**
 * Whether the document the session started on has been replaced, or has started to leave for one
 * that will replace it. The tab observer lives on the window, so a full navigation takes it away
 * while a hash or History API change leaves it alone.
 */
export function documentReplacedScript(): boolean {
	const win = window as TabObserverWindow;

	return win.__a11yPulseTabListener === undefined || win.__a11yPulseLeaving === true;
}

/** Whether the document the session started on has started to leave for another, and is still here. */
export function leavingScript(): boolean {
	const win = window as TabObserverWindow;

	return win.__a11yPulseTabListener !== undefined && win.__a11yPulseLeaving === true;
}

/** Forget a start to leave that the document stayed through. */
export function stayedScript(): void {
	delete (window as TabObserverWindow).__a11yPulseLeaving;
}

/**
 * Where the page is, and whether that is still the document the session started on, waiting for the
 * one it is leaving for.
 */
export function landedHrefScript(): { href: string; leaving: boolean } {
	const win = window as TabObserverWindow;

	return {
		href: location.href,
		leaving: win.__a11yPulseTabListener !== undefined && win.__a11yPulseLeaving === true,
	};
}

export type BlurredStop = {
	/** An element took focus on the last Tab press and nothing holds it now. */
	blurred: boolean;
	/** The marker of that element, or `null` when it has left the document. */
	index: number | null;
};

/**
 * Tell a Tab press that ran out of elements apart from one whose target gave focus up again (it
 * blurred itself, or was removed). Either way nothing is focused afterwards, but in the second case
 * the tab order carries on from where that element was. The element is given the marker `index`
 * unless it already has one.
 */
export function blurredStopScript(markerAttr: string, index: number): BlurredStop {
	const win = window as TabObserverWindow;
	const target = win.__a11yPulseFocusedSinceTab ?? null;

	win.__a11yPulseFocusedSinceTab = null;

	if (!target || target === document.body || target === document.documentElement) {
		return { blurred: false, index: null };
	}

	const active = document.activeElement;

	if (active && active !== document.body && active !== document.documentElement) {
		return { blurred: false, index: null };
	}

	if (!target.isConnected) {
		return { blurred: true, index: null };
	}

	const existing = target.getAttribute(markerAttr);

	if (existing !== null) {
		return { blurred: true, index: Number(existing) };
	}

	target.setAttribute(markerAttr, String(index));

	return { blurred: true, index };
}

/** Take focus off whatever holds it, so the element is measured in its unfocused state. */
export function blurActiveElementScript(): void {
	let el = document.activeElement;

	while (el?.shadowRoot?.activeElement) {
		el = el.shadowRoot.activeElement;
	}

	(el as HTMLElement | null)?.blur?.();
}

/**
 * Wait for the browser to apply `autofocus`, when the page has such an element and nothing holds
 * focus yet. Browsers apply it at the first rendering update after the element is inserted, which
 * can come after `load`; a session that reset the focus starting point before then would have the
 * reset undone, and would start tabbing from the autofocused field.
 */
export function awaitAutofocusScript(): Promise<void> {
	const active = document.activeElement;
	const idle = !active || active === document.body || active === document.documentElement;

	if (!idle || !document.querySelector("[autofocus]")) {
		return Promise.resolve();
	}

	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
		// A page that is not being rendered (a background tab) never gets its frames.
		setTimeout(() => resolve(), 200);
	});
}

/**
 * Put the point sequential focus navigation starts from back where it is on a freshly loaded page,
 * so the next Tab press reaches the first tab stop whatever was focused before (an `autofocus`
 * field, or where an earlier session stopped). Blurring alone does not do this: browsers keep
 * tabbing from the element that was last focused.
 *
 * The point is moved by focusing a throwaway node. A browser then tabs on to the next tabbable
 * element after that node in the document, whatever its tabindex.
 */
export function resetFocusStartScript(): void {
	// Must be a string literal inside this function: it is serialized into the page.
	const anchorAttr = "data-a11y-pulse-focus-start";

	(document.activeElement as HTMLElement | null)?.blur?.();

	for (const leftover of Array.from(document.querySelectorAll(`[${anchorAttr}]`))) {
		leftover.remove();
	}

	const root = document.documentElement;
	const body = document.body;

	if (!root || !body) {
		return;
	}

	const place = (parent: Node, before: Node | null): HTMLElement | null => {
		const anchor = document.createElement("span");
		anchor.tabIndex = -1;
		anchor.setAttribute(anchorAttr, "");
		anchor.setAttribute("aria-hidden", "true");
		anchor.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;outline:none";

		try {
			parent.insertBefore(anchor, before);
			anchor.focus({ preventScroll: true });
		} catch {}

		if (document.activeElement === anchor) {
			return anchor;
		}

		anchor.remove();

		return null;
	};

	// A positive tabindex puts its element ahead of everything else, lowest value first, so that is
	// where the tab order of a fresh page opens.
	let first: Element | null = null;
	let lowest = Number.POSITIVE_INFINITY;

	for (const candidate of Array.from(document.querySelectorAll("[tabindex]"))) {
		const tabIndex = (candidate as HTMLElement).tabIndex;

		if (tabIndex <= 0 || tabIndex >= lowest) {
			continue;
		}

		const visibility = candidate as Element & {
			checkVisibility?: (options?: { checkVisibilityCSS?: boolean }) => boolean;
		};

		if (
			candidate.matches(":disabled") ||
			candidate.closest("[inert]") ||
			(typeof visibility.checkVisibility === "function" &&
				!visibility.checkVisibility({ checkVisibilityCSS: true }))
		) {
			continue;
		}

		first = candidate;
		lowest = tabIndex;
	}

	if (first?.parentNode) {
		// The node goes right in front of that element and has to stay until focus has moved on:
		// once removed, the browser tabs on from the element before it instead, by that element's
		// own tabindex. Unfocused, hidden from assistive technology and out of the tab order, it
		// takes itself away the next time anything is focused.
		const anchor = place(first.parentNode, first);

		if (anchor) {
			anchor.blur();

			const cleanUp = (event: Event): void => {
				if (event.target !== anchor) {
					anchor.remove();
					window.removeEventListener("focus", cleanUp, true);
				}
			};

			window.addEventListener("focus", cleanUp, true);

			return;
		}
	}

	// Otherwise the tab order opens at the top of the document, and the node can be taken straight
	// out again, leaving nothing behind: what precedes it there cannot be focused, so the browser
	// tabs on in document order. Ahead of <body> first, so that a focusable <body> is still a stop.
	const places: Array<[Node, Node | null]> = [
		[root, body],
		[body, body.firstChild],
	];

	for (const [parent, before] of places) {
		const anchor = place(parent, before);

		if (anchor) {
			anchor.remove();

			return;
		}
	}
}

export type HeldFocus = {
	/** The page cancelled the Tab press that left focus where it was. */
	prevented: boolean;
	/** Something tabbable follows the focused element in document order, so the tab order goes on. */
	followed: boolean;
};

/**
 * Why a Tab press left focus on the same element: the page cancelled it, or there is nothing
 * tabbable after the element to move to.
 */
export function heldFocusScript(tabbableSelector: string): HeldFocus {
	let el = document.activeElement;

	while (el?.shadowRoot?.activeElement) {
		el = el.shadowRoot.activeElement;
	}

	// Compare light-DOM positions: an element inside a shadow root stands in for its outermost host.
	let anchor: Element | null = el;

	while (anchor && anchor.getRootNode() instanceof ShadowRoot) {
		anchor = (anchor.getRootNode() as ShadowRoot).host;
	}

	const modal = document.querySelector("dialog:modal");

	const isTabbable = (candidate: Element): boolean => {
		if (
			(candidate as HTMLElement).tabIndex < 0 ||
			candidate.matches(":disabled") ||
			candidate.closest("[inert]") ||
			(modal && !modal.contains(candidate))
		) {
			return false;
		}

		const visibility = candidate as Element & {
			checkVisibility?: (options?: { checkVisibilityCSS?: boolean }) => boolean;
		};

		if (typeof visibility.checkVisibility === "function") {
			return visibility.checkVisibility({ checkVisibilityCSS: true });
		}

		return candidate.getClientRects().length > 0;
	};

	const prevented = (window as TabObserverWindow).__a11yPulseLastTab?.defaultPrevented === true;

	// Every candidate in tab order, with a host's shadow content right after the host itself.
	const ordered: Element[] = [];
	const collect = (root: Document | ShadowRoot): void => {
		for (const node of Array.from(root.querySelectorAll("*"))) {
			if (node === el || node.matches(tabbableSelector)) {
				ordered.push(node);
			}

			if (node.shadowRoot) {
				collect(node.shadowRoot);
			}
		}
	};

	collect(document);

	const position = el ? ordered.indexOf(el) : -1;
	const followed =
		el !== null &&
		anchor !== null &&
		position !== -1 &&
		ordered
			.slice(position + 1)
			.some(
				(candidate) =>
					!el.contains(candidate) && !anchor.contains(candidate) && isTabbable(candidate),
			);

	return { prevented, followed };
}

/**
 * The elements the session has stopped on, kept in the page so that one can still be recognised
 * after the page drops its marker attribute or re-renders it as a new node.
 */
type SeenRegistry = {
	byElement: WeakMap<Element, number>;
	/**
	 * Keyed by where the element sits and what it is: its path from the root, its page rect, and its
	 * id, href, name, label and text.
	 */
	byPlace: Map<string, { index: number; ref: WeakRef<Element> }>;
};

type SeenWindow = Window & { __a11yPulseSeen?: SeenRegistry };

/**
 * Give the focused element (descending open shadow roots) the marker `index` unless it already has
 * one, and return its marker. An element the session has already stopped on gets its old marker
 * back, as does a new node with the same id, href, name, label and text standing exactly where a
 * visited one was before the page removed it, so a focus cycle through re-rendered content still
 * reads as a revisit. A node with different content in the same place is a new stop: that is a
 * list loading its next page, not a cycle.
 */
export function markActiveElementScript(markerAttr: string, index: number): number {
	let el = document.activeElement;

	while (el?.shadowRoot?.activeElement) {
		el = el.shadowRoot.activeElement;
	}

	const existing = el?.getAttribute(markerAttr);

	if (existing !== null && existing !== undefined) {
		return Number(existing);
	}

	if (!el) {
		return index;
	}

	// Must be byte-identical to the copy in probeActiveElementScript: both write the same registry.
	const placeOf = (element: Element): string => {
		const path: string[] = [];

		for (let node: Element | null = element; node; ) {
			const parent: Element | null = node.parentElement;
			const siblings = parent ? Array.from(parent.children) : [];
			path.push(`${node.nodeName}:${siblings.indexOf(node)}`);
			node = parent ?? ((node.getRootNode() as ShadowRoot).host as Element | undefined) ?? null;
		}

		const rect = element.getBoundingClientRect();

		// What the element is, as well as where: a page that swaps in new content where the old
		// stood (the next page of a list) has put a different element there, not the same one.
		const identity = [
			element.id,
			element.getAttribute("href") ?? "",
			element.getAttribute("name") ?? "",
			element.getAttribute("aria-label") ?? "",
			(element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
		];

		return [
			path.join("/"),
			Math.round(rect.left + window.scrollX),
			Math.round(rect.top + window.scrollY),
			Math.round(rect.width),
			Math.round(rect.height),
			JSON.stringify(identity),
		].join("|");
	};

	const win = window as SeenWindow;
	win.__a11yPulseSeen ??= { byElement: new WeakMap(), byPlace: new Map() };
	const seen = win.__a11yPulseSeen;
	const place = placeOf(el);
	const before = seen.byPlace.get(place);
	const replaced = before?.ref.deref();
	let marker = seen.byElement.get(el);

	if (marker === undefined && before && replaced !== el && !replaced?.isConnected) {
		marker = before.index;
	}

	marker ??= index;
	el.setAttribute(markerAttr, String(marker));
	seen.byElement.set(el, marker);
	seen.byPlace.set(place, { index: marker, ref: new WeakRef(el) });

	return marker;
}

export type ActiveElementBase = {
	index: number | null;
	isBody: boolean;
	/**
	 * The focused element is an <iframe>. Tabbing into a frame passes focus into its embedded
	 * document, but the parent's document.activeElement is the frame element itself, so the loop uses
	 * this to skip the frame as a tab stop.
	 */
	isIframe: boolean;
	html: string;
	styles: StyleSnapshot;
	rect: Rect;
	/**
	 * The element sits on a fixed or sticky ancestor (or is one), so its page position depends on
	 * scrolling rather than on where it is in the page.
	 */
	pinned?: boolean;
	/** The element is inside an open dialog, where focus management may legitimately leave the page order. */
	inDialog?: boolean;
	/**
	 * The first opaque background colour behind the element's box, from its parent outwards, or null
	 * when it cannot be told from the ancestors: a background image or a translucent colour comes
	 * first, or the element or a see-through ancestor is positioned out of the flow (absolute, fixed
	 * or sticky) and so may be painted over something else. Only read alongside styles.
	 */
	backdrop?: string | null;
	/**
	 * A CSS transition or animation was running on the element, its labels or its nearest ancestors
	 * when the styles were read, so they may be part-way values. Only read alongside styles.
	 */
	animating?: boolean;
};

/**
 * Read the currently focused element (descending open shadow roots), returning its marker index,
 * opening-tag HTML (marker attribute stripped), focus-relevant styles, and page-relative rect.
 */
export function probeActiveElementScript(props: string[], markerAttr: string): ActiveElementBase {
	let el = document.activeElement;

	while (el?.shadowRoot?.activeElement) {
		el = el.shadowRoot.activeElement;
	}

	// <body> is the active element whenever nothing is focused. It only matches :focus when it has
	// really taken focus, which a focusable or editable <body> does as a tab stop of its own.
	let bodyFocused = false;

	try {
		bodyFocused = el === document.body && el.matches(":focus");
	} catch {}

	if (!el || (el === document.body && !bodyFocused)) {
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
		const MAX_STYLE_VALUE_LENGTH = 512;

		if (value.length <= MAX_STYLE_VALUE_LENGTH) {
			return value;
		}

		let hash = 5381;

		for (let i = 0; i < value.length; i++) {
			hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0;
		}

		return `${value.slice(0, MAX_STYLE_VALUE_LENGTH)}#len=${value.length}#h=${hash.toString(36)}`;
	};

	const read = (pseudo: string | undefined): Record<string, string> => {
		// No consumer wants styles: skip the computed-style reads altogether.
		if (props.length === 0) {
			return {};
		}

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

	if (idxAttr !== null && typeof WeakRef === "function") {
		// Must be byte-identical to the copy in markActiveElementScript: both write the same registry.
		const placeOf = (element: Element): string => {
			const path: string[] = [];

			for (let node: Element | null = element; node; ) {
				const parent: Element | null = node.parentElement;
				const siblings = parent ? Array.from(parent.children) : [];
				path.push(`${node.nodeName}:${siblings.indexOf(node)}`);
				node = parent ?? ((node.getRootNode() as ShadowRoot).host as Element | undefined) ?? null;
			}

			const rect = element.getBoundingClientRect();

			// What the element is, as well as where: a page that swaps in new content where the old
			// stood (the next page of a list) has put a different element there, not the same one.
			const identity = [
				element.id,
				element.getAttribute("href") ?? "",
				element.getAttribute("name") ?? "",
				element.getAttribute("aria-label") ?? "",
				(element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
			];

			return [
				path.join("/"),
				Math.round(rect.left + window.scrollX),
				Math.round(rect.top + window.scrollY),
				Math.round(rect.width),
				Math.round(rect.height),
				JSON.stringify(identity),
			].join("|");
		};

		const win = window as SeenWindow;
		win.__a11yPulseSeen ??= { byElement: new WeakMap(), byPlace: new Map() };

		if (!win.__a11yPulseSeen.byElement.has(el)) {
			win.__a11yPulseSeen.byElement.set(el, Number(idxAttr));
			win.__a11yPulseSeen.byPlace.set(placeOf(el), {
				index: Number(idxAttr),
				ref: new WeakRef(el),
			});
		}
	}

	// Walks out through shadow roots, so content inside a fixed host (a chat launcher) counts too.
	let pinned = false;

	for (let node: Element | null = el; node && !pinned; ) {
		const { position } = getComputedStyle(node);
		pinned = position === "fixed" || position === "sticky";
		node = node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null;
	}

	// What an outline or shadow drawn around the element is seen against. An unpainted canvas is white.
	let backdrop: string | null | undefined;

	if (props.length > 0) {
		backdrop = "rgb(255, 255, 255)";

		for (
			let node: Element | null = el;
			node;
			node =
				node.parentElement ??
				((node.getRootNode() as ShadowRoot).host as Element | undefined) ??
				null
		) {
			const cs = getComputedStyle(node);

			if (node !== el) {
				if (cs.backgroundImage !== "none" && cs.backgroundImage !== "") {
					backdrop = null;
					break;
				}

				const color = cs.backgroundColor.replace(/\s+/g, "");

				if (
					color !== "" &&
					color !== "transparent" &&
					!/^rgba\(.*,0\)$/.test(color) &&
					!/\/0\)$/.test(color)
				) {
					backdrop = /^rgb\(/.test(color) ? cs.backgroundColor : null;
					break;
				}
			}

			// A see-through box taken out of the flow is painted over whatever lies beneath it (a link
			// placed over a hero image that is its sibling), which its ancestors say nothing about.
			if (cs.position === "absolute" || cs.position === "fixed" || cs.position === "sticky") {
				backdrop = null;
				break;
			}
		}
	}

	let animating: boolean | undefined;

	if (props.length > 0 && typeof el.getAnimations === "function") {
		const parent = el.parentElement;
		const around = [
			el,
			...Array.from((el as HTMLInputElement).labels ?? []),
			parent,
			parent?.parentElement,
		];

		animating = around.some(
			(node) =>
				node instanceof Element &&
				node !== document.body &&
				node !== document.documentElement &&
				node
					.getAnimations({ subtree: true })
					.some((animation) => animation.playState === "running"),
		);
	}

	// Shallow clone so only the opening tag is serialised, not the whole subtree; drop the internal
	// marker attribute so it never leaks into the snippet.
	const openingTag = el.cloneNode(false) as Element;
	openingTag.removeAttribute(markerAttr);

	return {
		...(backdrop === undefined ? {} : { backdrop }),
		...(animating === undefined ? {} : { animating }),
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
		pinned,
		inDialog: el.closest("dialog[open], [role='dialog'], [role='alertdialog']") !== null,
	};
}

export function activeElementHandleScript(): Element | null {
	let el = document.activeElement;

	while (el?.shadowRoot?.activeElement) {
		el = el.shadowRoot.activeElement;
	}

	return el;
}

/**
 * Whether something unrelated (e.g. a fixed cookie banner) covers the element's centre point, so a
 * screenshot of the element's box would show the covering element instead.
 */
export function isCenterObscuredScript(el: Element | null): boolean {
	if (!el) {
		return false;
	}

	const rect = el.getBoundingClientRect();
	const x = Math.min(Math.max(rect.left + rect.width / 2, 0), window.innerWidth - 1);
	const y = Math.min(Math.max(rect.top + rect.height / 2, 0), window.innerHeight - 1);

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

export function blurScript(el: Element | null): void {
	(el as HTMLElement | null)?.blur();
}

export function focusScript(el: Element | null): void {
	(el as HTMLElement | null)?.focus({ preventScroll: true });
}

/**
 * Read focus-relevant computed styles from a given element. Unlike `probeActiveElementScript`, this
 * does not use `document.activeElement`, so it still works after the node has been blurred.
 */
export function elementStylesScript(el: Element | null, props: string[]): StyleSnapshot {
	if (!el) {
		return { element: {}, before: {}, after: {} };
	}

	// Must be byte-identical to the copies in baselineScript and probeActiveElementScript: snapshots
	// from the scripts are compared for equality, so they have to truncate oversized values the same
	// way.
	const truncateValue = (value: string): string => {
		const MAX_STYLE_VALUE_LENGTH = 512;

		if (value.length <= MAX_STYLE_VALUE_LENGTH) {
			return value;
		}

		let hash = 5381;

		for (let i = 0; i < value.length; i++) {
			hash = ((hash * 33) ^ value.charCodeAt(i)) >>> 0;
		}

		return `${value.slice(0, MAX_STYLE_VALUE_LENGTH)}#len=${value.length}#h=${hash.toString(36)}`;
	};

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
}

/**
 * Remove the marker attribute from all elements, blur the active element, and scroll back to the
 * top. This is a best-effort attempt to reset state between audits: the tab loop scrolls later
 * elements into view as it walks the page (see scrollToCenterScript), and nothing else undoes that
 * once the session ends.
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

	delete (window as SeenWindow).__a11yPulseSeen;
	delete (window as Window & { __a11yPulseInertCovers?: unknown }).__a11yPulseInertCovers;
	delete (window as Window & { __a11yPulseObscurer?: unknown }).__a11yPulseObscurer;

	(document.activeElement as HTMLElement | null)?.blur();

	window.scrollTo(0, 0);
}

export type MeasureObscuringResult = {
	coveredFraction: number;
	fullyObscured: boolean;
	offscreen: boolean;
	opacity: "opaque" | "semi-transparent" | "unknown";
	obscuredByHtml: string | null;
	/** True when a covering element was marked for selector resolution. */
	hasObscurer: boolean;
	/** Viewport-relative box that was hit-tested: the element's, or its label's (see `measured`). */
	rect?: { x: number; y: number; width: number; height: number } | null;
	/** Viewport-relative box of the cover. */
	coverRect?: { x: number; y: number; width: number; height: number } | null;
	/** Computed `position` of the cover (`fixed`, `sticky`, ...). */
	coverPosition?: string | null;
	/** `"label"` when the element itself is not painted and its label stood in for it. */
	measured?: "element" | "label";
	/** The element is not painted (transparent or clipped away) and has no label to measure. */
	notPainted?: boolean;
	/** The cover has `pointer-events: none`, so ordinary hit-testing does not see it. */
	coverIgnoresPointer?: boolean;
};

/**
 * Hit-test whether author-created content entirely hides the focused element. Each hit is traced up
 * to the cover it belongs to (the outermost fixed, sticky or absolutely positioned ancestor that
 * does not hold the focused element), and that cover is judged as a whole: it is opaque where any
 * node between the hit and the cover paints an opaque background, a background image, or replaced
 * content. Marks the cover with `obscurerAttr` so the host can resolve its selector via
 * getSelector.
 *
 * Covers with `pointer-events: none` are invisible to `elementsFromPoint`, so the ones overlapping
 * the element have pointer events switched on for the duration of the hit test, and are put back
 * exactly as they were before this returns.
 */
export function measureObscuringScript(
	el: Element | null,
	obscurerAttr: string,
): MeasureObscuringResult {
	type Box = { x: number; y: number; width: number; height: number };
	type Paint = "opaque" | "see-through" | "unknown" | "nothing";
	// How much of the element a paint may hide: under a see-through layer it may still be hidden
	// by something unknown, and under either by something solid.
	const RANK: Record<Paint, number> = { nothing: 0, "see-through": 1, unknown: 2, opaque: 3 };
	type InertCache = { at: number; list: Element[] };
	type InertWindow = Window & {
		__a11yPulseInertCovers?: InertCache;
		__a11yPulseObscurer?: Element;
	};

	const empty: MeasureObscuringResult = {
		coveredFraction: 0,
		fullyObscured: false,
		offscreen: false,
		opacity: "opaque",
		obscuredByHtml: null,
		hasObscurer: false,
		rect: null,
		coverRect: null,
		coverPosition: null,
		measured: "element",
		notPainted: false,
		coverIgnoresPointer: false,
	};

	if (!el) {
		return empty;
	}

	for (const marked of Array.from(document.querySelectorAll(`[${obscurerAttr}]`))) {
		marked.removeAttribute(obscurerAttr);
	}

	// The last cover is also kept by reference, which is the only way back to one in a shadow root.
	(window as InertWindow).__a11yPulseObscurer?.removeAttribute(obscurerAttr);
	delete (window as InertWindow).__a11yPulseObscurer;

	const styles = new Map<Element, CSSStyleDeclaration>();
	const styleOf = (node: Element): CSSStyleDeclaration => {
		let cs = styles.get(node);

		if (!cs) {
			cs = getComputedStyle(node);
			styles.set(node, cs);
		}

		return cs;
	};

	/** Parent in the flattened tree: out of a shadow root to its host. */
	const parentOf = (node: Element): Element | null => {
		if (node.parentElement) {
			return node.parentElement;
		}

		const root = node.getRootNode();

		return root instanceof ShadowRoot ? root.host : null;
	};

	const holds = (ancestor: Element, node: Element): boolean => {
		for (let current: Element | null = node; current; current = parentOf(current)) {
			if (current === ancestor) {
				return true;
			}
		}

		return false;
	};

	const boxOf = (node: Element): Box => {
		const r = node.getBoundingClientRect();

		return { x: r.left, y: r.top, width: r.right - r.left, height: r.bottom - r.top };
	};

	const opacityOf = (node: Element): number => {
		const value = Number.parseFloat(styleOf(node).opacity);

		return Number.isFinite(value) ? value : 1;
	};

	// A control that is transparent or clipped away (the real input of a custom checkbox or switch)
	// cannot be hidden by anything: what the user sees is its label.
	const ownBox = boxOf(el);
	let ownOpacity = 1;

	for (let node: Element | null = el; node; node = parentOf(node)) {
		ownOpacity *= opacityOf(node);
	}

	const notPainted = ownOpacity < 0.05 || ownBox.width <= 1 || ownBox.height <= 1;
	const labels = Array.from((el as HTMLInputElement).labels ?? []) as Element[];
	const wrappingLabel = el.closest("label");

	if (wrappingLabel && !labels.includes(wrappingLabel)) {
		labels.push(wrappingLabel);
	}

	let target: Element = el;
	let measured: "element" | "label" = "element";

	if (notPainted) {
		const standIn = labels.find((label) => {
			const box = boxOf(label);

			return box.width > 1 && box.height > 1;
		});

		if (!standIn) {
			return { ...empty, notPainted: true, rect: ownBox };
		}

		target = standIn;
		measured = "label";
	}

	const full = boxOf(target);
	const left = Math.max(full.x, 0);
	const top = Math.max(full.y, 0);
	const right = Math.min(full.x + full.width, window.innerWidth);
	const bottom = Math.min(full.y + full.height, window.innerHeight);

	if (right <= left || bottom <= top) {
		return { ...empty, offscreen: true, rect: full, measured };
	}

	const width = right - left;
	const height = bottom - top;
	const LARGE_ELEMENT_THRESHOLD_PX = 80;
	// The far edges are sampled a pixel in: hit-testing rounds a half pixel onto the neighbour.
	const inset = Math.min(1, width / 2, height / 2);

	const points: Array<{ x: number; y: number }> = [
		{ x: left, y: top },
		{ x: right - inset, y: top },
		{ x: left, y: bottom - inset },
		{ x: right - inset, y: bottom - inset },
		{ x: left + width / 2, y: top },
		{ x: left + width / 2, y: bottom - inset },
		{ x: left, y: top + height / 2 },
		{ x: right - inset, y: top + height / 2 },
		{ x: left + width / 2, y: top + height / 2 },
	];

	if (width > LARGE_ELEMENT_THRESHOLD_PX || height > LARGE_ELEMENT_THRESHOLD_PX) {
		points.push(
			{ x: left + width * 0.25, y: top + height * 0.25 },
			{ x: left + width * 0.75, y: top + height * 0.25 },
			{ x: left + width * 0.25, y: top + height * 0.75 },
			{ x: left + width * 0.75, y: top + height * 0.75 },
		);
	}

	/** The element, its stand-in, anything inside or around either, and its own label's content. */
	const isOwn = (candidate: Element): boolean =>
		holds(el, candidate) ||
		holds(candidate, el) ||
		holds(target, candidate) ||
		holds(candidate, target) ||
		labels.some((label) => holds(label, candidate));

	/**
	 * Everything painted at a point above the element, topmost first. The list stops at the
	 * element's own content, since whatever is below that cannot hide it.
	 */
	const aboveAt = (x: number, y: number): Element[] => {
		const px = Math.min(Math.max(x, 0), window.innerWidth - 1);
		const py = Math.min(Math.max(y, 0), window.innerHeight - 1);
		const stack =
			typeof document.elementsFromPoint === "function"
				? document.elementsFromPoint(px, py)
				: [document.elementFromPoint(px, py)].filter(Boolean);
		const above: Element[] = [];

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

			if (isOwn(candidate)) {
				break;
			}

			above.push(candidate);
		}

		return above;
	};

	/** The cover a hit belongs to, and every node from the hit up to it. */
	const coverOf = (hit: Element): { root: Element; chain: Element[] } => {
		const chain: Element[] = [];
		let pinned = -1;
		let absolute = -1;

		for (let node: Element | null = hit; node && !holds(node, target); node = parentOf(node)) {
			chain.push(node);

			const position = styleOf(node).position;

			if (position === "fixed" || position === "sticky") {
				pinned = chain.length - 1;
			} else if (position === "absolute") {
				absolute = chain.length - 1;
			}
		}

		const end = pinned >= 0 ? pinned : Math.max(absolute, 0);

		return { root: chain[end] ?? hit, chain: chain.slice(0, end + 1) };
	};

	/** Alpha of a computed colour, or `null` when it cannot be read. */
	const alphaOf = (color: string | undefined): number | null => {
		const value = (color ?? "").trim().toLowerCase();

		if (value === "transparent") {
			return 0;
		}

		const open = value.indexOf("(");

		if (open < 0 || !value.endsWith(")")) {
			return null;
		}

		const inner = value.slice(open + 1, -1);
		let raw: string | undefined;

		if (inner.includes("/")) {
			raw = inner.split("/")[1];
		} else if (value.startsWith("rgb") || value.startsWith("hsl")) {
			raw = inner.split(/[\s,]+/).filter(Boolean)[3];
		}

		if (raw === undefined) {
			return 1;
		}

		const parsed = Number.parseFloat(raw);

		if (!Number.isFinite(parsed)) {
			return null;
		}

		return raw.trim().endsWith("%") ? parsed / 100 : parsed;
	};

	const REPLACED = new Set(["IMG", "VIDEO", "CANVAS", "IFRAME", "OBJECT", "EMBED"]);
	const COLOR = /(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^()]*\)/g;
	const SAMPLE = 24;
	const replacedPaints = new Map<Element, Paint>();
	let scratch: CanvasRenderingContext2D | null | undefined;

	/**
	 * Whether every pixel of an image or canvas is solid, none is, or neither. The source is drawn
	 * small onto a canvas of our own, which leaves the page's untouched; one that may not be read
	 * back (another origin's) is `null`.
	 */
	const alphaRangeOf = (source: HTMLImageElement | HTMLCanvasElement): [number, number] | null => {
		try {
			if (scratch === undefined) {
				const canvas = document.createElement("canvas");

				canvas.width = SAMPLE;
				canvas.height = SAMPLE;
				scratch = canvas.getContext("2d", { willReadFrequently: true });
			}

			if (!scratch) {
				return null;
			}

			scratch.clearRect(0, 0, SAMPLE, SAMPLE);
			scratch.drawImage(source, 0, 0, SAMPLE, SAMPLE);

			const data = scratch.getImageData(0, 0, SAMPLE, SAMPLE).data;
			let min = 255;
			let max = 0;

			for (let i = 3; i < data.length; i += 4) {
				const alpha = data[i] ?? 0;

				min = Math.min(min, alpha);
				max = Math.max(max, alpha);
			}

			return [min, max];
		} catch {
			return null;
		}
	};

	/**
	 * What replaced content paints over its own box. Only what can be established counts: a frame,
	 * a plugin, a canvas that reads back empty (a WebGL one does between frames) and an image that
	 * cannot be read are `unknown`, since any of them may be transparent.
	 */
	const replacedPaintOf = (node: Element): Paint => {
		const known = replacedPaints.get(node);

		if (known) {
			return known;
		}

		let paint: Paint = "unknown";

		if (node.tagName === "IMG") {
			const img = node as HTMLImageElement;
			// Only an image stretched over its whole box paints all of it.
			const fit = styleOf(node).objectFit;
			const fills = !fit || fit === "fill" || fit === "cover";

			if (img.complete && img.naturalWidth > 0 && img.naturalHeight > 0) {
				const src = img.currentSrc || img.src;

				if (/^data:image\/jpeg|\.jpe?g(?:[?#]|$)/i.test(src)) {
					// JPEG has no alpha channel.
					paint = fills ? "opaque" : "unknown";
				} else {
					const range = alphaRangeOf(img);

					if (range && range[1] <= 2) {
						paint = "nothing";
					} else if (range && range[0] >= 253 && fills) {
						paint = "opaque";
					}
				}
			}
		} else if (node.tagName === "CANVAS") {
			const canvas = node as HTMLCanvasElement;
			const range = canvas.width > 0 && canvas.height > 0 ? alphaRangeOf(canvas) : null;

			if (range && range[0] >= 253) {
				paint = "opaque";
			}
		} else if (node.tagName === "VIDEO") {
			const video = node as HTMLVideoElement;

			// A frame or a poster is showing. Video with an alpha channel is rare enough to accept.
			if (video.readyState >= 2 || video.poster) {
				paint = "opaque";
			}
		}

		replacedPaints.set(node, paint);

		return paint;
	};

	/** Whether a background image names a colour that is not solid, as a gradient that fades does. */
	const hasSeeThroughStop = (image: string): boolean => {
		const value = image.toLowerCase();

		if (value.includes("transparent")) {
			return true;
		}

		return (value.match(COLOR) ?? []).some((color) => (alphaOf(color) ?? 1) < 1);
	};

	/** What the cover paints at one point, given the hit there. */
	const paintAt = (x: number, y: number, hit: Element, chain: Element[]): Paint => {
		let opacity = 1;

		for (let node: Element | null = hit; node && !holds(node, target); node = parentOf(node)) {
			opacity *= opacityOf(node);
		}

		let solid = false;
		let tinted = false;
		let unknown = false;

		for (const node of chain) {
			const box = boxOf(node);

			if (x < box.x || y < box.y || x > box.x + box.width || y > box.y + box.height) {
				continue;
			}

			if (typeof SVGElement !== "undefined" && node instanceof SVGElement) {
				unknown = true;
				continue;
			}

			const cs = styleOf(node);
			const alpha = alphaOf(cs.backgroundColor);

			if (alpha === null) {
				unknown = true;
			} else if (alpha >= 1) {
				solid = true;
				break;
			} else if (alpha > 0) {
				tinted = true;
			}

			const image = cs.backgroundImage;

			if (image && image !== "none") {
				if (hasSeeThroughStop(image)) {
					unknown = true;
				} else {
					solid = true;
					break;
				}
			}

			if (REPLACED.has(node.tagName)) {
				const paint = replacedPaintOf(node);

				if (paint === "opaque") {
					solid = true;
					break;
				}

				if (paint === "unknown") {
					unknown = true;
				}
			}
		}

		if (solid) {
			return opacity < 1 ? "see-through" : "opaque";
		}

		if (unknown) {
			// Faded, it shows what is behind it whatever it paints.
			return opacity < 1 ? "see-through" : "unknown";
		}

		// Text over no background of its own, or an empty layer, hides nothing.
		return tinted ? "see-through" : "nothing";
	};

	/** Whether a click-through layer is worth hit-testing: it paints, or holds something that may. */
	const mayPaint = (node: Element): boolean => {
		if (REPLACED.has(node.tagName)) {
			// One that cannot be seen into is left alone: a click-through canvas or frame over the
			// page is all but always an empty effects layer.
			return (
				replacedPaintOf(node) === "opaque" || (alphaOf(styleOf(node).backgroundColor) ?? 1) > 0
			);
		}

		if (node.childElementCount > 0 || (node.textContent ?? "").trim() !== "") {
			return true;
		}

		const cs = styleOf(node);

		return (
			(alphaOf(cs.backgroundColor) ?? 1) > 0 ||
			(cs.backgroundImage !== "" && cs.backgroundImage !== "none") ||
			Number.parseFloat(cs.borderTopWidth) > 0 ||
			Number.parseFloat(cs.borderBottomWidth) > 0 ||
			Number.parseFloat(cs.borderLeftWidth) > 0 ||
			Number.parseFloat(cs.borderRightWidth) > 0
		);
	};

	// Covers that take no pointer events, found by a scan that is kept for a second: the scan reads
	// a computed style for every element, which is too much to repeat on every tab stop.
	const win = window as InertWindow;
	const now = performance.now();

	if (!win.__a11yPulseInertCovers || now - win.__a11yPulseInertCovers.at > 1000) {
		const list: Element[] = [];

		for (const node of Array.from(document.querySelectorAll("*"))) {
			const cs = getComputedStyle(node);

			if (
				cs.pointerEvents === "none" &&
				(cs.position === "fixed" || cs.position === "sticky" || cs.position === "absolute") &&
				cs.display !== "none" &&
				cs.visibility !== "hidden"
			) {
				list.push(node);
			}
		}

		win.__a11yPulseInertCovers = { at: now, list };
	}

	const inert = win.__a11yPulseInertCovers.list.filter((node) => {
		if (!node.isConnected || isOwn(node)) {
			return false;
		}

		const box = boxOf(node);

		return (
			box.x < right &&
			box.x + box.width > left &&
			box.y < bottom &&
			box.y + box.height > top &&
			mayPaint(node)
		);
	});

	const restore: Array<() => void> = [];

	for (const node of inert) {
		const style = (node as HTMLElement).style;

		if (!style) {
			continue;
		}

		const hadAttribute = node.hasAttribute("style");
		const value = style.getPropertyValue("pointer-events");
		const priority = style.getPropertyPriority("pointer-events");

		style.setProperty("pointer-events", "auto", "important");
		restore.push(() => {
			if (value) {
				style.setProperty("pointer-events", value, priority);
			} else {
				style.removeProperty("pointer-events");
			}

			if (!hadAttribute && node.getAttribute("style") === "") {
				node.removeAttribute("style");
			}
		});
	}

	let covered = 0;
	const roots = new Map<Element, number>();
	const paints: Paint[] = [];

	try {
		for (const point of points) {
			// The topmost thing here may be an empty layer with a real cover beneath it, so look
			// down through everything above the element for the one that hides the most.
			let found: { root: Element; paint: Paint } | null = null;

			for (const hit of aboveAt(point.x, point.y)) {
				const { root, chain } = coverOf(hit);
				const paint = paintAt(point.x, point.y, hit, chain);

				if (paint === "nothing") {
					continue;
				}

				if (!found || RANK[paint] > RANK[found.paint]) {
					found = { root, paint };
				}

				if (paint === "opaque") {
					break;
				}
			}

			if (!found) {
				continue;
			}

			covered++;
			roots.set(found.root, (roots.get(found.root) ?? 0) + 1);
			paints.push(found.paint);
		}
	} finally {
		for (const undo of restore) {
			undo();
		}
	}

	const coveredFraction = points.length === 0 ? 0 : covered / points.length;
	const rect: Box = { x: left, y: top, width, height };

	if (coveredFraction < 1) {
		return { ...empty, coveredFraction, rect, measured };
	}

	// One cover, or the nearest thing several covers share that does not also hold the element.
	let cover: Element | null = null;
	let coverCount = 0;

	for (const [candidate, count] of roots) {
		if (count > coverCount) {
			cover = candidate;
			coverCount = count;
		}
	}

	if (!cover) {
		return { ...empty, coveredFraction: 1, opacity: "unknown", rect, measured };
	}

	if (roots.size > 1) {
		const others = Array.from(roots.keys());

		for (let shared: Element | null = cover; shared && !holds(shared, target); ) {
			const candidate: Element = shared;

			if (others.every((root) => holds(candidate, root))) {
				cover = candidate;
				break;
			}

			shared = parentOf(candidate);
		}
	}

	const coverElement: Element = cover;
	const coverBox = boxOf(coverElement);
	const TOLERANCE = 0.5;
	const containsFully =
		coverBox.x <= left + TOLERANCE &&
		coverBox.y <= top + TOLERANCE &&
		coverBox.x + coverBox.width >= right - TOLERANCE &&
		coverBox.y + coverBox.height >= bottom - TOLERANCE;

	let opacity: MeasureObscuringResult["opacity"];

	if (paints.includes("see-through")) {
		opacity = "semi-transparent";
	} else if (paints.includes("unknown")) {
		opacity = "unknown";
	} else {
		// Several covers that no one box accounts for may leave a gap between the sampled points.
		opacity = containsFully ? "opaque" : "unknown";
	}

	const openingTag = coverElement.cloneNode(false) as Element;
	openingTag.removeAttribute(obscurerAttr);
	coverElement.setAttribute(obscurerAttr, "1");
	win.__a11yPulseObscurer = coverElement;

	return {
		coveredFraction: 1,
		fullyObscured: true,
		offscreen: false,
		opacity,
		obscuredByHtml: openingTag.outerHTML,
		hasObscurer: true,
		rect,
		coverRect: coverBox,
		coverPosition: styleOf(coverElement).position || null,
		measured,
		notPainted: false,
		coverIgnoresPointer: inert.some((node) => holds(node, coverElement)),
	};
}

/** Return the element marked as the obscurer, if any. */
export function obscurerHandleScript(): Element | null {
	// Kept by reference as well as marked: a cover inside a shadow root is out of reach of a
	// document-wide selector.
	return (
		(window as Window & { __a11yPulseObscurer?: Element }).__a11yPulseObscurer ??
		document.querySelector("[data-a11y-obscurer]")
	);
}

export function clearObscurerScript(obscurerAttr: string): void {
	const win = window as Window & { __a11yPulseObscurer?: Element };

	win.__a11yPulseObscurer?.removeAttribute(obscurerAttr);
	delete win.__a11yPulseObscurer;

	for (const marked of Array.from(document.querySelectorAll(`[${obscurerAttr}]`))) {
		marked.removeAttribute(obscurerAttr);
	}
}

/** The element whose focus handling an event happened in, or set the timer it happened in. */
type ContextEventOwner = { el: Element | null };

type ContextEvent = {
	kind: "window" | "submit" | "url" | "navigation" | "dialog";
	/**
	 * The element there is evidence the event was caused by: it happened while that element's focus
	 * event was being dispatched, or inside a short timer set then. `null` when the page did it for
	 * reasons the observer cannot tie to any focused element.
	 */
	owner: ContextEventOwner | null;
	/** The URL opened, navigated to, or changed to. */
	url?: string;
	/** For a soft URL change, the URL it replaced. */
	from?: string;
	form?: Element | null;
};

type ContextObserverState = {
	baselineHref: string;
	/** What the page did since the last drain. */
	events: ContextEvent[];
	/** Elements that received focusin since the last drain. */
	focusIns: Element[];
	/** The owner of the timer callback now running, if it is one the tab observer tagged. */
	timerOwner: ContextEventOwner | null;
	/** The element whose focus event is being dispatched right now, if one is. */
	dispatchOwner: ContextEventOwner | null;
	/**
	 * When the last short timer that belongs to an element comes due, on the `performance.now()`
	 * clock. 0 when none has been set.
	 */
	ownedDue: number;
	/**
	 * The latest due time among the timers that belong to an element and have run. A timer can run
	 * some way past its due time, so this, not the clock, says when they have all had their turn.
	 */
	ownedRan: number;
	/**
	 * Who asked for the same-document navigation whose `hashchange` or `popstate` is still to come.
	 * Those events arrive in a later task, by which time the element's focus handling is over.
	 */
	pendingUrlOwner: ContextEventOwner | null;
	/** The form behind the submission the last drain reported, for selector resolution. */
	lastForm: Element | null;
	installed: boolean;
	/** Puts back everything the observer wrapped or listened to. */
	uninstall: () => void;
};

declare global {
	interface Window {
		__a11yContextObserver?: ContextObserverState;
	}
}

/**
 * Install once: wrap window.open (record + inert stub), capture-phase submit and `form.submit()`
 * (record + prevent), cancel script-initiated navigations to another document where the Navigation
 * API allows it (record + prevent), track focusin and soft URL changes.
 */
export function installContextObserverScript(): void {
	if (window.__a11yContextObserver?.installed) {
		return;
	}

	const state: ContextObserverState = {
		baselineHref: location.href,
		events: [],
		focusIns: [],
		timerOwner: null,
		dispatchOwner: null,
		ownedDue: 0,
		ownedRan: 0,
		pendingUrlOwner: null,
		lastForm: null,
		installed: true,
		uninstall: () => {},
	};

	window.__a11yContextObserver = state;

	const undo: Array<() => void> = [];

	const currentOwner = (): ContextEventOwner | null => state.timerOwner ?? state.dispatchOwner;

	const note = (event: Omit<ContextEvent, "owner">): void => {
		state.events.push({ ...event, owner: currentOwner() });
	};

	// What a page does is put down to an element only while that element's focus event is being
	// dispatched (or later, inside a timer set then). Dispatch starts at the window in the capture
	// phase and, for the bubbling `focusin` that follows `focus`, ends there in the bubble phase.
	// Focus a handler passes on dispatches its own events inside the first, so the owner stays the
	// element the chain started with. An end that never comes (propagation stopped, or focus moved
	// on before `focusin`) is cleaned up by a task queued behind the dispatch.
	const laterTask = (callback: () => void): void => {
		const original = (
			window as Window & { __a11yPulseTimers?: { original: typeof window.setTimeout } }
		).__a11yPulseTimers?.original;

		(original ?? window.setTimeout).call(window, callback, 0);
	};

	const onDispatchStart = (event: Event): void => {
		const target = event.target as Node | null;

		if (state.dispatchOwner !== null || !target || target.nodeType !== 1) {
			return;
		}

		const owner: ContextEventOwner = { el: target as Element };

		state.dispatchOwner = owner;

		try {
			laterTask(() => {
				if (state.dispatchOwner === owner) {
					state.dispatchOwner = null;
				}
			});
		} catch {}
	};

	const onDispatchEnd = (event: Event): void => {
		if (state.dispatchOwner !== null && state.dispatchOwner.el === event.target) {
			state.dispatchOwner = null;
		}
	};

	window.addEventListener("focus", onDispatchStart, true);
	window.addEventListener("focusin", onDispatchStart, true);
	window.addEventListener("focusin", onDispatchEnd);
	undo.push(() => {
		window.removeEventListener("focus", onDispatchStart, true);
		window.removeEventListener("focusin", onDispatchStart, true);
		window.removeEventListener("focusin", onDispatchEnd);
	});

	// A native dialog is recorded here, where who raised it can be told; the adaptor dismisses it.
	for (const method of ["alert", "confirm", "prompt"] as const) {
		try {
			const own = Object.hasOwn(window, method);
			const original = window[method] as (...args: unknown[]) => unknown;
			const wrapper = function (this: unknown, ...args: unknown[]): unknown {
				note({ kind: "dialog" });

				return original.apply(window, args);
			};

			(window as unknown as Record<string, unknown>)[method] = wrapper;
			undo.push(() => {
				const target = window as unknown as Record<string, unknown>;

				if (target[method] !== wrapper) {
					return;
				}

				if (own) {
					target[method] = original;
				} else {
					delete target[method];
				}
			});
		} catch {}
	}

	// Whether `open` was the window's own property or inherited decides how it is put back.
	const ownOpen = Object.hasOwn(window, "open");
	const originalOpen = window.open;
	const stubOpen = (...args: Parameters<typeof window.open>) => {
		let url = "";

		try {
			url = args[0] === undefined || args[0] === null ? "" : String(args[0]);
		} catch {}

		note({ kind: "window", url });

		return {
			closed: true,
			close() {},
			focus() {},
			blur() {},
			opener: null,
			location: { href: "" },
		} as unknown as Window;
	};

	window.open = stubOpen;
	undo.push(() => {
		// Leave alone a wrapper the page installed over the stub in the meantime.
		if (window.open !== stubOpen) {
			return;
		}

		if (ownOpen) {
			window.open = originalOpen;
		} else {
			delete (window as { open?: unknown }).open;
		}
	});

	const onSubmit = (event: Event): void => {
		const target = event.target as Node | null;

		note({ kind: "submit", form: target && target.nodeType === 1 ? (target as Element) : null });
		event.preventDefault();
		event.stopPropagation();
	};

	document.addEventListener("submit", onSubmit, true);
	undo.push(() => document.removeEventListener("submit", onSubmit, true));

	// `form.submit()` fires no submit event, so it is stubbed the way `window.open` is.
	try {
		const proto = HTMLFormElement.prototype;
		const originalSubmit = proto.submit;
		const stubSubmit = function (this: HTMLFormElement): void {
			note({ kind: "submit", form: this });
		};

		proto.submit = stubSubmit;
		undo.push(() => {
			if (proto.submit === stubSubmit) {
				proto.submit = originalSubmit;
			}
		});
	} catch {}

	const onFocus = (event: Event): void => {
		const target = event.target;

		// Prefer nodeType: instanceof can be brittle across some embeddings.
		if (target && (target as Node).nodeType === 1) {
			state.focusIns.push(target as Element);
		}
	};

	document.addEventListener("focus", onFocus, true);
	undo.push(() => document.removeEventListener("focus", onFocus, true));

	const noteSoftNav = (): void => {
		if (location.href !== state.baselineHref) {
			state.events.push({
				kind: "url",
				from: state.baselineHref,
				url: location.href,
				owner: currentOwner() ?? state.pendingUrlOwner,
			});
			// Later changes are measured from here, so a History API call that leaves the URL as it
			// now is does not report this change a second time.
			state.baselineHref = location.href;
		}

		state.pendingUrlOwner = null;
	};

	window.addEventListener("hashchange", noteSoftNav);
	window.addEventListener("popstate", noteSoftNav);
	undo.push(() => {
		window.removeEventListener("hashchange", noteSoftNav);
		window.removeEventListener("popstate", noteSoftNav);
	});

	const wrapHistory = (method: "pushState" | "replaceState"): void => {
		const own = Object.hasOwn(history, method);
		const unwrapped = history[method];
		const original = unwrapped.bind(history);
		const wrapper = ((...args: Parameters<History["pushState"]>) => {
			const result = original(...args);
			noteSoftNav();

			return result;
		}) as History["pushState"];

		history[method] = wrapper;
		undo.push(() => {
			if (history[method] !== wrapper) {
				return;
			}

			if (own) {
				history[method] = unwrapped;
			} else {
				delete (history as Partial<History>)[method];
			}
		});
	};

	wrapHistory("pushState");
	wrapHistory("replaceState");

	// Nobody clicks or presses Enter during a tab session, so a navigation to another document is
	// the page's own doing. Where the Navigation API exists it is cancelled, like a popup or a
	// submission, which keeps the page the session is on and, when a focused element asked for it,
	// that element in the page to be named. One nothing ties to a focused element (a session-expiry
	// redirect, a refresh timer) is cancelled all the same and recorded without an owner. Elsewhere
	// the navigation goes ahead and ends the session.
	try {
		const navigation = (window as { navigation?: EventTarget }).navigation;

		if (navigation && typeof navigation.addEventListener === "function") {
			const onNavigate = (event: Event): void => {
				const nav = event as Event & {
					destination?: { url?: string; sameDocument?: boolean };
					hashChange?: boolean;
					downloadRequest?: string | null;
					userInitiated?: boolean;
				};

				if (nav.hashChange || nav.destination?.sameDocument) {
					// The URL change itself is noted when `hashchange` or `popstate` arrives, a task
					// later; who asked for it can only be told now.
					state.pendingUrlOwner = currentOwner();

					return;
				}

				if (
					(nav.downloadRequest !== null && nav.downloadRequest !== undefined) ||
					nav.userInitiated === true ||
					!nav.cancelable
				) {
					return;
				}

				note({ kind: "navigation", url: nav.destination?.url ?? "" });
				nav.preventDefault();
			};

			navigation.addEventListener("navigate", onNavigate);
			undo.push(() => navigation.removeEventListener("navigate", onNavigate));
		}
	} catch {}

	state.uninstall = () => {
		for (const step of undo) {
			try {
				step();
			} catch {}
		}
	};
}

/**
 * Undo `installContextObserverScript`: the page opens windows, submits forms, navigates and uses
 * the History API as it did before, and the observer's record of focused elements is released.
 */
export function uninstallContextObserverScript(): void {
	const state = window.__a11yContextObserver;

	if (!state) {
		return;
	}

	state.uninstall?.();
	state.focusIns = [];
	state.events = [];
	state.lastForm = null;
	delete window.__a11yContextObserver;

	for (const marked of Array.from(document.querySelectorAll("[data-a11y-ctx-attr]"))) {
		marked.removeAttribute("data-a11y-ctx-attr");
	}
}

/** What the page did, as far as the context observer saw it. */
export type ContextEventSummary = {
	openedWindow: boolean;
	submittedForm: boolean;
	softUrlChange: boolean;
	/** The page tried to navigate to another document and the observer cancelled it. */
	navigationPrevented: boolean;
	/** The page raised a native dialog (`alert`, `confirm` or `prompt`). */
	raisedDialog: boolean;
	openedWindowUrl: string | null;
	submittedFormHtml: string | null;
	submittedFormAction: string | null;
	urlFrom: string | null;
	urlTo: string | null;
	navigationUrl: string | null;
};

/** Something a timer did after focus had already moved on from the element that set it. */
export type DrainLateChange = ContextEventSummary & {
	/** The owning element's marker index, when it has been a tab stop. */
	index: number | null;
	html: string;
};

export type DrainContextObserverResult = ContextEventSummary & {
	focusRemoved: boolean;
	redirect: "outside" | "same-subtree" | null;
	/**
	 * Focus was passed on by a focus guard: an element a dialog library marks as one, or an empty,
	 * unnamed, non-interactive element that hands focus to something in the dialog it sits in or
	 * beside. Not a control that lost its focus.
	 */
	focusGuard: boolean;
	navigation: boolean;
	attributedHtml: string | null;
	/** True when an attributed element was marked for selector resolution. */
	hasAttributed: boolean;
	/** True when the submitted form is held for `submittedFormHandleScript`. */
	hasSubmittedForm: boolean;
	late: DrainLateChange[];
	/**
	 * What the page did that nothing ties to a focused element: it happened outside any element's
	 * focus handling and outside any timer set there. `null` when there was nothing of the kind.
	 */
	unattributed: ContextEventSummary | null;
};

/**
 * Drain observer signals for the current tab stop and reset per-stop flags. Classification of focus
 * removal / redirection uses the post-Tab settle activeElement and the focusin history from this
 * stop only. What a timer did on behalf of an element focus has since left comes back under `late`
 * rather than being put down to the current stop, and what no element can be shown to have caused
 * comes back under `unattributed`.
 *
 * With `final` set, at the end of a session, there is no current stop: everything an element caused
 * comes back under `late`.
 */
export function drainContextObserverScript(
	markerAttr: string,
	final = false,
): DrainContextObserverResult {
	// Must be a string literal inside this function: it is serialized into the page.
	const attributedAttr = "data-a11y-ctx-attr";

	const none = (): ContextEventSummary => ({
		openedWindow: false,
		submittedForm: false,
		softUrlChange: false,
		navigationPrevented: false,
		raisedDialog: false,
		openedWindowUrl: null,
		submittedFormHtml: null,
		submittedFormAction: null,
		urlFrom: null,
		urlTo: null,
		navigationUrl: null,
	});

	const empty: DrainContextObserverResult = {
		...none(),
		focusRemoved: false,
		redirect: null,
		focusGuard: false,
		navigation: false,
		attributedHtml: null,
		hasAttributed: false,
		hasSubmittedForm: false,
		late: [],
		unattributed: null,
	};

	const state = window.__a11yContextObserver;

	if (!state) {
		return empty;
	}

	for (const marked of Array.from(document.querySelectorAll(`[${attributedAttr}]`))) {
		marked.removeAttribute(attributedAttr);
	}

	const events = state.events.slice();
	const focusIns = state.focusIns.slice();

	state.events = [];
	state.focusIns = [];
	state.lastForm = null;

	let active = document.activeElement;

	while (active?.shadowRoot?.activeElement) {
		active = active.shadowRoot.activeElement;
	}

	const intended =
		focusIns.find((el) => el !== document.body && el !== document.documentElement) ?? null;

	const openingHtml = (node: Element): string => {
		const clone = node.cloneNode(false) as Element;
		clone.removeAttribute(markerAttr);
		clone.removeAttribute(attributedAttr);

		return clone.outerHTML;
	};

	const summarise = (
		list: ContextEvent[],
	): { summary: ContextEventSummary; form: Element | null } => {
		const summary = none();
		let form: Element | null = null;

		for (const event of list) {
			if (event.kind === "window") {
				if (!summary.openedWindow) {
					summary.openedWindow = true;
					summary.openedWindowUrl = event.url ?? "";
				}
			} else if (event.kind === "submit") {
				if (!summary.submittedForm) {
					summary.submittedForm = true;
					form = event.form ?? null;

					if (form) {
						summary.submittedFormHtml = openingHtml(form);

						const action = form.getAttribute("action") ?? "";

						try {
							summary.submittedFormAction = new URL(action, document.baseURI).href;
						} catch {
							summary.submittedFormAction = action;
						}
					}
				}
			} else if (event.kind === "url") {
				if (!summary.softUrlChange) {
					summary.softUrlChange = true;
					summary.urlFrom = event.from ?? null;
				}

				summary.urlTo = event.url ?? null;
			} else if (event.kind === "dialog") {
				summary.raisedDialog = true;
			} else if (!summary.navigationPrevented) {
				summary.navigationPrevented = true;
				summary.navigationUrl = event.url ?? "";
			}
		}

		return { summary, form };
	};

	// An event belongs to the element whose focus handling, or whose timer, it happened in. If focus
	// has moved on from that element since, the event is late news about an earlier stop. One that
	// belongs to no element is not put down to whichever happens to be focused.
	const current: ContextEvent[] = [];
	const ownerless: ContextEvent[] = [];
	const lateByOwner = new Map<Element, ContextEvent[]>();

	for (const event of events) {
		const owner = event.owner?.el ?? null;

		if (owner === null) {
			ownerless.push(event);
			continue;
		}

		if (!final && (owner === intended || owner === active)) {
			current.push(event);
			continue;
		}

		const list = lateByOwner.get(owner);

		if (list) {
			list.push(event);
		} else {
			lateByOwner.set(owner, [event]);
		}
	}

	const late: DrainLateChange[] = [];

	for (const [owner, list] of lateByOwner) {
		const marker = owner.getAttribute(markerAttr);
		const index = marker === null ? Number.NaN : Number(marker);

		late.push({
			...summarise(list).summary,
			index: Number.isFinite(index) ? index : null,
			html: openingHtml(owner),
		});
	}

	const { summary, form } = summarise(current);

	state.lastForm = form;

	const unattributed = ownerless.length > 0 ? summarise(ownerless).summary : null;

	if (final) {
		return { ...empty, late, unattributed };
	}

	const composedParent = (node: Node): Node | null =>
		node.parentNode ?? (node instanceof ShadowRoot ? node.host : null);

	const composedContains = (ancestor: Element, node: Element): boolean => {
		for (let current: Node | null = node; current; current = composedParent(current)) {
			if (current === ancestor) {
				return true;
			}
		}

		return false;
	};

	// A focus guard catches focus at the edge of a dialog and hands it to something inside. Dialog
	// libraries mostly mark theirs: react-focus-lock (`data-focus-guard`), Radix
	// (`data-radix-focus-guard`), Floating UI (`data-floating-ui-focus-guard`), Headless UI
	// (`data-headlessui-focus-guard`), MUI (`data-testid="sentinelStart"` and `sentinelEnd`) and the
	// Angular CDK (`cdk-focus-trap-anchor`), and any element hidden from assistive technology with
	// `aria-hidden="true"` is one a screen reader user is not meant to stop on either. One that is
	// not marked only counts when it is an element with nothing in it, no name and no role of its
	// own, and where it sends focus is in the dialog it sits in or right beside. An empty element
	// that sends focus somewhere unrelated is taking focus away, whatever it looks like.
	const isFocusGuard = (el: Element, destination: Element): boolean => {
		if (
			el.matches(
				'[data-focus-guard], [data-radix-focus-guard], [data-floating-ui-focus-guard], [data-headlessui-focus-guard], [data-testid="sentinelStart"], [data-testid="sentinelEnd"], .cdk-focus-trap-anchor, [aria-hidden="true"]',
			)
		) {
			return true;
		}

		if (
			el.matches(
				"a[href], button, input, select, textarea, summary, audio, video, iframe, [contenteditable]:not([contenteditable='false'])",
			)
		) {
			return false;
		}

		const role = el.getAttribute("role");

		if (role && role !== "none" && role !== "presentation") {
			return false;
		}

		if (
			(el.getAttribute("aria-label") ?? "").trim() !== "" ||
			(el.getAttribute("aria-labelledby") ?? "").trim() !== "" ||
			(el.getAttribute("title") ?? "").trim() !== ""
		) {
			return false;
		}

		if ((el.textContent ?? "").trim() !== "" || el.childElementCount > 0) {
			return false;
		}

		let dialog: Element | null = null;

		for (let node: Node | null = destination; node; node = composedParent(node)) {
			if (
				node.nodeType === 1 &&
				(node as Element).matches(
					'dialog, [role="dialog"], [role="alertdialog"], [aria-modal="true"]',
				)
			) {
				dialog = node as Element;
			}
		}

		if (dialog === null) {
			return false;
		}

		// Inside the dialog, or next to it: sentinels often sit beside the dialog element, inside
		// the wrapper it shares with its backdrop.
		const parent = composedParent(el);

		return (
			composedContains(dialog, el) ||
			(parent !== null && parent.nodeType === 1 && composedContains(parent as Element, dialog))
		);
	};

	let focusRemoved = false;
	let redirect: "outside" | "same-subtree" | null = null;
	let focusGuard = false;
	let attributedHtml: string | null = null;
	let hasAttributed = false;

	const bodyOrNone = !active || active === document.body || active === document.documentElement;

	if (intended && bodyOrNone) {
		focusRemoved = true;
		attributedHtml = openingHtml(intended);
		intended.setAttribute(attributedAttr, "1");
		hasAttributed = true;
	} else if (intended && active && intended !== active) {
		const same = composedContains(intended, active) || composedContains(active, intended);

		if (!same && isFocusGuard(intended, active)) {
			focusGuard = true;
		} else {
			redirect = same ? "same-subtree" : "outside";
			attributedHtml = openingHtml(intended);
			intended.setAttribute(attributedAttr, "1");
			hasAttributed = true;
		}
	}

	return {
		...summary,
		focusRemoved,
		redirect,
		focusGuard,
		navigation: false,
		attributedHtml,
		hasAttributed,
		hasSubmittedForm: form !== null,
		late,
		unattributed,
	};
}

/**
 * Wait, for at most `maxMs`, until every short timer that belongs to an element has come due,
 * including any those timers set in turn. Run before the last drain of a session, so that what the
 * last elements of the tab order deferred is still seen, and does not happen to the page after the
 * session has let go of it.
 */
export function awaitOwnedTimersScript(maxMs: number): Promise<void> {
	return new Promise((resolve) => {
		const state = window.__a11yContextObserver;

		if (!state) {
			resolve();

			return;
		}

		// Through the page's original `setTimeout`, so that the wait is not mistaken for the page's.
		const original = (
			window as Window & { __a11yPulseTimers?: { original: typeof window.setTimeout } }
		).__a11yPulseTimers?.original;
		// The page's timers cannot be relied on to fire (fake timers, a mocked clock), so a wait also
		// ends on the first animation frame past its time, whichever comes first.
		const later = (callback: () => void, ms: number): void => {
			const due = performance.now() + ms;
			let done = false;
			const finish = (): void => {
				if (!done) {
					done = true;
					callback();
				}
			};
			const frame = (): void => {
				if (done) {
					return;
				}

				if (performance.now() >= due) {
					finish();
				} else {
					requestAnimationFrame(frame);
				}
			};

			(original ?? window.setTimeout).call(window, finish, ms);
			requestAnimationFrame(frame);
		};
		const deadline = performance.now() + maxMs;

		// No element has set a timer all session: there is nothing to wait for.
		if (state.ownedDue === 0) {
			resolve();

			return;
		}

		const check = (): void => {
			const now = performance.now();

			if (now >= deadline) {
				resolve();

				return;
			}

			// Every timer has run, and none of them set another: one that did has moved `ownedDue` on
			// before its own run was counted.
			if (state.ownedRan >= state.ownedDue) {
				resolve();

				return;
			}

			// Queued behind the timer it is waiting for, which is due no later. A timer that has come
			// due may still be waiting its turn, behind other work or a busy browser; until it has run,
			// look again on the next turn.
			later(check, Math.max(Math.min(state.ownedDue, deadline) - now, 0) + 1);
		};

		check();
	});
}

/**
 * Return the element marked as attributed by drainContextObserverScript (the element that received
 * a focus event this stop and then lost it), if any.
 */
export function attributedHandleScript(): Element | null {
	return document.querySelector("[data-a11y-ctx-attr]");
}

/** The form behind the submission the last drain reported, if any. */
export function submittedFormHandleScript(): Element | null {
	return window.__a11yContextObserver?.lastForm ?? null;
}

export function clearAttributedScript(): void {
	for (const marked of Array.from(document.querySelectorAll("[data-a11y-ctx-attr]"))) {
		marked.removeAttribute("data-a11y-ctx-attr");
	}
}

/**
 * Drop focusin history accumulated after drain (e.g. pixel-diff blur/refocus) so the next tab stop
 * does not mis-attribute F55 or redirects. What a timer has done for an element other than the
 * focused one is kept: the blur and refocus cannot have caused it.
 */
export function clearContextFocusInsScript(): void {
	const state = window.__a11yContextObserver;

	if (state) {
		let active = document.activeElement;

		while (active?.shadowRoot?.activeElement) {
			active = active.shadowRoot.activeElement;
		}

		state.focusIns = [];
		state.events = state.events.filter((event) => {
			const owner = event.owner?.el ?? null;

			return owner !== null && owner !== active;
		});
	}
}

/** Current location.href for navigation comparison in the host. */
export function locationHrefScript(): string {
	return location.href;
}

export function hasFocusScript(): boolean {
	return document.hasFocus();
}

/**
 * Wait for the page to take in a Tab press before the focused element is measured, for at most
 * `maxMs`. One animation frame lets whatever the page's focus handlers deferred to a microtask or
 * to their own `requestAnimationFrame` callback run first, and any timer they set that comes due
 * within `maxMs` is waited for too (`installTabObserverScript` notes those). Beyond that, the rest
 * of `maxMs` is only spent when something about the focused element is still in motion: a CSS
 * transition or animation on it, its ancestors or its descendants, or a smooth scroll bringing it
 * into view.
 */
export function settleScript(maxMs: number): Promise<void> {
	return new Promise((resolve) => {
		const win = window as TabObserverWindow;
		const timers = win.__a11yPulseTimers;
		const deadline = performance.now() + maxMs;
		let settled = false;

		// The settle's own timers go through the page's original `setTimeout`, so they are not
		// mistaken for the page's. That function is still the page's to have replaced before the
		// session began (fake timers, a mocked clock) with one that never fires, so each wait also
		// ends on the first animation frame past its time. Whichever comes first runs the callback.
		const later = (callback: () => void, ms: number): void => {
			const due = performance.now() + ms;
			let ran = false;

			const run = (): void => {
				if (!ran) {
					ran = true;
					callback();
				}
			};

			const frame = (): void => {
				if (ran) {
					return;
				}

				if (performance.now() >= due) {
					run();
				} else {
					requestAnimationFrame(frame);
				}
			};

			try {
				(timers?.original ?? window.setTimeout).call(window, run, ms);
			} catch {}

			try {
				requestAnimationFrame(frame);
			} catch {}
		};

		const finish = (): void => {
			if (!settled) {
				settled = true;
				resolve();
			}
		};

		const inMotion = (): boolean => {
			let el = document.activeElement;

			while (el?.shadowRoot?.activeElement) {
				el = el.shadowRoot.activeElement;
			}

			if (!el || el === document.body || el === document.documentElement) {
				return false;
			}

			// A transition only exists once styles have been recalculated for the focused state.
			void getComputedStyle(el).opacity;

			// Scrolling into view is animated wherever a scroller on the way up asks for it.
			for (let node: Element | null = el; node; ) {
				if (getComputedStyle(node).scrollBehavior === "smooth") {
					return true;
				}

				node = node.parentElement ?? (node.getRootNode() as ShadowRoot).host ?? null;
			}

			if (typeof document.getAnimations !== "function") {
				return true;
			}

			const inShadowTree = el.getRootNode() !== document;

			for (const animation of document.getAnimations()) {
				if (animation.playState !== "running" && !animation.pending) {
					continue;
				}

				const target = (animation.effect as KeyframeEffect | null)?.target ?? null;

				// `contains` stops at shadow boundaries, so inside a shadow tree any running animation
				// counts rather than risk missing one on a host.
				if (
					!target ||
					inShadowTree ||
					target === el ||
					target.contains(el) ||
					el.contains(target)
				) {
					return true;
				}
			}

			return false;
		};

		// The decision, taken once the frame and every timer the page set for the press have run.
		const decide = (): void => {
			if (settled) {
				return;
			}

			const now = performance.now();
			const due = win.__a11yPulseTimerDue ?? 0;
			const ran = win.__a11yPulseTimerRan ?? 0;

			// A timer the page set since the press and that falls inside the limit: let it run, then
			// look again, since what it does may set another. One that falls outside the limit was
			// never going to be waited for. A timer the page cleared is waited for until the limit.
			if (due > 0 && due <= deadline && now < deadline && (due > now - 1 || ran < due)) {
				later(decide, Math.max(due - now, 0) + 1);

				return;
			}

			let moving = true;

			try {
				moving = inMotion();
			} catch {}

			if (!moving || deadline - now <= 0) {
				finish();
			} else {
				later(finish, deadline - now);
			}
		};

		if (timers === undefined) {
			// Nothing is watching the page's timers, so there is no telling what it has deferred.
			later(finish, maxMs);

			return;
		}

		// A timer of the settle's own is queued behind any the page has already set for the same
		// moment, so the page's zero-delay timers run before the decision is taken.
		requestAnimationFrame(() => later(decide, 0));

		// A page that is not being rendered (a background tab) never gets its animation frame.
		later(finish, maxMs);
	});
}
