import type { CDPSession, JSHandle, Page } from "puppeteer";
import type { BrowserAdaptor, ElementRef, Rect } from "../adaptor";
import { nextPaintScript } from "../paint";

// Keep track of the CDP session for each page so that we can reuse it. The session is kept
// attached for the page's lifetime: Chrome clears focus emulation when the CDP client disconnects.
// Resolves to null when a session cannot be opened, so the failure is not retried on every call.
const cdpSessions = new WeakMap<Page, Promise<CDPSession | null>>();

// Pages that have had focus emulation enabled at least once.
const focusEmulatedPages = new WeakSet<Page>();

const DEFAULT_SCREENSHOT_CLIP_SCALE = 2;

function cdpSession(page: Page): Promise<CDPSession | null> {
	const existing = cdpSessions.get(page);

	if (existing) {
		return existing;
	}

	const session = page.createCDPSession().catch(() => null);
	cdpSessions.set(page, session);

	return session;
}

export type PuppeteerAdaptorOptions = {
	/** Device scale factor for evidence screenshots. Defaults to 2, applied per capture. */
	screenshotClipScale?: number;

	/**
	 * Trade PNG compression for capture speed. Defaults to true, which roughly doubles the encoded
	 * size of each capture without changing a single pixel.
	 */
	optimizeForSpeed?: boolean;

	/**
	 * Let a clip capture content outside the current viewport. Defaults to false: to honour it
	 * Chromium shrinks the emulated viewport to 1x1 and then resizes it for the clip before
	 * restoring it, and the page observes each of those as a real resize (`resize` fires, media
	 * queries flip to their narrowest breakpoint), which can collapse a responsive layout and blur
	 * the focused element mid-capture. Only enable it for evidence of regions the caller cannot
	 * scroll into view, where the page's state does not matter.
	 */
	captureBeyondViewport?: boolean;
};

/** A BrowserAdaptor backed by a Puppeteer Page. */
export class PuppeteerAdaptor implements BrowserAdaptor {
	readonly screenshotClipScale: number;

	private readonly optimizeForSpeed: boolean;

	private readonly captureBeyondViewport: boolean;

	constructor(
		private readonly page: Page,
		options: PuppeteerAdaptorOptions = {},
	) {
		this.screenshotClipScale = options.screenshotClipScale ?? DEFAULT_SCREENSHOT_CLIP_SCALE;
		this.optimizeForSpeed = options.optimizeForSpeed ?? true;
		this.captureBeyondViewport = options.captureBeyondViewport ?? false;
	}

	evaluate<T>(
		// biome-ignore lint/suspicious/noExplicitAny: the page-evaluated fn accepts arbitrary serialised args and element handles.
		fn: (...args: any[]) => T | Promise<T>,
		...args: unknown[]
	): Promise<T> {
		// Puppeteer resolves any JSHandle passed as an arg to the live element.
		return this.page.evaluate(fn as never, ...(args as never[])) as Promise<T>;
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
		await this.page.evaluate(nextPaintScript);

		const session = await cdpSession(this.page);

		if (!session) {
			// Without CDP the public API is all there is. With captureBeyondViewport off it intersects
			// the clip with the viewport, so a clip that does not fit comes back smaller than asked
			// for, with a shifted origin.
			return (await this.page.screenshot({
				type: "png",
				optimizeForSpeed: this.optimizeForSpeed,
				captureBeyondViewport: this.captureBeyondViewport,
				clip: { ...clip, scale },
			})) as Uint8Array;
		}

		// Straight to CDP rather than page.screenshot(): with captureBeyondViewport off, Puppeteer
		// intersects the clip with the visual viewport and silently moves the origin that callers
		// align element rects against. Keeping captureBeyondViewport off ensures that Chromium does
		// not resize the viewport, which can trigger media queries and hide the element we are
		// trying to capture.
		const { data } = await session.send("Page.captureScreenshot", {
			format: "png",
			optimizeForSpeed: this.optimizeForSpeed,
			captureBeyondViewport: this.captureBeyondViewport,
			clip: { ...clip, scale },
		});

		return Buffer.from(data, "base64");
	}

	async ensureFocusReporting(): Promise<void> {
		// Pages only report focus while they are the foreground tab. Since this browser instance is
		// likely running in the background, we need to enable focus emulation to get accurate results.
		//
		// Note this function does not throw if enabling emulation fails; it is a best-effort.
		try {
			const session = await cdpSession(this.page);

			if (!session) {
				throw new Error("Could not open a CDP session");
			}

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
