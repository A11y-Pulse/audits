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

	it("getViewport reads the window's size when the page has no emulated viewport", async () => {
		const page = {
			viewport: () => null,
			evaluate: vi.fn(async () => ({ width: 1400, height: 913 })),
		} as unknown as Page;

		await expect(new PuppeteerAdaptor(page).getViewport()).resolves.toEqual({
			width: 1400,
			height: 913,
		});
	});

	it("clears the emulation when an unemulated page is set back to its window's size", async () => {
		let viewport: { width: number; height: number } | null = null;
		const setViewport = vi.fn(async (next: { width: number; height: number } | null) => {
			viewport = next;
		});
		const page = {
			viewport: () => viewport,
			evaluate: async () => ({ width: 1400, height: 913 }),
			waitForFunction: async () => undefined,
			setViewport,
		} as unknown as Page;
		const adaptor = new PuppeteerAdaptor(page);

		const original = await adaptor.getViewport();
		await adaptor.setViewport({ width: 320, height: 1024 });
		await adaptor.setViewport(original);

		expect(setViewport.mock.calls).toEqual([[{ width: 320, height: 1024 }], [null]]);
	});

	it("keeps emulating a page that already had a viewport when it is restored", async () => {
		let viewport = { width: 1280, height: 800 };
		const setViewport = vi.fn(async (next: { width: number; height: number }) => {
			viewport = next;
		});
		const page = { viewport: () => viewport, setViewport } as unknown as Page;
		const adaptor = new PuppeteerAdaptor(page);

		const original = await adaptor.getViewport();
		await adaptor.setViewport({ width: 320, height: 1024 });
		await adaptor.setViewport(original);

		expect(setViewport).toHaveBeenLastCalledWith({ width: 1280, height: 800 });
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

	// The shared browser adaptor defaults to 2. Reflow captures at the page's own scale, matching
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
