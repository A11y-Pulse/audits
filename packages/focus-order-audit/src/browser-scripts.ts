import type { PageGeometry } from "./analyse";

// Every function here is serialised and run in the page, so none may reference anything outside its
// own body.

export type PageContext = PageGeometry & {
	/** Some element on the page has a positive `tabindex`, which axe-core reports separately. */
	positiveTabindex: boolean;
	href: string;
};

/**
 * The page's reading direction and size, whether it uses positive `tabindex` values, and its URL.
 */
export function pageContextScript(): PageContext {
	const root = document.documentElement;
	const style = getComputedStyle(document.body ?? root);
	const writingMode = style.writingMode.startsWith("vertical-")
		? (style.writingMode as "vertical-rl" | "vertical-lr")
		: "horizontal-tb";

	return {
		viewportWidth: root.clientWidth,
		viewportHeight: root.clientHeight,
		layoutWidth: root.scrollWidth,
		layoutHeight: root.scrollHeight,
		direction: style.direction === "rtl" ? "rtl" : "ltr",
		writingMode,
		positiveTabindex: Array.from(document.querySelectorAll<HTMLElement>("[tabindex]")).some(
			(element) => element.tabIndex > 0,
		),
		href: location.href,
	};
}

/**
 * The `tabindex` of each element named by a selector (see getSelector, whose ` >>> ` steps into a
 * shadow root), or null where the selector no longer finds one.
 */
export function tabindexValuesScript(selectors: string[]): Array<number | null> {
	return selectors.map((selector) => {
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

		return element instanceof HTMLElement || element instanceof SVGElement
			? element.tabIndex
			: null;
	});
}
