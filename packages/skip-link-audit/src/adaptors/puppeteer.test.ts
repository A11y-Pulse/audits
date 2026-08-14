import type { Page } from "puppeteer";
import { describe, expect, it, vi } from "vitest";
import { PuppeteerAdaptor } from "./puppeteer";

describe("PuppeteerAdaptor", () => {
	it("pressTab sends Tab", async () => {
		const press = vi.fn(async () => {});
		const page = { keyboard: { press } } as unknown as Page;

		await new PuppeteerAdaptor(page).pressTab();

		expect(press).toHaveBeenCalledWith("Tab");
	});

	it("pressEnter sends Enter", async () => {
		const press = vi.fn(async () => {});
		const page = { keyboard: { press } } as unknown as Page;

		await new PuppeteerAdaptor(page).pressEnter();

		expect(press).toHaveBeenCalledWith("Enter");
	});
});

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

	it("enables focus emulation only once per page", async () => {
		const send = vi.fn(async () => {});
		const page = {
			createCDPSession: vi.fn(async () => ({ send })),
		} as unknown as Page;

		await new PuppeteerAdaptor(page).ensureFocusReporting();
		await new PuppeteerAdaptor(page).ensureFocusReporting();

		expect(page.createCDPSession).toHaveBeenCalledTimes(1);
		expect(send).toHaveBeenCalledTimes(1);
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
});
