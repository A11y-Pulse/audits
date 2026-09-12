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

describe("PuppeteerAdaptor.screenshotClipScale", () => {
	it("defaults to 2 and honours an override", () => {
		const page = {} as unknown as Page;

		expect(new PuppeteerAdaptor(page).screenshotClipScale).toBe(2);
		expect(new PuppeteerAdaptor(page, { screenshotClipScale: 1 }).screenshotClipScale).toBe(1);
	});
});

describe("PuppeteerAdaptor.screenshotClip", () => {
	it("optimises for speed by default and honours an override", async () => {
		const screenshot = vi.fn(async () => new Uint8Array());
		const page = { screenshot } as unknown as Page;
		const clip = { x: 0, y: 0, width: 10, height: 10 };

		await new PuppeteerAdaptor(page).screenshotClip(clip);
		await new PuppeteerAdaptor(page, { optimizeForSpeed: false }).screenshotClip(clip);

		expect(screenshot).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ optimizeForSpeed: true }),
		);
		expect(screenshot).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ optimizeForSpeed: false }),
		);
	});
});
