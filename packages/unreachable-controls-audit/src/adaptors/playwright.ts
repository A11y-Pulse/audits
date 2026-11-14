import {
	PlaywrightAdaptor as BrowserPlaywrightAdaptor,
	type PlaywrightAdaptorOptions,
} from "@a11y-pulse/browser-adaptor/playwright";
import type { Page } from "playwright-core";
import type { ElementInspection, UnreachableControlsAdaptor } from "../adaptor";
import { type CdpSession, inspectStashedElements } from "./cdp";

export type { PlaywrightAdaptorOptions } from "@a11y-pulse/browser-adaptor/playwright";

/**
 * Inspect the elements a page script stashed on `window[stashKey]` over a DevTools session of its
 * own. Null on Firefox and WebKit, which have no such session. Use it to give an existing adaptor
 * an `inspectElements`.
 */
export async function inspectElements(
	page: Page,
	stashKey: string,
	count: number,
	roles: readonly number[],
): Promise<ElementInspection[] | null> {
	let session: CdpSession;

	try {
		session = await page.context().newCDPSession(page);
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

/** An UnreachableControlsAdaptor backed by a Playwright Page. */
export class PlaywrightAdaptor
	extends BrowserPlaywrightAdaptor
	implements UnreachableControlsAdaptor
{
	private readonly inspectedPage: Page;

	constructor(page: Page, options: PlaywrightAdaptorOptions = {}) {
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
