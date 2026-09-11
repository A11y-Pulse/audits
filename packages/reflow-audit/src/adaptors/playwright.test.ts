import type { Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { PlaywrightAdaptor } from "./playwright";

function cdpPage(overrides: Partial<Record<string, unknown>> = {}): Page {
	return {
		context: () => ({ newCDPSession: async () => ({ send: async () => ({ data: "" }) }) }),
		...overrides,
	} as unknown as Page;
}

describe("PlaywrightAdaptor", () => {
	it("getViewport delegates to page.viewportSize()", async () => {
		const page = cdpPage({ viewportSize: () => ({ width: 1280, height: 800 }) });

		await expect(new PlaywrightAdaptor(page).getViewport()).resolves.toEqual({
			width: 1280,
			height: 800,
		});
	});

	it("getViewport falls back when the context was created without a viewport", async () => {
		const page = cdpPage({ viewportSize: () => null });

		await expect(new PlaywrightAdaptor(page).getViewport()).resolves.toEqual({
			width: 800,
			height: 600,
		});
	});

	it("setViewport delegates to page.setViewportSize()", async () => {
		const setViewportSize = vi.fn(async () => {});
		const page = cdpPage({ setViewportSize });

		await new PlaywrightAdaptor(page).setViewport({ width: 320, height: 1024 });

		expect(setViewportSize).toHaveBeenCalledWith({ width: 320, height: 1024 });
	});

	it("evaluate runs the packed function in the page", async () => {
		const page = cdpPage({
			evaluate: vi.fn(async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg)),
		});

		await expect(
			new PlaywrightAdaptor(page).evaluate(function double(n: number) {
				return n * 2;
			}, 7),
		).resolves.toBe(14);
	});

	it("screenshotClip passes the scale through to the capture", async () => {
		const send = vi.fn(async () => ({ data: "" }));
		const page = {
			context: () => ({ newCDPSession: async () => ({ send }) }),
		} as unknown as Page;
		const clip = { x: 0, y: 0, width: 10, height: 10 };

		await new PlaywrightAdaptor(page).screenshotClip(clip, 3);

		expect(send).toHaveBeenCalledWith(
			"Page.captureScreenshot",
			expect.objectContaining({ clip: { ...clip, scale: 3 } }),
		);
	});

	// The shared browser adaptor defaults to 2. Reflow captures at the page's own scale, matching
	// this package's Puppeteer adaptor, so the audit's pixel maths is unchanged across engines.
	it("defaults screenshotClipScale to 1 and honours an override", () => {
		expect(new PlaywrightAdaptor(cdpPage()).screenshotClipScale).toBe(1);
		expect(new PlaywrightAdaptor(cdpPage(), { screenshotClipScale: 2 }).screenshotClipScale).toBe(
			2,
		);
	});
});
