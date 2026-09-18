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
	const clip = { x: 10, y: 20, width: 30, height: 40 };

	function cdpPage(): {
		page: Page;
		send: ReturnType<typeof vi.fn>;
		createCDPSession: ReturnType<typeof vi.fn>;
	} {
		const send = vi.fn(async (method: string) =>
			method === "Page.captureScreenshot"
				? { data: Buffer.from("png").toString("base64") }
				: undefined,
		);
		const createCDPSession = vi.fn(async () => ({ send }));
		const page = { createCDPSession, evaluate: async () => {} } as unknown as Page;

		return { page, send, createCDPSession };
	}

	it("captures over CDP with captureBeyondViewport off and the clip untouched", async () => {
		const { page, send } = cdpPage();

		const bytes = await new PuppeteerAdaptor(page).screenshotClip(clip, 2);

		expect(send).toHaveBeenCalledWith("Page.captureScreenshot", {
			format: "png",
			optimizeForSpeed: true,
			captureBeyondViewport: false,
			clip: { ...clip, scale: 2 },
		});
		expect(Buffer.from(bytes).toString()).toBe("png");
	});

	it("optimises for speed by default and honours an override", async () => {
		const { page, send } = cdpPage();

		await new PuppeteerAdaptor(page).screenshotClip(clip);
		await new PuppeteerAdaptor(page, { optimizeForSpeed: false }).screenshotClip(clip);

		expect(send).toHaveBeenNthCalledWith(
			1,
			"Page.captureScreenshot",
			expect.objectContaining({ optimizeForSpeed: true }),
		);
		expect(send).toHaveBeenNthCalledWith(
			2,
			"Page.captureScreenshot",
			expect.objectContaining({ optimizeForSpeed: false }),
		);
	});

	it("captures beyond the viewport only when asked to", async () => {
		const { page, send } = cdpPage();

		await new PuppeteerAdaptor(page, { captureBeyondViewport: true }).screenshotClip(clip);

		expect(send).toHaveBeenCalledWith(
			"Page.captureScreenshot",
			expect.objectContaining({ captureBeyondViewport: true }),
		);
	});

	it("falls back to page.screenshot when no CDP session can be opened", async () => {
		const screenshot = vi.fn(async () => new Uint8Array([1]));
		const page = {
			createCDPSession: async () => {
				throw new Error("no CDP");
			},
			evaluate: async () => {},
			screenshot,
		} as unknown as Page;

		const bytes = await new PuppeteerAdaptor(page).screenshotClip(clip, 2);

		expect(screenshot).toHaveBeenCalledWith({
			type: "png",
			optimizeForSpeed: true,
			captureBeyondViewport: false,
			clip: { ...clip, scale: 2 },
		});
		expect(bytes).toEqual(new Uint8Array([1]));
	});

	it("shares the page's CDP session with focus emulation", async () => {
		const { page, createCDPSession } = cdpPage();
		const adaptor = new PuppeteerAdaptor(page);

		await adaptor.ensureFocusReporting();
		await adaptor.screenshotClip(clip);

		expect(createCDPSession).toHaveBeenCalledTimes(1);
	});
});
