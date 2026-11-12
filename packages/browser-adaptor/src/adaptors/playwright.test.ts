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
		page: { context: () => ({ newCDPSession }), evaluate: async () => {} } as unknown as Page,
		newCDPSession,
	};
}

// What the adaptor does to a real page (key presses, clipped captures, focus emulation, evaluating
// with handles, dismissing dialogs) is covered against real browsers by
// tab-orchestrator/tests/integration/browser-adaptor.test.ts. The tests here cover what a browser
// run cannot show: which protocol calls are made when, and the paths taken when something is
// unavailable or refused.

const EVAL_REFUSED =
	"EvalError: Refused to evaluate a string as JavaScript because 'unsafe-eval' is not an allowed source of script in the following Content Security Policy directive";

describe("PlaywrightAdaptor.evaluate", () => {
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

	it("calls the function by handle when the page refuses to build it from a string", async () => {
		const dispose = vi.fn(async () => {});
		const evaluateHandle = vi.fn(async (expression: string) => ({
			// Stands in for Playwright evaluating the expression itself, outside page script.
			evaluate: async (caller: (fn: unknown, packed: unknown) => unknown, packed: unknown) =>
				caller(new Function(`return ${expression}`)(), packed),
			dispose,
		}));
		const page = {
			evaluate: async () => {
				throw new Error(EVAL_REFUSED);
			},
			evaluateHandle,
		} as unknown as Page;

		const sum = await new PlaywrightAdaptor(page).evaluate(
			function add(a: number, b: number) {
				return a + b;
			},
			2,
			3,
		);

		expect(sum).toBe(5);
		expect(evaluateHandle).toHaveBeenCalledTimes(1);
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("releases the function handle when the call through it throws", async () => {
		const dispose = vi.fn(async () => {});
		const page = {
			evaluate: async () => {
				throw new Error(EVAL_REFUSED);
			},
			evaluateHandle: async () => ({
				evaluate: async () => {
					throw new Error("page function threw");
				},
				dispose,
			}),
		} as unknown as Page;

		await expect(new PlaywrightAdaptor(page).evaluate(() => 1)).rejects.toThrow(
			"page function threw",
		);
		expect(dispose).toHaveBeenCalledTimes(1);
	});

	it("reports a CSP problem when the page refuses both routes", async () => {
		const page = {
			evaluate: async () => {
				throw new Error(EVAL_REFUSED);
			},
			evaluateHandle: async () => {
				throw new Error(EVAL_REFUSED);
			},
		} as unknown as Page;

		await expect(new PlaywrightAdaptor(page).evaluate(() => 1)).rejects.toThrow(
			/Content-Security-Policy blocks/,
		);
	});

	it("rethrows unrelated failures unchanged, without trying the other route", async () => {
		const evaluateHandle = vi.fn();
		const page = {
			evaluate: async () => {
				throw new Error("boom");
			},
			evaluateHandle,
		} as unknown as Page;

		await expect(new PlaywrightAdaptor(page).evaluate(() => 1)).rejects.toThrow("boom");
		expect(evaluateHandle).not.toHaveBeenCalled();
	});
});

describe("PlaywrightAdaptor.screenshotClip", () => {
	const clip = { x: 10, y: 3000, width: 100, height: 50 };

	it("falls back to a full-page public capture when there is no CDP", async () => {
		const screenshot = vi.fn(async () => Buffer.from("png"));
		const page = {
			context: () => ({
				newCDPSession: async () => {
					throw new Error("CDP is only available in Chromium");
				},
			}),
			evaluate: async () => {},
			screenshot,
		} as unknown as Page;

		await new PlaywrightAdaptor(page).screenshotClip(clip, 2);

		// Firefox and WebKit render anything outside the viewport blank unless the capture is
		// full-page, and can only capture at the context's own device scale.
		expect(screenshot).toHaveBeenCalledWith({
			type: "png",
			fullPage: true,
			clip,
			scale: "device",
		});
	});
});

describe("PlaywrightAdaptor dialogs", () => {
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
		const adaptor = new PlaywrightAdaptor(page);
		const dismiss = vi.fn(async () => {});

		expect(listeners).toHaveLength(0);

		const stop = adaptor.startDismissingDialogs();
		raise(dismiss);
		await afterListeners();

		expect(dismiss).toHaveBeenCalledTimes(1);

		stop();
		stop();
		raise(dismiss);
		await afterListeners();

		expect(listeners).toHaveLength(0);
		expect(dismiss).toHaveBeenCalledTimes(1);
		expect(adaptor.takeDismissedDialogs()).toBe(1);
	});

	it("dismisses each dialog once however many adaptors and callers hold the page", async () => {
		const { page, raise, listeners } = dialogPage();
		const first = new PlaywrightAdaptor(page);
		const second = new PlaywrightAdaptor(page);
		const dismiss = vi.fn(async () => {});
		const stopFirst = first.startDismissingDialogs();
		const stopSecond = second.startDismissingDialogs();

		raise(dismiss);
		await afterListeners();

		expect(dismiss).toHaveBeenCalledTimes(1);
		expect(second.takeDismissedDialogs()).toBe(1);
		expect(first.takeDismissedDialogs()).toBe(0);

		stopFirst();
		expect(listeners).toHaveLength(1);
		stopSecond();
		expect(listeners).toHaveLength(0);
	});

	it("dismisses for the page's lifetime when dismissDialogs is always", async () => {
		const { page, raise, listeners } = dialogPage();
		const adaptor = new PlaywrightAdaptor(page, { dismissDialogs: "always" });
		const dismiss = vi.fn(async () => {});

		adaptor.startDismissingDialogs()();
		raise(dismiss);
		await afterListeners();

		expect(listeners).toHaveLength(1);
		expect(dismiss).toHaveBeenCalledTimes(1);
	});

	it("leaves dialogs to the caller when dismissDialogs is off", () => {
		const { page, on } = dialogPage();
		const adaptor = new PlaywrightAdaptor(page, { dismissDialogs: false });

		adaptor.startDismissingDialogs();

		expect(on).not.toHaveBeenCalled();
		expect(adaptor.takeDismissedDialogs()).toBe(0);
	});
});

describe("PlaywrightAdaptor.ensureFocusReporting", () => {
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
