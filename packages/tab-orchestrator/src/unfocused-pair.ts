import type { BrowserAdaptor, ElementRef } from "@a11y-pulse/browser-adaptor";
import { bufferedClip } from "@a11y-pulse/browser-adaptor";
import { truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import { runComposed } from "./compose-script";
import {
	PAIR_TRANSITION_WAIT_MS,
	pairBlurredScript,
	pairFocusedScript,
	pairRestoreScript,
} from "./pair-scripts";
import type { PairContext, UnfocusedPair } from "./types";

/** How many ancestors of the focused element have their styles compared with and without focus. */
const CONTEXT_ANCESTOR_LIMIT = 3;

export type CaptureUnfocusedPairOptions = {
	screenshotSettleDelay: number;
	screenshotClipBuffer: number;
	styleProps: readonly string[];
	/** Send each step's page scripts in one call. Defaults to one call per script. */
	composed?: boolean;
};

export async function captureUnfocusedPair(
	adaptor: BrowserAdaptor,
	options: CaptureUnfocusedPairOptions,
	borrowedElement: ElementRef,
): Promise<UnfocusedPair> {
	const run = { composed: options.composed ?? false };
	const styleProps = [...options.styleProps];

	const focused = await runComposed(
		adaptor,
		pairFocusedScript,
		run,
		{
			buffer: options.screenshotClipBuffer,
			settleMs: options.screenshotSettleDelay,
			transitionMs: PAIR_TRANSITION_WAIT_MS,
			styleProps,
			ancestorLimit: CONTEXT_ANCESTOR_LIMIT,
		},
		borrowedElement,
	);

	const { page, rect: focusedRect } = focused;

	const focusedClip = bufferedClip(
		focusedRect,
		page.width,
		page.height,
		options.screenshotClipBuffer,
	);

	const scale = adaptor.screenshotClipScale ?? 1;

	const restore = () =>
		runComposed(adaptor, pairRestoreScript, run, { styleProps }, borrowedElement);

	const capture = async () => {
		// Capture the focused state first, while focus is genuine: re-focusing the element afterwards
		// cannot always restore it (the host of a closed shadow root cannot push focus back inside), so
		// the focused frame must be taken before blurring.
		const focusedScreenshot = await adaptor.screenshotClip(focusedClip, scale);

		// Measure the unfocused rect after blurring rather than reusing a stale baseline rect: a :focus
		// rule may have moved the element, and a fixed-position element's page-relative rect changes
		// with every scroll.
		const blurred = await runComposed(
			adaptor,
			pairBlurredScript,
			run,
			{
				styleProps,
				ancestorLimit: CONTEXT_ANCESTOR_LIMIT,
				transitionMs: PAIR_TRANSITION_WAIT_MS,
			},
			borrowedElement,
		);
		const unfocusedRect = blurred.rect;
		const unfocusedClip = bufferedClip(
			unfocusedRect,
			page.width,
			page.height,
			options.screenshotClipBuffer,
		);

		const unfocusedScreenshot = await adaptor.screenshotClip(unfocusedClip, scale);

		return { focusedScreenshot, blurred, unfocusedRect, unfocusedClip, unfocusedScreenshot };
	};

	let captured: Awaited<ReturnType<typeof capture>>;

	try {
		captured = await capture();
	} catch (error) {
		// A capture failed part-way: still take the caret-hiding stylesheet and the pair's state off
		// the page and hand focus back, so the page is left as it was found.
		try {
			await restore();
		} catch {
			// The page or the element is gone: there is nothing left to put back.
		}

		throw error;
	}

	const { focusedScreenshot, blurred, unfocusedRect, unfocusedClip, unfocusedScreenshot } =
		captured;

	const unfocusedStyles = await restore();

	const context: PairContext[] = [];
	const focusedEntries = focused.context?.entries ?? [];
	const blurredEntries = blurred.context?.entries ?? [];

	// A page that re-renders on blur can change what surrounds the element: only pair up entries
	// that are still the same kind of thing in the same place.
	for (let i = 0; i < Math.min(focusedEntries.length, blurredEntries.length); i++) {
		const before = focusedEntries[i]!;
		const after = blurredEntries[i]!;

		if (before.kind === after.kind) {
			context.push({
				kind: before.kind,
				html: truncateHtml(before.html),
				focusedStyles: before.styles,
				unfocusedStyles: after.styles,
				...(before.shared || after.shared ? { shared: true as const } : {}),
				...(before.animating || after.animating ? { animating: true as const } : {}),
			});
		}
	}

	return {
		focusedScreenshot,
		unfocusedScreenshot,
		unfocusedStyles,
		focusedRect,
		unfocusedRect,
		focusedClip,
		unfocusedClip,
		scale,
		clipTarget: focused.clipTarget ?? "element",
		unpainted: focused.unpainted ?? false,
		obstructed: focused.obstructed ?? false,
		caretHidden: focused.caret ?? false,
		context,
		background: focused.context?.background ?? blurred.context?.background ?? null,
	};
}
