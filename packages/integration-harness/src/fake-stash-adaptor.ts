import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { getSelector } from "@a11y-pulse/browser-adaptor/dom";

export type FakeStashAdaptor = { adaptor: BrowserAdaptor; released: () => boolean };

/**
 * Stand in for a page that answers `collectScript` with `collected`, resolves the selector of each
 * stashed element picked through stashedElementSelectors to `#<selectorPrefix>-<index>`, and
 * records whether the stash was released.
 */
export function fakeStashAdaptor(
	collectScript: unknown,
	collected: unknown,
	selectorPrefix: string,
): FakeStashAdaptor {
	let picked: number | null = null;
	let released = false;

	const adaptor: BrowserAdaptor = {
		evaluate: (async (fn: unknown, ...args: unknown[]) => {
			if (fn === collectScript) {
				return collected;
			}

			if (fn === getSelector) {
				return `#${selectorPrefix}-${args[0]}`;
			}

			// The stash helpers pass the key, then the index when picking an element.
			if (typeof args[1] === "number") {
				picked = args[1];
			} else if (args.length === 1) {
				released = true;
			}

			return undefined;
		}) as BrowserAdaptor["evaluate"],
		evaluateHandle: async () => picked,
		disposeRef: async () => {},
		pressTab: async () => {},
		pressEnter: async () => {},
		pressKey: async () => {},
		screenshotClip: async () => new Uint8Array(),
		ensureFocusReporting: async () => {},
	};

	return { adaptor, released: () => released };
}
