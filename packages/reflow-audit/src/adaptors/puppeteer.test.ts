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

		await expect(new PuppeteerAdaptor(page).evaluate(fn, "arg")).resolves.toBe(
			7,
		);
		expect(evaluate).toHaveBeenCalledWith(fn, "arg");
	});
});
