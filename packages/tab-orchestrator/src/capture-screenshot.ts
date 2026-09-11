import type { BrowserAdaptor, ElementRef } from "@a11y-pulse/browser-adaptor";
import { bufferedClip } from "@a11y-pulse/browser-adaptor";
import { elementRectScript, pageDimensionsScript } from "./browser-scripts";

export type CaptureScreenshotOptions = {
	screenshotClipBuffer: number;
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
	const { width: pageWidth, height: pageHeight } = await adaptor.evaluate(pageDimensionsScript);
	const rect = await adaptor.evaluate(elementRectScript, handle);
	const clip = bufferedClip(rect, pageWidth, pageHeight, options.screenshotClipBuffer);
	const scale = adaptor.screenshotClipScale ?? 1;

	return adaptor.screenshotClip(clip, scale);
}
