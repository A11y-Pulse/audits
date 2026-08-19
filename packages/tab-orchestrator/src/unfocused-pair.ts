import type { BrowserAdaptor, ElementRef } from "./adaptor";
import {
	blurScript,
	elementRectScript,
	elementStylesScript,
	focusScript,
	isCenterObscuredScript,
	pageDimensionsScript,
	scrollToCenterScript,
} from "./browser-scripts";
import { bufferedClip } from "./clip";
import type { UnfocusedPair } from "./types";

export type CaptureUnfocusedPairOptions = {
	screenshotSettleDelay: number;
	screenshotClipBuffer: number;
	styleProps: readonly string[];
};

/**
 * Capture focused and unfocused screenshots of the same element, plus the
 * unfocused style snapshot and clip anchors appearance needs to score later.
 *
 * The caller owns `handle` and must dispose it after this promise settles.
 */
export async function captureUnfocusedPair(
	adaptor: BrowserAdaptor,
	options: CaptureUnfocusedPairOptions,
	handle: ElementRef,
): Promise<UnfocusedPair> {
	// Tab scrolls an element just barely into view at the viewport edge, which
	// is exactly where fixed overlays (cookie banners, sticky footers) sit. If
	// something covers the element there, both screenshots would show the
	// overlay and no indicator could ever be detected — centre the element in
	// the viewport first, then give the scroll a moment to settle.
	if (await adaptor.evaluate(isCenterObscuredScript, handle)) {
		await adaptor.evaluate(scrollToCenterScript, handle);

		await new Promise((resolve) =>
			setTimeout(resolve, options.screenshotSettleDelay),
		);
	}

	const { width: pageWidth, height: pageHeight } =
		await adaptor.evaluate(pageDimensionsScript);

	const focusedRect = await adaptor.evaluate(elementRectScript, handle);
	const focusedClip = bufferedClip(
		focusedRect,
		pageWidth,
		pageHeight,
		options.screenshotClipBuffer,
	);

	const scale = adaptor.screenshotClipScale ?? 1;

	// Capture the focused state first, while focus is genuine: re-focusing the
	// element afterwards cannot always restore it (the host of a closed shadow
	// root cannot push focus back inside), so the focused frame must be taken
	// before blurring.
	const focusedScreenshot = await adaptor.screenshotClip(focusedClip, scale);

	await adaptor.evaluate(blurScript, handle);

	// Measure the unfocused rect after blurring rather than reusing a stale
	// baseline rect: a :focus rule may have moved the element, and a
	// fixed-position element's page-relative rect changes with every scroll.
	const unfocusedRect = await adaptor.evaluate(elementRectScript, handle);
	const unfocusedClip = bufferedClip(
		unfocusedRect,
		pageWidth,
		pageHeight,
		options.screenshotClipBuffer,
	);

	const unfocusedScreenshot = await adaptor.screenshotClip(
		unfocusedClip,
		scale,
	);

	const unfocusedStyles = await adaptor.evaluate(elementStylesScript, handle, [
		...options.styleProps,
	]);

	// Restore focus so the next Tab advances from this element rather than
	// restarting traversal. (A closed-shadow host can't be re-focused into the
	// root; the loop still progresses because Tab re-enters from there.)
	await adaptor.evaluate(focusScript, handle);

	return {
		focusedScreenshot,
		unfocusedScreenshot,
		unfocusedStyles,
		focusedRect,
		unfocusedRect,
		focusedClip,
		unfocusedClip,
		scale,
	};
}
