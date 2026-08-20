import type { Page } from "puppeteer";
import { describe, expect, it, vi } from "vitest";
import { PuppeteerAdaptor } from "./puppeteer";

describe("PuppeteerAdaptor.ensureFocusReporting", () => {
	it("enables CDP focus emulation", async () => {
		const send = vi.fn(async () => {});
		const page = {
			createCDPSession: async () => ({ send }),
		} as unknown as Page;

		await new PuppeteerAdaptor(page).ensureFocusReporting();

		expect(send).toHaveBeenCalledWith("Emulation.setFocusEmulationEnabled", {
			enabled: true,
		});
	});

	it("does not throw when focus emulation cannot be enabled", async () => {
		const page = {
			createCDPSession: async () => {
				throw new Error("no CDP");
			},
		} as unknown as Page;

		await expect(
			new PuppeteerAdaptor(page).ensureFocusReporting(),
		).resolves.toBeUndefined();
	});

	it("enables focus emulation only once per page", async () => {
		const send = vi.fn(async () => {});
		const createCDPSession = vi.fn(async () => ({ send }));
		const page = { createCDPSession } as unknown as Page;

		await new PuppeteerAdaptor(page).ensureFocusReporting();
		await new PuppeteerAdaptor(page).ensureFocusReporting();

		expect(createCDPSession).toHaveBeenCalledTimes(1);
	});
});

describe("PuppeteerAdaptor.pressEnter", () => {
	it("presses Enter on the page keyboard", async () => {
		const press = vi.fn(async () => {});
		const page = {
			keyboard: { press },
		} as unknown as Page;

		await new PuppeteerAdaptor(page).pressEnter();

		expect(press).toHaveBeenCalledWith("Enter");
	});
});
