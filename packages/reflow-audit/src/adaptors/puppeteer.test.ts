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

	it("evaluate delegates to page.evaluate()", async () => {
		const evaluate = vi.fn(async () => 7);
		const page = { evaluate } as unknown as Page;
		const fn = () => 7;

		await expect(new PuppeteerAdaptor(page).evaluate(fn, "arg")).resolves.toBe(7);
		expect(evaluate).toHaveBeenCalledWith(fn, "arg");
	});

	it("screenshotClip passes the scale through to the capture", async () => {
		const screenshot = vi.fn(async () => new Uint8Array());
		const page = { screenshot } as unknown as Page;
		const clip = { x: 0, y: 0, width: 10, height: 10 };

		await new PuppeteerAdaptor(page).screenshotClip(clip, 3);

		expect(screenshot).toHaveBeenCalledWith(
			expect.objectContaining({ clip: { ...clip, scale: 3 } }),
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
		const screenshot = vi.fn(async () => new Uint8Array());
		const page = { screenshot } as unknown as Page;

		await new PuppeteerAdaptor(page).screenshotClip({ x: 0, y: 0, width: 10, height: 10 });

		expect(screenshot).toHaveBeenCalledWith(expect.objectContaining({ optimizeForSpeed: false }));
	});
});
