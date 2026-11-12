/**
 * Page scripts for the scrolled-to-top check.
 *
 * IMPORTANT: every function here is serialised and injected into the audited page, so it must not
 * reference any symbol outside its own scope.
 */

type ScrollCheckWindow = Window & {
	__a11yPulseScrollCheck?: {
		el: Element;
		saved: Array<{ node: Element | null; left: number; top: number }>;
	};
	__a11yPulseInertCovers?: unknown;
};

/**
 * Whether the page has content pinned to the top of the viewport that something could scroll
 * under: a fixed element in the top third, or a sticky one that sticks near the top. A page with
 * none, or one that cannot scroll, has nothing for the scrolled-to-top check to find.
 */
export function hasTopPinnedContentScript(): boolean {
	const scroller = document.scrollingElement ?? document.documentElement;

	if (scroller.scrollHeight <= window.innerHeight + 1) {
		return false;
	}

	const limit = window.innerHeight / 3;

	for (const node of Array.from(document.querySelectorAll("*"))) {
		const cs = getComputedStyle(node);

		if (cs.position !== "fixed" && cs.position !== "sticky") {
			continue;
		}

		if (cs.display === "none" || cs.visibility !== "visible") {
			continue;
		}

		const rect = node.getBoundingClientRect();

		if (rect.width < 1 || rect.height < 1) {
			continue;
		}

		if (cs.position === "fixed") {
			if (rect.top < limit && rect.bottom > 0) {
				return true;
			}

			continue;
		}

		const top = Number.parseFloat(cs.top);

		if (Number.isFinite(top) && top < limit) {
			return true;
		}
	}

	return false;
}

/**
 * Scroll the element `selector` names to the top edge of its scroller, the way the browser does
 * when focus moves up the page to it, honouring `scroll-padding-top` and `scroll-margin-top`.
 * Remembers every scroll position it may have changed so `restoreScrollScript` can put them back.
 * Resolves to `false` when the selector matches nothing.
 */
export function scrollToTopEdgeScript(selector: string): Promise<boolean> {
	let scope: ParentNode = document;
	let el: Element | null = null;

	for (const part of selector.split(" >>> ")) {
		try {
			el = scope.querySelector(part);
		} catch {
			el = null;
		}

		if (!el) {
			return Promise.resolve(false);
		}

		scope = el.shadowRoot ?? el;
	}

	if (!el) {
		return Promise.resolve(false);
	}

	const saved: Array<{ node: Element | null; left: number; top: number }> = [
		{ node: null, left: window.scrollX, top: window.scrollY },
	];

	for (let node: Element | null = el.parentElement; node; node = node.parentElement) {
		if (node.scrollHeight > node.clientHeight || node.scrollWidth > node.clientWidth) {
			saved.push({ node, left: node.scrollLeft, top: node.scrollTop });
		}
	}

	(window as ScrollCheckWindow).__a11yPulseScrollCheck = { el, saved };

	el.scrollIntoView({ block: "start", inline: "nearest", behavior: "instant" });

	// Two frames, so anything that reacts to the scroll has had a chance to. A page that is not
	// being rendered (a background tab) never gets its frames, so a timer ends the wait as well.
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)));
		setTimeout(() => resolve(true), 200);
	});
}

/** The element `scrollToTopEdgeScript` last scrolled. */
export function scrolledElementScript(): Element | null {
	return (window as ScrollCheckWindow).__a11yPulseScrollCheck?.el ?? null;
}

/** Put back every scroll position `scrollToTopEdgeScript` remembered, and forget them. */
export function restoreScrollScript(): void {
	const win = window as ScrollCheckWindow;
	const state = win.__a11yPulseScrollCheck;

	delete win.__a11yPulseScrollCheck;
	delete win.__a11yPulseInertCovers;

	if (!state) {
		return;
	}

	for (const { node, left, top } of state.saved) {
		if (node) {
			node.scrollTo({ left, top, behavior: "instant" });
		} else {
			window.scrollTo({ left, top, behavior: "instant" });
		}
	}
}
