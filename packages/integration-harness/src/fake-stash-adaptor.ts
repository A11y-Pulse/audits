import {
	type BrowserAdaptor,
	elementRectScript,
	pageDimensionsScript,
} from "@a11y-pulse/browser-adaptor";
import { getSelector } from "@a11y-pulse/browser-adaptor/dom";

export type FakeStashAdaptor = {
	adaptor: BrowserAdaptor;
	released: () => boolean;
	/** The picked index of each element screenshotted, in order. */
	screenshotted: () => number[];
};

/**
 * Stand in for a page that answers `collectScript` with `collected`, resolves the selector of each
 * stashed element picked through stashedElementSelectors to `#<selectorPrefix>-<index>`, and
 * records whether the stash was released and which stashed elements were screenshotted.
 */
export function fakeStashAdaptor(
	collectScript: unknown,
	collected: unknown,
	selectorPrefix: string,
): FakeStashAdaptor {
	let picked: number | null = null;
	let released = false;
	const screenshotted: number[] = [];

	const adaptor: BrowserAdaptor = {
		evaluate: (async (fn: unknown, ...args: unknown[]) => {
			if (fn === collectScript) {
				return collected;
			}

			if (fn === getSelector) {
				return `#${selectorPrefix}-${args[0]}`;
			}

			if (fn === pageDimensionsScript) {
				return { width: 1000, height: 1000 };
			}

			if (fn === elementRectScript) {
				return { x: 0, y: 0, width: 10, height: 10 };
			}

			// The stash helpers pass the key, then the index when picking an element.
			if (typeof args[0] === "string" && typeof args[1] === "number") {
				picked = args[1];
			} else if (typeof args[0] === "string" && args.length === 1) {
				released = true;
			}

			return undefined;
		}) as BrowserAdaptor["evaluate"],
		evaluateHandle: async () => picked,
		disposeRef: async () => {},
		pressTab: async () => {},
		pressEnter: async () => {},
		pressKey: async () => {},
		screenshotClip: async () => {
			if (picked !== null) {
				screenshotted.push(picked);
			}

			return new Uint8Array([1]);
		},
		ensureFocusReporting: async () => {},
	};

	return { adaptor, released: () => released, screenshotted: () => screenshotted };
}
