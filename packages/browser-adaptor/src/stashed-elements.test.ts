// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import type { BrowserAdaptor } from "./adaptor";
import { releaseStashedElements, stashedElementSelectors } from "./stashed-elements";

const STASH_KEY = "__testStash";

/**
 * An adaptor whose page is the test's own document.
 */
function inProcessAdaptor(): BrowserAdaptor {
	return {
		evaluate: (async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) =>
			fn(...args)) as BrowserAdaptor["evaluate"],
		evaluateHandle: async (fn) => fn(),
		disposeRef: async () => {},
		pressTab: async () => {},
		pressEnter: async () => {},
		pressKey: async () => {},
		screenshotClip: async () => new Uint8Array(),
		ensureFocusReporting: async () => {},
	};
}

function stash(elements: Element[]): void {
	(window as unknown as Record<string, unknown>)[STASH_KEY] = elements;
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("stashedElementSelectors", () => {
	it("returns selectors for the stashed elements at the given indices", async () => {
		document.body.innerHTML = `<p id="a"></p><p id="b"></p><p id="c"></p>`;
		stash(Array.from(document.querySelectorAll("p")));

		const selectors = await stashedElementSelectors(inProcessAdaptor(), STASH_KEY, [2, 0]);

		expect(selectors).toEqual(["#c", "#a"]);
	});

	it("returns an empty selector for an index past the stash", async () => {
		stash([]);

		expect(await stashedElementSelectors(inProcessAdaptor(), STASH_KEY, [3])).toEqual([""]);
	});
});

describe("releaseStashedElements", () => {
	it("removes the stash and the picked element from the page", async () => {
		document.body.innerHTML = `<p id="a"></p>`;
		stash(Array.from(document.querySelectorAll("p")));
		const adaptor = inProcessAdaptor();
		await stashedElementSelectors(adaptor, STASH_KEY, [0]);

		await releaseStashedElements(adaptor, STASH_KEY);

		expect(STASH_KEY in window).toBe(false);
		expect("__a11yPulsePickedElement" in window).toBe(false);
	});
});
