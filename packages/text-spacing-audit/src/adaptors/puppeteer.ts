import {
	PuppeteerAdaptor as BrowserPuppeteerAdaptor,
	type PuppeteerAdaptorOptions,
} from "@a11y-pulse/browser-adaptor/puppeteer";
import type { Page } from "puppeteer";
import type { Rect, TextSpacingAuditAdaptor } from "../adaptor";

export type { PuppeteerAdaptorOptions } from "@a11y-pulse/browser-adaptor/puppeteer";

/** A TextSpacingAuditAdaptor backed by a Puppeteer Page. */
export class PuppeteerAdaptor implements TextSpacingAuditAdaptor {
	readonly screenshotClipScale: number;

	private readonly browser: BrowserPuppeteerAdaptor;

	constructor(page: Page, options: PuppeteerAdaptorOptions = {}) {
		this.browser = new BrowserPuppeteerAdaptor(page, {
			screenshotClipScale: options.screenshotClipScale ?? 1,
			optimizeForSpeed: options.optimizeForSpeed ?? false,
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

	screenshotClip(clip: Rect, scale = 1): Promise<Uint8Array> {
		return this.browser.screenshotClip(clip, scale);
	}
}
