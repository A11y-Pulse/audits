import type { CDPSession, JSHandle, Page } from "playwright-core";
import type { BrowserAdaptor, ElementRef, Rect } from "../adaptor";

// The CDP session for each page, shared by focus emulation and clipped screenshots. A fresh adaptor
// is created per audit run, but a page often outlives one run, so without this each run would open
// another session that is never detached. The session is kept attached for the page's lifetime:
// Chrome clears focus emulation when the CDP client disconnects. Resolves to null on Firefox and
// WebKit, where Playwright offers no CDP.
const cdpSessions = new WeakMap<Page, Promise<CDPSession | null>>();

// Pages that have had focus emulation enabled at least once.
const focusEmulatedPages = new WeakSet<Page>();

const DEFAULT_SCREENSHOT_CLIP_SCALE = 2;

const EVAL_BLOCKED = /EvalError|unsafe-eval|Content Security Policy/i;

function cdpSession(page: Page): Promise<CDPSession | null> {
	const existing = cdpSessions.get(page);

	if (existing) {
		return existing;
	}

	const session = page
		.context()
		.newCDPSession(page)
		.catch(() => null);
	cdpSessions.set(page, session);

	return session;
}

function isChromium(page: Page): boolean {
	try {
		return page.context().browser()?.browserType().name() === "chromium";
	} catch {
		return false;
	}
}

export type PlaywrightAdaptorOptions = {
	/**
	 * Device scale factor for evidence screenshots. Defaults to 2. On Chromium any value is honoured
	 * per capture. Elsewhere this must match the `deviceScaleFactor` the browser context was created
	 * with, because Playwright's public screenshot API cannot rescale a single capture.
	 */
	screenshotClipScale?: number;
};

/** A BrowserAdaptor backed by a Playwright Page. */
export class PlaywrightAdaptor implements BrowserAdaptor {
	readonly screenshotClipScale: number;

	constructor(
		private readonly page: Page,
		options: PlaywrightAdaptorOptions = {},
	) {
		this.screenshotClipScale = options.screenshotClipScale ?? DEFAULT_SCREENSHOT_CLIP_SCALE;
	}

	async evaluate<T>(
		// biome-ignore lint/suspicious/noExplicitAny: the page-evaluated fn accepts arbitrary serialised args and element handles.
		fn: (...args: any[]) => T | Promise<T>,
		...args: unknown[]
	): Promise<T> {
		try {
			// Playwright takes a single argument, so the function source and its args travel packed
			// into one tuple. Handles nested in that tuple are still resolved to live elements.
			return (await this.page.evaluate(
				([source, packed]) => new Function(`return (${source})`)()(...(packed as unknown[])),
				[fn.toString(), args] as [string, unknown[]],
			)) as T;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);

			if (EVAL_BLOCKED.test(message)) {
				throw new Error(
					"The Playwright adaptor rebuilds page functions with new Function(), which this page's Content-Security-Policy blocks. Allow 'unsafe-eval' in script-src, or use the Puppeteer adaptor.",
					{ cause: error },
				);
			}

			throw error;
		}
	}

	evaluateHandle(fn: () => Element | null): Promise<ElementRef> {
		return this.page.evaluateHandle(fn);
	}

	async disposeRef(ref: ElementRef): Promise<void> {
		await (ref as JSHandle).dispose();
	}

	async pressTab(): Promise<void> {
		await this.page.keyboard.press("Tab");
	}

	async pressEnter(): Promise<void> {
		await this.page.keyboard.press("Enter");
	}

	async screenshotClip(clip: Rect, scale = 1): Promise<Uint8Array> {
		const session = await cdpSession(this.page);

		if (session) {
			// The public API cannot scale one capture, and its `clip` is only honoured inside the
			// viewport. CDP is what Puppeteer drives too, so evidence images stay pixel-comparable.
			const { data } = await session.send("Page.captureScreenshot", {
				format: "png",
				captureBeyondViewport: true,
				clip: { ...clip, scale },
			});

			return Buffer.from(data, "base64");
		}

		// Clips are document coordinates, and Playwright renders anything outside the viewport blank
		// unless the capture is full-page.
		return (await this.page.screenshot({
			type: "png",
			fullPage: true,
			clip,
			scale: "device",
		})) as Uint8Array;
	}

	async ensureFocusReporting(): Promise<void> {
		// Pages only report focus while they are the foreground tab. Since this browser instance is
		// likely running in the background, we need to enable focus emulation to get accurate results.
		//
		// Note this function does not throw if enabling emulation fails; it is a best-effort.
		const session = await cdpSession(this.page);

		if (!session) {
			// Playwright emulates focus on Firefox and WebKit itself, so there is nothing to assert
			// and nothing worth warning about.
			if (isChromium(this.page)) {
				console.warn("Could not open a CDP session for the browser adaptor");
			}

			return;
		}

		try {
			if (focusEmulatedPages.has(this.page)) {
				// Chromium ignores a redundant enable, so re-asserting has to toggle.
				await session.send("Emulation.setFocusEmulationEnabled", {
					enabled: false,
				});
			}

			await session.send("Emulation.setFocusEmulationEnabled", {
				enabled: true,
			});
			focusEmulatedPages.add(this.page);
		} catch (error) {
			console.warn("Could not enable focus emulation for the browser adaptor", {
				error,
			});
		}
	}
}
