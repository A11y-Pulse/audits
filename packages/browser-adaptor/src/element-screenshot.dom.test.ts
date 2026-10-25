// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BrowserAdaptor } from "./adaptor";
import {
	captureElementScreenshot,
	elementRectScript,
	needsCentringScript,
	pageDimensionsScript,
	scrollToCenterScript,
} from "./element-screenshot";

describe("elementRectScript", () => {
	it("returns a zero rect for a missing element", () => {
		expect(elementRectScript(null)).toEqual({
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		});
	});

	it("returns the element's page-relative rect", () => {
		document.body.innerHTML = "<button>target</button>";
		const el = document.querySelector("button") as HTMLElement;
		el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 30, height: 40 }) as DOMRect;
		Object.defineProperty(window, "scrollX", { value: 5, configurable: true });
		Object.defineProperty(window, "scrollY", { value: 7, configurable: true });

		expect(elementRectScript(el)).toEqual({
			x: 15,
			y: 27,
			width: 30,
			height: 40,
		});
	});
});

describe("needsCentringScript", () => {
	const VIEWPORT = { width: 1024, height: 768 };

	afterEach(() => {
		vi.restoreAllMocks();
	});

	function elementAt(rect: { left: number; top: number; width: number; height: number }): Element {
		document.body.innerHTML = "<button>target</button>";
		const el = document.querySelector("button") as HTMLElement;
		el.getBoundingClientRect = () =>
			({
				...rect,
				right: rect.left + rect.width,
				bottom: rect.top + rect.height,
				x: rect.left,
				y: rect.top,
				toJSON: () => ({}),
			}) as DOMRect;
		document.elementFromPoint = () => el;

		return el;
	}

	function pageOf(size: { scrollWidth: number; scrollHeight: number; scrollY?: number }): void {
		for (const [key, value] of Object.entries({
			clientWidth: VIEWPORT.width,
			clientHeight: VIEWPORT.height,
			scrollWidth: size.scrollWidth,
			scrollHeight: size.scrollHeight,
		})) {
			Object.defineProperty(document.documentElement, key, { configurable: true, value });
		}

		Object.defineProperty(window, "scrollY", { configurable: true, value: size.scrollY ?? 0 });
		Object.defineProperty(window, "scrollX", { configurable: true, value: 0 });
	}

	it("is false for a missing element", () => {
		expect(needsCentringScript(null, 10)).toBe(false);
	});

	it("is true when an unrelated element covers the element's centre", () => {
		pageOf({ scrollWidth: VIEWPORT.width, scrollHeight: 4000 });
		const el = elementAt({ left: 100, top: 100, width: 50, height: 20 });
		document.body.insertAdjacentHTML("beforeend", `<div id="banner">cookie banner</div>`);
		document.elementFromPoint = () => document.querySelector("#banner");

		expect(needsCentringScript(el, 10)).toBe(true);
	});

	it("is false when the padded box sits inside the viewport", () => {
		pageOf({ scrollWidth: VIEWPORT.width, scrollHeight: 4000 });
		const el = elementAt({ left: 100, top: 100, width: 50, height: 20 });

		expect(needsCentringScript(el, 10)).toBe(false);
	});

	it("is false at the top-left of an unscrolled page, where the clip is cut off at the document edge", () => {
		pageOf({ scrollWidth: VIEWPORT.width, scrollHeight: 4000 });
		const el = elementAt({ left: 8, top: 8, width: 50, height: 20 });

		expect(needsCentringScript(el, 10)).toBe(false);
	});

	it("is true when the padding hangs past the bottom of the viewport with page left to scroll", () => {
		pageOf({ scrollWidth: VIEWPORT.width, scrollHeight: 4000 });
		const el = elementAt({ left: 100, top: VIEWPORT.height - 20, width: 50, height: 20 });

		expect(needsCentringScript(el, 10)).toBe(true);
	});

	it("is false for a box flush with the bottom edge when there is no padding", () => {
		pageOf({ scrollWidth: VIEWPORT.width, scrollHeight: 4000 });
		const el = elementAt({ left: 100, top: VIEWPORT.height - 20, width: 50, height: 20 });

		expect(needsCentringScript(el, 0)).toBe(false);
	});

	it("is false at the very bottom of the document, where the clip is cut off at the document edge", () => {
		pageOf({ scrollWidth: VIEWPORT.width, scrollHeight: 4000, scrollY: 4000 - VIEWPORT.height });
		const el = elementAt({ left: 100, top: VIEWPORT.height - 20, width: 50, height: 20 });

		expect(needsCentringScript(el, 10)).toBe(false);
	});

	it("is true when the element starts above the viewport of a scrolled page", () => {
		pageOf({ scrollWidth: VIEWPORT.width, scrollHeight: 4000, scrollY: 500 });
		const el = elementAt({ left: 100, top: -5, width: 50, height: 20 });

		expect(needsCentringScript(el, 0)).toBe(true);
	});

	it("is false when the clip is taller than the viewport, since scrolling cannot fit it", () => {
		pageOf({ scrollWidth: VIEWPORT.width, scrollHeight: 4000, scrollY: 500 });
		const el = elementAt({ left: 100, top: -5, width: 50, height: VIEWPORT.height + 100 });

		expect(needsCentringScript(el, 10)).toBe(false);
	});
});

describe("scrollToCenterScript", () => {
	const VIEWPORT = { width: 1024, height: 768 };

	function elementAt(rect: { left: number; top: number; width: number; height: number }): Element {
		document.body.innerHTML = "<button>target</button>";
		const el = document.querySelector("button") as HTMLElement;
		el.getBoundingClientRect = () =>
			({
				...rect,
				right: rect.left + rect.width,
				bottom: rect.top + rect.height,
				x: rect.left,
				y: rect.top,
				toJSON: () => ({}),
			}) as DOMRect;
		Object.defineProperty(document.documentElement, "clientWidth", {
			configurable: true,
			value: VIEWPORT.width,
		});
		Object.defineProperty(document.documentElement, "clientHeight", {
			configurable: true,
			value: VIEWPORT.height,
		});

		return el;
	}

	it("tolerates a missing element", () => {
		expect(() => scrollToCenterScript(null)).not.toThrow();
	});

	it("scrolls the window so the element is vertically centred, without animating", () => {
		const el = elementAt({ left: 100, top: VIEWPORT.height - 20, width: 50, height: 20 });
		const scrollBy = vi.fn();
		window.scrollBy = scrollBy;

		scrollToCenterScript(el);

		expect(scrollBy).toHaveBeenCalledWith({
			top: VIEWPORT.height - 20 + 10 - VIEWPORT.height / 2,
			left: 0,
			behavior: "instant",
		});
	});

	it("only scrolls horizontally when the padded element is outside the viewport on that axis", () => {
		const el = elementAt({ left: VIEWPORT.width - 30, top: 100, width: 50, height: 20 });
		const scrollBy = vi.fn();
		window.scrollBy = scrollBy;

		scrollToCenterScript(el, 10);

		expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 30 }));
	});

	it("leaves the horizontal position alone when the padded element already fits", () => {
		const el = elementAt({ left: 100, top: 100, width: 50, height: 20 });
		const scrollBy = vi.fn();
		window.scrollBy = scrollBy;

		scrollToCenterScript(el, 10);

		expect(scrollBy).toHaveBeenCalledWith(expect.objectContaining({ left: 0 }));
	});

	it("does not call scrollIntoView, which would move the sequential focus starting point", () => {
		const el = elementAt({ left: 100, top: 100, width: 50, height: 20 });
		const scrollIntoView = vi.fn();
		el.scrollIntoView = scrollIntoView;
		window.scrollBy = vi.fn();

		scrollToCenterScript(el);

		expect(scrollIntoView).not.toHaveBeenCalled();
	});
});

describe("captureElementScreenshot", () => {
	function fakeAdaptor(needsCentring: boolean): BrowserAdaptor & { calls: unknown[] } {
		const calls: unknown[] = [];

		return {
			calls,
			evaluate: (async (fn, ...args) => {
				calls.push(fn);

				if (fn === needsCentringScript) {
					return needsCentring;
				}

				if (fn === pageDimensionsScript) {
					return { width: 2000, height: 4000 };
				}

				if (fn === elementRectScript) {
					expect(args[0]).toBe("handle");

					return { x: 100, y: 200, width: 30, height: 40 };
				}

				return undefined;
			}) as BrowserAdaptor["evaluate"],
			async evaluateHandle() {
				return {};
			},
			async disposeRef() {},
			async pressTab() {},
			async pressEnter() {},
			async pressKey() {},
			async screenshotClip(clip, scale) {
				calls.push({ clip, scale });

				return new Uint8Array([1]);
			},
			screenshotClipScale: 2,
			async ensureFocusReporting() {},
		};
	}

	it("clips the element's box plus the buffer at the adaptor's scale", async () => {
		const adaptor = fakeAdaptor(false);

		const png = await captureElementScreenshot(adaptor, "handle", {
			clipBuffer: 10,
			settleDelay: 0,
		});

		expect(png).toEqual(new Uint8Array([1]));
		expect(adaptor.calls).not.toContain(scrollToCenterScript);
		expect(adaptor.calls.at(-1)).toEqual({
			clip: { x: 90, y: 190, width: 50, height: 60 },
			scale: 2,
		});
	});

	it("centres the element before measuring when it needs it", async () => {
		const adaptor = fakeAdaptor(true);

		await captureElementScreenshot(adaptor, "handle", { clipBuffer: 10, settleDelay: 0 });

		expect(adaptor.calls.indexOf(scrollToCenterScript)).toBeLessThan(
			adaptor.calls.indexOf(elementRectScript),
		);
	});
});
