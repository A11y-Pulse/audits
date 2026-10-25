/**
 * IMPORTANT: Functions in this file are serialized and injected into the audited page, so they must
 * not reference any symbols outside their own scope.
 */

export type CollectedImage = {
	/** The `aria-label`, or the `alt` when there is no `aria-label`, trimmed. */
	altText: string;
	/** The alt text was longer than the collection limit and has been cut short. */
	truncated: boolean;
	/** Absolute URLs from `src` and `currentSrc`. */
	urls: string[];
	/** Raw `srcset` values from the image and any `<source>` in its `<picture>`. */
	srcsets: string[];
	/** Shallow outerHTML. */
	html: string;
};

export type ImageCollection = {
	lang: string | null;
	baseUrl: string;
	images: CollectedImage[];
	/** Every image with alt text, including those past the collection limit. */
	total: number;
};

/**
 * Collect every rendered `<img>` and `<input type="image">` that has alt text, descending open
 * shadow roots. The collected elements are left on `window[stashKey]`, in the same order.
 */
export function collectImagesScript(
	stashKey: string,
	imageLimit: number,
	altTextLimit: number,
): ImageCollection {
	const elements: Element[] = [];
	const images: CollectedImage[] = [];
	let total = 0;

	const isRendered = (el: Element): boolean =>
		typeof el.checkVisibility === "function"
			? el.checkVisibility({ visibilityProperty: true })
			: el.getClientRects().length > 0;

	const altTextOf = (el: Element): string =>
		el.getAttribute("aria-label")?.trim() || el.getAttribute("alt")?.trim() || "";

	const visit = (root: Document | ShadowRoot): void => {
		for (const el of Array.from(root.querySelectorAll("*"))) {
			if (el.shadowRoot) {
				visit(el.shadowRoot);
			}

			const isImage = el instanceof HTMLImageElement;

			if (!isImage && !(el instanceof HTMLInputElement && el.type === "image")) {
				continue;
			}

			// The accessible name comes from elsewhere, which this audit does not compute.
			if (el.getAttribute("aria-labelledby")?.trim()) {
				continue;
			}

			const altText = altTextOf(el);

			if (!altText || el.closest('[aria-hidden="true"]') || !isRendered(el)) {
				continue;
			}

			total++;

			if (images.length === imageLimit) {
				continue;
			}

			const src = (el as HTMLImageElement | HTMLInputElement).src;
			const urls = [src];
			const srcsets: string[] = [];

			if (isImage) {
				urls.push(el.currentSrc);
				srcsets.push(el.getAttribute("srcset") ?? "");

				if (el.parentElement instanceof HTMLPictureElement) {
					for (const source of Array.from(el.parentElement.querySelectorAll(":scope > source"))) {
						srcsets.push(source.getAttribute("srcset") ?? "");
					}
				}
			}

			elements.push(el);
			images.push({
				altText: altText.slice(0, altTextLimit),
				truncated: altText.length > altTextLimit,
				urls: [...new Set(urls.filter(Boolean))],
				srcsets: srcsets.filter(Boolean),
				html: (el.cloneNode(false) as Element).outerHTML,
			});
		}
	};

	visit(document);

	(window as unknown as Record<string, unknown>)[stashKey] = elements;

	return {
		lang: document.documentElement.getAttribute("lang"),
		baseUrl: document.baseURI,
		images,
		total,
	};
}

export function scrollPositionScript(): { x: number; y: number } {
	return { x: window.scrollX, y: window.scrollY };
}

export function restoreScrollScript(position: { x: number; y: number }): void {
	window.scrollTo({ left: position.x, top: position.y, behavior: "instant" });
}

/**
 * Wait up to `timeoutMs` for an image that has not finished loading, loading a lazy one eagerly so
 * it does not wait to be scrolled near.
 */
export async function awaitImageScript(el: Element | null, timeoutMs: number): Promise<void> {
	if (!(el instanceof HTMLImageElement) || el.complete) {
		return;
	}

	const loading = el.loading;
	el.loading = "eager";

	await new Promise<void>((resolve) => {
		const timer = setTimeout(resolve, timeoutMs);
		const done = (): void => {
			clearTimeout(timer);
			resolve();
		};

		el.addEventListener("load", done, { once: true });
		el.addEventListener("error", done, { once: true });
	});

	el.loading = loading;
}
