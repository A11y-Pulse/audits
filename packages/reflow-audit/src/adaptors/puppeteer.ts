import {
	PuppeteerAdaptor as BrowserPuppeteerAdaptor,
	type PuppeteerAdaptorOptions,
} from "@a11y-pulse/browser-adaptor/puppeteer";
import type { Page, Viewport } from "puppeteer";
import type { Rect, ReflowAuditAdaptor } from "../adaptor";

export type { PuppeteerAdaptorOptions } from "@a11y-pulse/browser-adaptor/puppeteer";

/** A ReflowAuditAdaptor backed by a Puppeteer Page. */
export class PuppeteerAdaptor implements ReflowAuditAdaptor {
	readonly screenshotClipScale: number;

	private readonly browser: BrowserPuppeteerAdaptor;

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

		if (!viewport) {
			return { width: 800, height: 600 };
		}

		return { width: viewport.width, height: viewport.height };
	}

	async setViewport(v: { width: number; height: number }): Promise<void> {
		const current = this.page.viewport();
		const next: Viewport = current
			? { ...current, width: v.width, height: v.height }
			: { width: v.width, height: v.height };

		await this.page.setViewport(next);
	}

	screenshotClip(clip: Rect, scale = 1): Promise<Uint8Array> {
		return this.browser.screenshotClip(clip, scale);
	}
}
