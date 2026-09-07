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

	it("re-asserts focus emulation when called again for the same page", async () => {
		const send = vi.fn(async () => {});
		const page = {
			createCDPSession: async () => ({ send }),
		} as unknown as Page;
		const adaptor = new PuppeteerAdaptor(page);

		await adaptor.ensureFocusReporting();
		await adaptor.ensureFocusReporting();

		expect(send.mock.calls).toEqual([
			["Emulation.setFocusEmulationEnabled", { enabled: true }],
			["Emulation.setFocusEmulationEnabled", { enabled: false }],
			["Emulation.setFocusEmulationEnabled", { enabled: true }],
		]);
	});

	it("reuses one CDP session per page across re-assertions", async () => {
		const send = vi.fn(async () => {});
		const createCDPSession = vi.fn(async () => ({ send }));
		const page = { createCDPSession } as unknown as Page;

		await new PuppeteerAdaptor(page).ensureFocusReporting();
		await new PuppeteerAdaptor(page).ensureFocusReporting();

		expect(createCDPSession).toHaveBeenCalledTimes(1);
	});

	it("does not throw when focus emulation cannot be enabled", async () => {
		const page = {
			createCDPSession: async () => {
				throw new Error("no CDP");
			},
		} as unknown as Page;

		await expect(new PuppeteerAdaptor(page).ensureFocusReporting()).resolves.toBeUndefined();
	});
});
