import {
	PlaywrightAdaptor as BrowserPlaywrightAdaptor,
	type PlaywrightAdaptorOptions,
} from "@a11y-pulse/browser-adaptor/playwright";
import type { Page } from "playwright-core";
import type { Rect, ReflowAuditAdaptor } from "../adaptor";

export type { PlaywrightAdaptorOptions } from "@a11y-pulse/browser-adaptor/playwright";

/** A ReflowAuditAdaptor backed by a Playwright Page. */
export class PlaywrightAdaptor implements ReflowAuditAdaptor {
	readonly screenshotClipScale: number;

	private readonly browser: BrowserPlaywrightAdaptor;

	constructor(
		private readonly page: Page,
		options: PlaywrightAdaptorOptions = {},
	) {
		// Evidence is a region of the page that need not be in view. The viewport resize this causes
		// can re-render a page that reacts to it, but every measurement is taken before the evidence
		// is captured, so at worst the evidence differs from what was measured.
		this.browser = new BrowserPlaywrightAdaptor(page, {
			screenshotClipScale: options.screenshotClipScale ?? 1,
			captureBeyondViewport: options.captureBeyondViewport ?? true,
		});
		this.screenshotClipScale = this.browser.screenshotClipScale;
	}

	evaluate<T>(
		// biome-ignore lint/suspicious/noExplicitAny: the page-evaluated fn accepts arbitrary serialised args.
		fn: (...args: any[]) => T | Promise<T>,
		...args: unknown[]
	): Promise<T> {
		return this.browser.evaluate(fn, ...args);
	}

	async getViewport(): Promise<{ width: number; height: number }> {
		// Null when the context was created with `viewport: null`: the page fills its window, whose
		// size only the page can report. Playwright has no way to hand the viewport back to the
		// window afterwards, so restoring sets this same size.
		return (
			this.page.viewportSize() ??
			(await this.browser.evaluate(() => ({
				width: window.innerWidth,
				height: window.innerHeight,
			})))
		);
	}

	async setViewport(viewport: { width: number; height: number }): Promise<void> {
		// Resizes the CSS viewport only, not the window. The audit measures reflow against the CSS
		// viewport, so the window size does not matter.
		await this.page.setViewportSize(viewport);
	}

	screenshotClip(clip: Rect, scale = 1): Promise<Uint8Array> {
		return this.browser.screenshotClip(clip, scale);
	}
}
