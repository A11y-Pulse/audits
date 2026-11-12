import type { BrowserAdaptor, ElementRef } from "@a11y-pulse/browser-adaptor";
import { bufferedClip } from "@a11y-pulse/browser-adaptor";
import { runComposed } from "./compose-script";
import { clipTargetScript } from "./session-scripts";

export type CaptureScreenshotOptions = {
	screenshotClipBuffer: number;
	/** Send the page scripts in one call. Defaults to one call per script. */
	composed?: boolean;
};

/**
 * Screenshot the element `handle` currently refers to, clipped to its box plus
 * `screenshotClipBuffer` padding. The caller owns `handle` and must dispose it after this promise
 * settles.
 */
export async function captureScreenshot(
	adaptor: BrowserAdaptor,
	options: CaptureScreenshotOptions,
	handle: ElementRef,
): Promise<Uint8Array> {
	const { page, rect } = await runComposed(
		adaptor,
		clipTargetScript,
		{ composed: options.composed ?? false },
		{ buffer: options.screenshotClipBuffer, centre: false, settleMs: 0 },
		handle,
	);
	const clip = bufferedClip(rect, page.width, page.height, options.screenshotClipBuffer);
	const scale = adaptor.screenshotClipScale ?? 1;

	return adaptor.screenshotClip(clip, scale);
}

const CONTEXT_OUTLINE_ATTR = "data-a11y-context-outline";

export type ContextClip = {
	/** Page-relative strip to capture: the width of the viewport, around the element. */
	clip: { x: number; y: number; width: number; height: number };
};

/**
 * Draw a box over where `el` is, above everything else in the page, and say which strip of the
 * viewport shows it. The box is what makes the element findable in a capture of something that
 * hides it. It takes no pointer events and is removed by `removeContextOutlineScript`.
 */
export function addContextOutlineScript(
	el: Element | null,
	attr: string,
	margin: number,
): Promise<ContextClip> {
	const viewport = {
		x: window.scrollX,
		y: window.scrollY,
		width: window.innerWidth,
		height: window.innerHeight,
	};

	for (const stale of Array.from(document.querySelectorAll(`[${attr}]`))) {
		stale.remove();
	}

	if (!el) {
		return Promise.resolve({ clip: viewport });
	}

	const rect = el.getBoundingClientRect();
	const top = Math.max(0, rect.top - margin);
	const bottom = Math.min(window.innerHeight, rect.bottom + margin);

	// An element outside the viewport cannot be shown where it is: capture what the user sees.
	if (bottom <= top || rect.right <= 0 || rect.left >= window.innerWidth) {
		return Promise.resolve({ clip: viewport });
	}

	const box = document.createElement("div");

	box.setAttribute(attr, "");
	box.setAttribute("aria-hidden", "true");
	box.style.cssText = [
		"all: initial",
		"position: fixed",
		`left: ${rect.left}px`,
		`top: ${rect.top}px`,
		`width: ${rect.width}px`,
		`height: ${rect.height}px`,
		"box-sizing: border-box",
		"outline: 3px dashed #e6007a",
		"outline-offset: 2px",
		"box-shadow: 0 0 0 1px #ffffff",
		"pointer-events: none",
		"z-index: 2147483647",
	]
		.map((declaration) => `${declaration} !important`)
		.join("; ");
	document.documentElement.appendChild(box);

	const clip = {
		x: window.scrollX,
		y: window.scrollY + top,
		width: window.innerWidth,
		height: bottom - top,
	};

	// Two frames, so the box has been painted by the time the capture is taken. A page that is not
	// being rendered (a background tab) never gets its frames, so a timer ends the wait as well.
	return new Promise((resolve) => {
		requestAnimationFrame(() => requestAnimationFrame(() => resolve({ clip })));
		setTimeout(() => resolve({ clip }), 200);
	});
}

export function removeContextOutlineScript(attr: string): void {
	for (const box of Array.from(document.querySelectorAll(`[${attr}]`))) {
		box.remove();
	}
}

/** How far above and below the element a context screenshot reaches. */
export const CONTEXT_SCREENSHOT_MARGIN = 160;

/**
 * Screenshot a strip the width of the viewport around the element `handle` refers to, with the
 * element's box outlined. Unlike `captureScreenshot`, this shows what the element sits behind when
 * something covers it. The caller owns `handle`.
 */
export async function captureContextScreenshot(
	adaptor: BrowserAdaptor,
	handle: ElementRef,
	margin: number = CONTEXT_SCREENSHOT_MARGIN,
): Promise<Uint8Array> {
	try {
		const { clip } = await adaptor.evaluate(
			addContextOutlineScript,
			handle,
			CONTEXT_OUTLINE_ATTR,
			margin,
		);

		return await adaptor.screenshotClip(clip, adaptor.screenshotClipScale ?? 1);
	} finally {
		try {
			await adaptor.evaluate(removeContextOutlineScript, CONTEXT_OUTLINE_ATTR);
		} catch {
			// The page went away; there is nothing left to tidy.
		}
	}
}
