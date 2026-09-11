import type { Page } from "playwright-core";
import { describe, expect, it, vi } from "vitest";
import { PlaywrightAdaptor } from "./playwright";

type EvaluateMock = ReturnType<typeof vi.fn>;

function evaluatingPage(): { page: Page; evaluate: EvaluateMock } {
	const evaluate = vi.fn(async (fn: (arg: unknown) => unknown, arg: unknown) => fn(arg));

	return { page: { evaluate } as unknown as Page, evaluate };
}

function cdpPage(send: EvaluateMock): { page: Page; newCDPSession: EvaluateMock } {
	const newCDPSession = vi.fn(async () => ({ send }));

	return {
		page: { context: () => ({ newCDPSession }) } as unknown as Page,
		newCDPSession,
	};
}

describe("PlaywrightAdaptor.evaluate", () => {
	it("packs the function source and its args into Playwright's single argument", async () => {
		const { page, evaluate } = evaluatingPage();

		await new PlaywrightAdaptor(page).evaluate(
			function add(a: number, b: number) {
				return a + b;
			},
			2,
			3,
		);

		expect(evaluate.mock.calls[0]![1]).toEqual([expect.stringContaining("function add"), [2, 3]]);
	});

	it("rebuilds the packed function in the page and applies its args", async () => {
		const { page } = evaluatingPage();

		const sum = await new PlaywrightAdaptor(page).evaluate(
			function add(a: number, b: number) {
				return a + b;
			},
			2,
			3,
		);

		expect(sum).toBe(5);
	});

	it("passes handles through untouched so Playwright can resolve them to elements", async () => {
		const { page, evaluate } = evaluatingPage();
		const handle = { __handle: true };

		await new PlaywrightAdaptor(page).evaluate((element: unknown) => element, handle);

		const [, packed] = evaluate.mock.calls[0]! as [unknown, [string, unknown[]]];
		expect(packed[1][0]).toBe(handle);
	});

	it("reports a blocked eval as a CSP problem rather than a page failure", async () => {
		const page = {
			evaluate: async () => {
				throw new Error(
					"EvalError: Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive",
				);
			},
		} as unknown as Page;

		await expect(new PlaywrightAdaptor(page).evaluate(() => 1)).rejects.toThrow(
			/Content-Security-Policy blocks/,
		);
	});

	it("rethrows unrelated failures unchanged", async () => {
		const page = {
			evaluate: async () => {
				throw new Error("boom");
			},
		} as unknown as Page;

		await expect(new PlaywrightAdaptor(page).evaluate(() => 1)).rejects.toThrow("boom");
	});
});

describe("PlaywrightAdaptor.screenshotClip", () => {
	const clip = { x: 10, y: 3000, width: 100, height: 50 };

	it("captures beyond the viewport at the requested scale over CDP", async () => {
		const send = vi.fn(async () => ({ data: Buffer.from("png").toString("base64") }));
		const { page } = cdpPage(send);

		const bytes = await new PlaywrightAdaptor(page).screenshotClip(clip, 2);

		expect(send).toHaveBeenCalledWith("Page.captureScreenshot", {
			format: "png",
			captureBeyondViewport: true,
			clip: { ...clip, scale: 2 },
		});
		expect(Buffer.from(bytes).toString()).toBe("png");
	});

	it("falls back to a full-page public capture when there is no CDP", async () => {
		const screenshot = vi.fn(async () => Buffer.from("png"));
		const page = {
			context: () => ({
				newCDPSession: async () => {
					throw new Error("CDP is only available in Chromium");
				},
			}),
			screenshot,
		} as unknown as Page;

		await new PlaywrightAdaptor(page).screenshotClip(clip, 2);

		expect(screenshot).toHaveBeenCalledWith({
			type: "png",
			fullPage: true,
			clip,
			scale: "device",
		});
	});

	it("defaults screenshotClipScale to 2 and honours an override", () => {
		const { page } = cdpPage(vi.fn());

		expect(new PlaywrightAdaptor(page).screenshotClipScale).toBe(2);
		expect(new PlaywrightAdaptor(page, { screenshotClipScale: 1 }).screenshotClipScale).toBe(1);
	});
});

describe("PlaywrightAdaptor.ensureFocusReporting", () => {
	it("enables CDP focus emulation", async () => {
		const send = vi.fn(async () => {});
		const { page } = cdpPage(send);

		await new PlaywrightAdaptor(page).ensureFocusReporting();

		expect(send).toHaveBeenCalledWith("Emulation.setFocusEmulationEnabled", {
			enabled: true,
		});
	});

	it("re-asserts focus emulation when called again for the same page", async () => {
		const send = vi.fn(async () => {});
		const { page } = cdpPage(send);
		const adaptor = new PlaywrightAdaptor(page);

		await adaptor.ensureFocusReporting();
		await adaptor.ensureFocusReporting();

		expect(send.mock.calls).toEqual([
			["Emulation.setFocusEmulationEnabled", { enabled: true }],
			["Emulation.setFocusEmulationEnabled", { enabled: false }],
			["Emulation.setFocusEmulationEnabled", { enabled: true }],
		]);
	});

	it("reuses one CDP session per page across re-assertions", async () => {
		const { page, newCDPSession } = cdpPage(vi.fn(async () => {}));

		await new PlaywrightAdaptor(page).ensureFocusReporting();
		await new PlaywrightAdaptor(page).ensureFocusReporting();

		expect(newCDPSession).toHaveBeenCalledTimes(1);
	});

	it("does not throw when focus emulation cannot be enabled", async () => {
		const { page } = cdpPage(
			vi.fn(async () => {
				throw new Error("no focus emulation");
			}),
		);

		await expect(new PlaywrightAdaptor(page).ensureFocusReporting()).resolves.toBeUndefined();
	});

	it("stays quiet on engines with no CDP", async () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const page = {
			context: () => ({
				browser: () => ({ browserType: () => ({ name: () => "firefox" }) }),
				newCDPSession: async () => {
					throw new Error("CDP is only available in Chromium");
				},
			}),
		} as unknown as Page;

		await expect(new PlaywrightAdaptor(page).ensureFocusReporting()).resolves.toBeUndefined();
		expect(warn).not.toHaveBeenCalled();

		warn.mockRestore();
	});
});
