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

	// The shared browser adaptor defaults to 2. Text spacing captures at the page's own scale,
	// matching this package's Puppeteer adaptor.
	it("defaults screenshotClipScale to 1 and honours an override", () => {
		expect(new PlaywrightAdaptor(cdpPage()).screenshotClipScale).toBe(1);
		expect(new PlaywrightAdaptor(cdpPage(), { screenshotClipScale: 2 }).screenshotClipScale).toBe(
			2,
		);
	});
});
