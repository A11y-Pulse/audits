import {
	PlaywrightAdaptor as BrowserPlaywrightAdaptor,
	type PlaywrightAdaptorOptions,
} from "@a11y-pulse/browser-adaptor/playwright";
import type { Page } from "playwright-core";
import type { Rect, TextSpacingAuditAdaptor } from "../adaptor";

export type { PlaywrightAdaptorOptions } from "@a11y-pulse/browser-adaptor/playwright";

/** A TextSpacingAuditAdaptor backed by a Playwright Page. */
export class PlaywrightAdaptor implements TextSpacingAuditAdaptor {
	readonly screenshotClipScale: number;

	private readonly browser: BrowserPlaywrightAdaptor;

	constructor(page: Page, options: PlaywrightAdaptorOptions = {}) {
		this.browser = new BrowserPlaywrightAdaptor(page, {
			screenshotClipScale: options.screenshotClipScale ?? 1,
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
