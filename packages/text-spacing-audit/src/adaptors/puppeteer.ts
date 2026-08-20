import type { Page } from "puppeteer";
import type { TextSpacingAuditAdaptor } from "../adaptor";

/** A TextSpacingAuditAdaptor backed by a Puppeteer Page. */
export class PuppeteerAdaptor implements TextSpacingAuditAdaptor {
	constructor(private readonly page: Page) {}

	evaluate<T>(
		// biome-ignore lint/suspicious/noExplicitAny: the page-evaluated fn accepts arbitrary serialised args.
		fn: (...args: any[]) => T | Promise<T>,
		...args: unknown[]
	): Promise<T> {
		return this.page.evaluate(fn as never, ...(args as never[])) as Promise<T>;
	}
}
