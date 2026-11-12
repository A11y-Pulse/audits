/**
 * IMPORTANT: Functions in this file are serialized and injected into the audited page, so they must
 * not reference any symbols outside their own scope.
 */

/** The attribute or element the text alternative was read from. */
export type AltTextSource = "aria-label" | "alt" | "title";

export type CollectedImage = {
	/** The `aria-label`, or the `alt` or SVG `<title>` when there is no `aria-label`, trimmed. */
	altText: string;
	/** Where `altText` was read from. `title` is the `<title>` of an inline SVG. */
	altTextSource: AltTextSource;
	/** The alt text was longer than the collection limit and has been cut short. */
	truncated: boolean;
	/**
	 * Absolute URLs from `src` and `currentSrc`, from the lazy-loading attributes `data-src`,
	 * `data-lazy-src` and `data-original`, and from the CSS background image of a `role="img"`
	 * element.
	 */
	urls: string[];
	/**
	 * Raw `srcset`, `data-srcset` and `data-lazy-srcset` values from the image and any `<source>` in
	 * its `<picture>`.
	 */
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
 * Collect every rendered `<img>`, `<input type="image">`, `<area>`, and element or inline SVG with
 * `role="img"` that has a text alternative, descending open shadow roots. The collected elements
 * are left on `window[stashKey]`, in the same order.
 */
export function collectImagesScript(
	stashKey: string,
	imageLimit: number,
	altTextLimit: number,
): ImageCollection {
	const LAZY_URL_ATTRIBUTES = ["data-src", "data-lazy-src", "data-original"];
	const SRCSET_ATTRIBUTES = ["srcset", "data-srcset", "data-lazy-srcset"];

	const elements: Element[] = [];
	const images: CollectedImage[] = [];
	let total = 0;

	const isRendered = (el: Element): boolean =>
		typeof el.checkVisibility === "function"
			? el.checkVisibility({ visibilityProperty: true })
			: el.getClientRects().length > 0;

	const roleOf = (el: Element): string =>
		el.getAttribute("role")?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";

	type Kind = "img" | "input" | "area" | "role-img";

	const kindOf = (el: Element): Kind | null => {
		if (el instanceof HTMLImageElement) {
			return "img";
		}

		if (el instanceof HTMLInputElement) {
			return el.type === "image" ? "input" : null;
		}

		if (el instanceof HTMLAreaElement) {
			return el.hasAttribute("href") ? "area" : null;
		}

		return roleOf(el) === "img" ? "role-img" : null;
	};

	const altTextOf = (el: Element, kind: Kind): { text: string; source: AltTextSource } | null => {
		const label = el.getAttribute("aria-label")?.trim();

		if (label) {
			return { text: label, source: "aria-label" };
		}

		if (kind === "role-img") {
			const title =
				el.localName === "svg"
					? Array.from(el.children)
							.find((child) => child.localName === "title")
							?.textContent?.trim()
					: "";

			return title ? { text: title, source: "title" } : null;
		}

		const alt = el.getAttribute("alt")?.trim();

		return alt ? { text: alt, source: "alt" } : null;
	};

	const absolute = (url: string): string => {
		if (!url) {
			return "";
		}

		try {
			return new URL(url, document.baseURI).href;
		} catch {
			return "";
		}
	};

	const attributeValues = (el: Element, attributes: readonly string[]): string[] =>
		attributes.map((attribute) => el.getAttribute(attribute)?.trim() ?? "");

	const backgroundUrls = (el: Element): string[] =>
		Array.from(getComputedStyle(el).backgroundImage.matchAll(/url\((["']?)(.*?)\1\)/g), (match) =>
			absolute(match[2] ?? ""),
		);

	const visit = (root: Document | ShadowRoot): void => {
		for (const el of Array.from(root.querySelectorAll("*"))) {
			if (el.shadowRoot) {
				visit(el.shadowRoot);
			}

			const kind = kindOf(el);

			if (!kind) {
				continue;
			}

			// The accessible name comes from elsewhere, which this audit does not compute.
			if (el.getAttribute("aria-labelledby")?.trim()) {
				continue;
			}

			// A presentational image has no text alternative for its alt to be.
			if (kind !== "role-img" && ["presentation", "none"].includes(roleOf(el))) {
				continue;
			}

			const altText = altTextOf(el, kind);

			// An <area> has no box of its own; its image map's image decides whether it is rendered.
			if (!altText || el.closest('[aria-hidden="true"]') || (kind !== "area" && !isRendered(el))) {
				continue;
			}

			total++;

			if (images.length === imageLimit) {
				continue;
			}

			const urls: string[] = [];
			const srcsets: string[] = [];

			if (kind === "img" || kind === "input") {
				urls.push((el as HTMLImageElement | HTMLInputElement).src);
				urls.push(...attributeValues(el, LAZY_URL_ATTRIBUTES).map(absolute));
			}

			if (el instanceof HTMLImageElement) {
				urls.push(el.currentSrc);
				srcsets.push(...attributeValues(el, SRCSET_ATTRIBUTES));

				if (el.parentElement instanceof HTMLPictureElement) {
					for (const source of Array.from(el.parentElement.querySelectorAll(":scope > source"))) {
						srcsets.push(...attributeValues(source, SRCSET_ATTRIBUTES));
					}
				}
			}

			if (kind === "role-img" && el.localName !== "svg") {
				urls.push(...backgroundUrls(el));
			}

			elements.push(el);
			images.push({
				altText: altText.text.slice(0, altTextLimit),
				altTextSource: altText.source,
				truncated: altText.text.length > altTextLimit,
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
 * Wait up to `timeoutMs` in total for the images at `indices` of `window[stashKey]` that have not
 * finished loading, loading lazy ones eagerly so they do not wait to be scrolled near. An image
 * that has already failed to load is not waited for.
 */
export async function awaitImagesScript(
	stashKey: string,
	indices: number[],
	timeoutMs: number,
): Promise<void> {
	const stash = (window as unknown as Record<string, unknown>)[stashKey];
	const pending = (Array.isArray(stash) ? indices.map((index) => stash[index]) : []).filter(
		// `complete` is also true for an image whose load has failed.
		(el): el is HTMLImageElement => el instanceof HTMLImageElement && !el.complete,
	);

	if (pending.length === 0) {
		return;
	}

	const restore = pending.map((el) => {
		const loading = el.loading;
		el.loading = "eager";

		return (): void => {
			el.loading = loading;
		};
	});

	const settled = pending.map(
		(el) =>
			new Promise<void>((resolve) => {
				el.addEventListener("load", () => resolve(), { once: true });
				el.addEventListener("error", () => resolve(), { once: true });
			}),
	);

	await Promise.race([
		Promise.all(settled),
		new Promise<void>((resolve) => {
			setTimeout(resolve, timeoutMs);
		}),
	]);

	for (const undo of restore) {
		undo();
	}
}
