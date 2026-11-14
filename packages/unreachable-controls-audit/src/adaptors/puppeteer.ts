import {
	PuppeteerAdaptor as BrowserPuppeteerAdaptor,
	type PuppeteerAdaptorOptions,
} from "@a11y-pulse/browser-adaptor/puppeteer";
import type { Page } from "puppeteer";
import type { ElementInspection, UnreachableControlsAdaptor } from "../adaptor";
import { inspectStashedElements } from "./cdp";

export type { PuppeteerAdaptorOptions } from "@a11y-pulse/browser-adaptor/puppeteer";

/**
 * Inspect the elements a page script stashed on `window[stashKey]` over a DevTools session of its
 * own. Null when the session cannot be opened. Use it to give an existing adaptor an
 * `inspectElements`.
 */
export async function inspectElements(
	page: Page,
	stashKey: string,
	count: number,
	roles: readonly number[],
): Promise<ElementInspection[] | null> {
	let session: Awaited<ReturnType<Page["createCDPSession"]>>;

	try {
		session = await page.createCDPSession();
	} catch {
		return null;
	}

	try {
		return await inspectStashedElements(session, stashKey, count, roles);
	} catch {
		return null;
	} finally {
		await session.detach().catch(() => {});
	}
}

/** An UnreachableControlsAdaptor backed by a Puppeteer Page. */
export class PuppeteerAdaptor
	extends BrowserPuppeteerAdaptor
	implements UnreachableControlsAdaptor
{
	private readonly inspectedPage: Page;

	constructor(page: Page, options: PuppeteerAdaptorOptions = {}) {
		super(page, options);
		this.inspectedPage = page;
	}

	inspectElements(
		stashKey: string,
		count: number,
		roles: readonly number[],
	): Promise<ElementInspection[] | null> {
		return inspectElements(this.inspectedPage, stashKey, count, roles);
	}
}
