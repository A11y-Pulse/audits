import type { Page } from "puppeteer";
import { describe, expect, it, vi } from "vitest";
import { PuppeteerAdaptor } from "./puppeteer";

// What the adaptor does to a real page (key presses, clipped captures, focus emulation, evaluating
// with handles, dismissing dialogs) is covered against real browsers by
// tab-orchestrator/tests/integration/browser-adaptor.test.ts. The tests here cover what a browser
// run cannot show: which protocol calls are made when, and the paths taken when something is
// unavailable.

describe("PuppeteerAdaptor.ensureFocusReporting", () => {
	it("re-asserts focus emulation when called again for the same page", async () => {
		const send = vi.fn(async () => {});
		const page = {
			createCDPSession: async () => ({ send }),
		} as unknown as Page;
		const adaptor = new PuppeteerAdaptor(page);

		await adaptor.ensureFocusReporting();
		await adaptor.ensureFocusReporting();

		// Chromium ignores a redundant enable, so the second call has to switch it off first.
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
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
		const page = {
			createCDPSession: async () => {
				throw new Error("no CDP");
			},
		} as unknown as Page;

		await expect(new PuppeteerAdaptor(page).ensureFocusReporting()).resolves.toBeUndefined();

		warn.mockRestore();
	});
});

describe("PuppeteerAdaptor.pressKey", () => {
	it("releases a held modifier even when the key press fails", async () => {
		const calls: string[] = [];
		const keyboard = {
			down: async (key: string) => calls.push(`down ${key}`),
			press: async () => {
				throw new Error("page closed");
			},
			up: async (key: string) => calls.push(`up ${key}`),
		};
		const page = { keyboard } as unknown as Page;

		await expect(new PuppeteerAdaptor(page).pressKey("Shift+Tab")).rejects.toThrow("page closed");

		expect(calls).toEqual(["down Shift", "up Shift"]);
	});
});

describe("PuppeteerAdaptor.screenshotClip", () => {
	const clip = { x: 10, y: 20, width: 30, height: 40 };

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
		const send = vi.fn(async (method: string) =>
			method === "Page.captureScreenshot"
				? { data: Buffer.from("png").toString("base64") }
				: undefined,
		);
		const createCDPSession = vi.fn(async () => ({ send }));
		const page = { createCDPSession, evaluate: async () => {} } as unknown as Page;
		const adaptor = new PuppeteerAdaptor(page);

		await adaptor.ensureFocusReporting();
		await adaptor.screenshotClip(clip);

		expect(createCDPSession).toHaveBeenCalledTimes(1);
	});
});

describe("PuppeteerAdaptor dialogs", () => {
	type DialogListener = (dialog: { dismiss: () => Promise<void> }) => void;

	function dialogPage(): {
		page: Page;
		raise: (dismiss?: () => Promise<void>) => void;
		on: unknown;
		listeners: DialogListener[];
	} {
		const listeners: DialogListener[] = [];
		const on = vi.fn((event: string, listener: DialogListener) => {
			if (event === "dialog") {
				listeners.push(listener);
			}
		});
		const off = vi.fn((event: string, listener: DialogListener) => {
			const at = listeners.indexOf(listener);

			if (event === "dialog" && at !== -1) {
				listeners.splice(at, 1);
			}
		});

		return {
			page: { on, off } as unknown as Page,
			on,
			listeners,
			raise: (dismiss = async () => {}) => {
				for (const listener of [...listeners]) {
					listener({ dismiss });
				}
			},
		};
	}

	// The dismissal is put off until every other listener has had the dialog.
	const afterListeners = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

	it("listens for dialogs only while something has asked it to", async () => {
		const { page, raise, listeners } = dialogPage();
		const adaptor = new PuppeteerAdaptor(page);
		const dismiss = vi.fn(async () => {});

		// Only the watcher that remembers the last dialog, which answers nothing.
		expect(listeners).toHaveLength(1);

		const stop = adaptor.startDismissingDialogs();
		raise(dismiss);
		await afterListeners();

		expect(dismiss).toHaveBeenCalledTimes(1);

		stop();
		stop();
		raise(dismiss);
		await afterListeners();

		expect(listeners).toHaveLength(1);
		expect(dismiss).toHaveBeenCalledTimes(1);
		expect(adaptor.takeDismissedDialogs()).toBe(1);
	});

	it("closes a dialog raised before it was asked to dismiss them, without counting it", async () => {
		const { page, raise } = dialogPage();
		const adaptor = new PuppeteerAdaptor(page);
		const dismiss = vi.fn(async () => {});

		raise(dismiss);
		await afterListeners();

		// Nobody asked yet: the dialog is the caller's to answer.
		expect(dismiss).not.toHaveBeenCalled();

		const stop = adaptor.startDismissingDialogs();
		await afterListeners();
		stop();

		expect(dismiss).toHaveBeenCalledTimes(1);
		expect(adaptor.takeDismissedDialogs()).toBe(0);
	});

	it("does not watch the page's dialogs when told never to dismiss them", () => {
		const { page, listeners } = dialogPage();
		const adaptor = new PuppeteerAdaptor(page, { dismissDialogs: false });

		adaptor.startDismissingDialogs()();

		expect(listeners).toHaveLength(0);
	});

	it("dismisses each dialog once however many adaptors and callers hold the page", async () => {
		const { page, raise, listeners } = dialogPage();
		const first = new PuppeteerAdaptor(page);
		const second = new PuppeteerAdaptor(page);
		const dismiss = vi.fn(async () => {});
		const stopFirst = first.startDismissingDialogs();
		const stopSecond = second.startDismissingDialogs();

		raise(dismiss);
		raise(dismiss);
		await afterListeners();

		expect(dismiss).toHaveBeenCalledTimes(2);
		// The count belongs to the page: whichever adaptor asks first takes it.
		expect(second.takeDismissedDialogs()).toBe(2);
		expect(first.takeDismissedDialogs()).toBe(0);

		// One watcher for the page, and the dismissing listener while either caller holds it.
		stopFirst();
		expect(listeners).toHaveLength(2);
		stopSecond();
		expect(listeners).toHaveLength(1);
	});

	it("lets a listener of the caller's answer the dialog first", async () => {
		const { page, raise, listeners } = dialogPage();
		const adaptor = new PuppeteerAdaptor(page);
		let handled = false;
		const stop = adaptor.startDismissingDialogs();

		// The caller's listener, registered after the adaptor's and so called after it.
		listeners.push(() => {
			handled = true;
		});

		raise(async () => {
			// The adaptor's dismissal only arrives once the caller's listener has run, and then
			// rejects the way the driver's does. That must not surface as an unhandled rejection.
			expect(handled).toBe(true);

			throw new Error("Cannot dismiss dialog which is already handled!");
		});
		await afterListeners();
		stop();

		expect(adaptor.takeDismissedDialogs()).toBe(1);
	});

	it("dismisses for the page's lifetime when dismissDialogs is always", async () => {
		const { page, raise, listeners } = dialogPage();
		const adaptor = new PuppeteerAdaptor(page, { dismissDialogs: "always" });
		const dismiss = vi.fn(async () => {});

		adaptor.startDismissingDialogs()();
		raise(dismiss);
		await afterListeners();

		expect(listeners).toHaveLength(1);
		expect(dismiss).toHaveBeenCalledTimes(1);
	});

	it("leaves dialogs to the caller when dismissDialogs is off", () => {
		const { page, on } = dialogPage();
		const adaptor = new PuppeteerAdaptor(page, { dismissDialogs: false });

		adaptor.startDismissingDialogs();

		expect(on).not.toHaveBeenCalled();
		expect(adaptor.takeDismissedDialogs()).toBe(0);
	});
});
