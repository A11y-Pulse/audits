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
});
