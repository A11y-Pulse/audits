/**
 * IMPORTANT: The `*Script` functions in this file are serialized and injected into the audited page,
 * so they must not reference any symbols outside their own scope.
 */

import type { BrowserAdaptor, ElementRef, Rect } from "./adaptor";
import { bufferedClip } from "./clip";

export function pageDimensionsScript(): { width: number; height: number } {
	return {
		width: document.documentElement.scrollWidth,
		height: document.documentElement.scrollHeight,
	};
}

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
 * Whether the element should be centred in the viewport before its screenshots are taken: either
 * something unrelated covers its centre, or its screenshot clip (its box padded by `buffer`, cut
 * off at the document edges like bufferedClip) reaches past an edge of the viewport. A capture only
 * shows what is inside the viewport, so such a clip would lose an indicator drawn in the padding. A
 * clip larger than the viewport does not count, since scrolling cannot fit it anyway.
 */
export function needsCentringScript(el: Element | null, buffer: number): boolean {
	if (!el) {
		return false;
	}

	const rect = el.getBoundingClientRect();
	// In quirks mode the viewport's size is on <body>, and <html> measures the whole document.
	const viewport = document.scrollingElement ?? document.documentElement;
	const viewportWidth = viewport.clientWidth;
	const viewportHeight = viewport.clientHeight;

	const x = Math.min(Math.max(rect.left + rect.width / 2, 0), viewportWidth - 1);
	const y = Math.min(Math.max(rect.top + rect.height / 2, 0), viewportHeight - 1);

	let hit = document.elementFromPoint(x, y);

	while (hit?.shadowRoot) {
		const inner = hit.shadowRoot.elementFromPoint(x, y);

		if (!inner || inner === hit) {
			break;
		}

		hit = inner;
	}

	if (hit && hit !== el && !el.contains(hit) && !hit.contains(el)) {
		return true;
	}

	const docLeft = -window.scrollX;
	const docTop = -window.scrollY;
	const left = Math.max(rect.left - buffer, docLeft);
	const top = Math.max(rect.top - buffer, docTop);
	const right = Math.min(rect.right + buffer, docLeft + document.documentElement.scrollWidth);
	const bottom = Math.min(rect.bottom + buffer, docTop + document.documentElement.scrollHeight);

	if (right - left > viewportWidth || bottom - top > viewportHeight) {
		return false;
	}

	return left < 0 || top < 0 || right > viewportWidth || bottom > viewportHeight;
}

/**
 * Scroll the window so the element sits at the vertical centre of the viewport and is inside it
 * horizontally with `buffer` to spare, instantly so a screenshot taken immediately afterwards isn't
 * captured mid-animation. Scrolls the window directly rather than via scrollIntoView(): Chromium
 * moves the sequential focus navigation starting point to the element passed to scrollIntoView(),
 * so when focus cannot be handed back afterwards (a closed shadow host) the next Tab would re-enter
 * the same element instead of moving on.
 */
export function scrollToCenterScript(el: Element | null, buffer = 0): void {
	if (!el) {
		return;
	}

	const rect = el.getBoundingClientRect();
	// In quirks mode the viewport's size is on <body>, and <html> measures the whole document.
	const viewport = document.scrollingElement ?? document.documentElement;
	const viewportWidth = viewport.clientWidth;
	const top = rect.top + rect.height / 2 - viewport.clientHeight / 2;
	let left = 0;

	if (rect.left - buffer < 0) {
		left = rect.left - buffer;
	} else if (rect.right + buffer > viewportWidth) {
		left = Math.min(rect.right + buffer - viewportWidth, rect.left - buffer);
	}

	window.scrollBy({ top, left, behavior: "instant" });
}

export type ElementScreenshotOptions = {
	/** Padding around the element's box. */
	clipBuffer: number;
	/** How long to wait (ms) after scrolling for the page to settle. */
	settleDelay: number;
};

/**
 * Screenshot the element `handle` refers to, clipped to its box plus `clipBuffer` padding, first
 * centring it in the viewport when its clip would not fit or something covers it. The caller owns
 * `handle`.
 */
export async function captureElementScreenshot(
	adaptor: Pick<BrowserAdaptor, "evaluate" | "screenshotClip" | "screenshotClipScale">,
	handle: ElementRef,
	options: ElementScreenshotOptions,
): Promise<Uint8Array> {
	if (await adaptor.evaluate(needsCentringScript, handle, options.clipBuffer)) {
		await adaptor.evaluate(scrollToCenterScript, handle, options.clipBuffer);
		await new Promise((resolve) => setTimeout(resolve, options.settleDelay));
	}

	const { width: pageWidth, height: pageHeight } = await adaptor.evaluate(pageDimensionsScript);
	const rect = await adaptor.evaluate(elementRectScript, handle);
	const clip = bufferedClip(rect, pageWidth, pageHeight, options.clipBuffer);

	return adaptor.screenshotClip(clip, adaptor.screenshotClipScale ?? 1);
}
