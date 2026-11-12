import {
	PuppeteerAdaptor as BrowserPuppeteerAdaptor,
	type PuppeteerAdaptorOptions,
} from "@a11y-pulse/browser-adaptor/puppeteer";
import type { Page, Viewport } from "puppeteer";
import type { Rect, ResizeTextAuditAdaptor } from "../adaptor";

export type { PuppeteerAdaptorOptions } from "@a11y-pulse/browser-adaptor/puppeteer";

function windowSizeScript(): { width: number; height: number } {
	return { width: window.innerWidth, height: window.innerHeight };
}

/** A ResizeTextAuditAdaptor backed by a Puppeteer Page. */
export class PuppeteerAdaptor implements ResizeTextAuditAdaptor {
	readonly screenshotClipScale: number;

	private readonly browser: BrowserPuppeteerAdaptor;

	/** The size the page had when it was found with no emulated viewport, until that is restored. */
	private windowSize: { width: number; height: number } | null = null;

	constructor(
		private readonly page: Page,
		options: PuppeteerAdaptorOptions = {},
	) {
		// Evidence is a region of the page that need not be in view. The viewport resize this causes
		// can re-render a page that reacts to it, but every measurement is taken before the evidence
		// is captured, so at worst the evidence differs from what was measured.
		this.browser = new BrowserPuppeteerAdaptor(page, {
			screenshotClipScale: options.screenshotClipScale ?? 1,
			optimizeForSpeed: options.optimizeForSpeed ?? false,
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
		const viewport = this.page.viewport();

		if (viewport) {
			return { width: viewport.width, height: viewport.height };
		}

		// No viewport is being emulated (`defaultViewport: null`), so the page fills its window
		// and the window says how big it is.
		this.windowSize = await this.page.evaluate(windowSizeScript);

		return this.windowSize;
	}

	async setViewport(v: { width: number; height: number }): Promise<void> {
		const current = this.page.viewport();
		const unemulated = this.windowSize;

		// Being asked for the size the window had before any emulation is being asked to put the
		// page back, which is done by dropping the emulation, not by emulating that size.
		if (unemulated && v.width === unemulated.width && v.height === unemulated.height) {
			this.windowSize = null;
			await this.page.setViewport(null);
			// Dropping the emulation resizes the page a moment later, not before this returns.
			await this.page
				.waitForFunction(
					(width: number, height: number) =>
						window.innerWidth === width && window.innerHeight === height,
					{ timeout: 1000 },
					v.width,
					v.height,
				)
				.catch(() => {});

			return;
		}

		const next: Viewport = current
			? { ...current, width: v.width, height: v.height }
			: { width: v.width, height: v.height };

		await this.page.setViewport(next);
	}

	screenshotClip(clip: Rect, scale = 1): Promise<Uint8Array> {
		return this.browser.screenshotClip(clip, scale);
	}
}
