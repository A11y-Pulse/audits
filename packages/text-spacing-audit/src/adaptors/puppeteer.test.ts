import type { Page } from "puppeteer";
import { describe, expect, it, vi } from "vitest";
import { PuppeteerAdaptor } from "./puppeteer";

describe("PuppeteerAdaptor", () => {
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
