import type { Page } from "puppeteer";
import { describe, expect, it, vi } from "vitest";
import { PuppeteerAdaptor } from "./puppeteer";

describe("PuppeteerAdaptor", () => {
	it("getViewport delegates to page.viewport()", async () => {
		const page = {
			viewport: () => ({ width: 1280, height: 800, deviceScaleFactor: 1 }),
		} as unknown as Page;

		await expect(new PuppeteerAdaptor(page).getViewport()).resolves.toEqual({
			width: 1280,
			height: 800,
		});
	});

	it("setViewport delegates to page.setViewport()", async () => {
		const setViewport = vi.fn(async () => {});
		const page = {
			viewport: () => ({ width: 1280, height: 800, deviceScaleFactor: 2 }),
			setViewport,
		} as unknown as Page;

		await new PuppeteerAdaptor(page).setViewport({ width: 320, height: 1024 });

		expect(setViewport).toHaveBeenCalledWith({
			width: 320,
			height: 1024,
			deviceScaleFactor: 2,
		});
	});

	it("reads the window's size when no viewport is emulated, and drops the emulation to restore it", async () => {
		let emulated: { width: number; height: number } | null = null;
		const setViewport = vi.fn(async (next: { width: number; height: number } | null) => {
			emulated = next;
		});
		const page = {
			viewport: () => emulated,
			setViewport,
			evaluate: async () => ({ width: 1400, height: 913 }),
			waitForFunction: async () => undefined,
		} as unknown as Page;
		const adaptor = new PuppeteerAdaptor(page);

		await expect(adaptor.getViewport()).resolves.toEqual({ width: 1400, height: 913 });

		await adaptor.setViewport({ width: 700, height: 457 });
		expect(setViewport).toHaveBeenLastCalledWith({ width: 700, height: 457 });

		// Back to the size the window had: no emulation at all, not an emulated 1400x913.
		await adaptor.setViewport({ width: 1400, height: 913 });
		expect(setViewport).toHaveBeenLastCalledWith(null);

		// And from then on a size is a size again.
		emulated = { width: 1400, height: 913 };
		await adaptor.setViewport({ width: 1400, height: 913 });
		expect(setViewport).toHaveBeenLastCalledWith({ width: 1400, height: 913 });
	});

	it("evaluate delegates to page.evaluate()", async () => {
		const evaluate = vi.fn(async () => 7);
		const page = { evaluate } as unknown as Page;
		const fn = () => 7;

		await expect(new PuppeteerAdaptor(page).evaluate(fn, "arg")).resolves.toBe(7);
		expect(evaluate).toHaveBeenCalledWith(fn, "arg");
	});

	it("screenshotClip passes the scale through to the capture", async () => {
		const send = vi.fn(async () => ({ data: "" }));
		const page = {
			evaluate: async () => {},
			createCDPSession: async () => ({ send }),
		} as unknown as Page;
		const clip = { x: 0, y: 0, width: 10, height: 10 };

		await new PuppeteerAdaptor(page).screenshotClip(clip, 3);

		expect(send).toHaveBeenCalledWith(
			"Page.captureScreenshot",
			expect.objectContaining({ clip: { ...clip, scale: 3 } }),
		);
	});

	// Evidence can sit anywhere on the page, so unlike the shared browser adaptor this one captures
	// beyond the viewport.
	it("captures beyond the viewport", async () => {
		const send = vi.fn(async () => ({ data: "" }));
		const page = {
			evaluate: async () => {},
			createCDPSession: async () => ({ send }),
		} as unknown as Page;

		await new PuppeteerAdaptor(page).screenshotClip({ x: 0, y: 0, width: 10, height: 10 });

		expect(send).toHaveBeenCalledWith(
			"Page.captureScreenshot",
			expect.objectContaining({ captureBeyondViewport: true }),
		);
	});

	// The shared browser adaptor defaults to 2. Resize text captures at the page's own scale, matching
	// this package's Playwright adaptor, so the audit's pixel maths is unchanged across engines.
	it("defaults screenshotClipScale to 1 and honours an override", () => {
		const page = {} as unknown as Page;

		expect(new PuppeteerAdaptor(page).screenshotClipScale).toBe(1);
		expect(new PuppeteerAdaptor(page, { screenshotClipScale: 2 }).screenshotClipScale).toBe(2);
	});

	// The shared browser adaptor trades PNG compression for capture speed, which roughly doubles
	// the encoded evidence. This audit keeps the smaller captures it has always produced.
	it("does not optimise captures for speed", async () => {
		const send = vi.fn(async () => ({ data: "" }));
		const page = {
			evaluate: async () => {},
			createCDPSession: async () => ({ send }),
		} as unknown as Page;

		await new PuppeteerAdaptor(page).screenshotClip({ x: 0, y: 0, width: 10, height: 10 });

		expect(send).toHaveBeenCalledWith(
			"Page.captureScreenshot",
			expect.objectContaining({ optimizeForSpeed: false }),
		);
	});
});
