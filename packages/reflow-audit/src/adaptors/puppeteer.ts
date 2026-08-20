import type { Page, Viewport } from "puppeteer";
import type { ReflowAuditAdaptor } from "../adaptor";

/** A ReflowAuditAdaptor backed by a Puppeteer Page. */
export class PuppeteerAdaptor implements ReflowAuditAdaptor {
	constructor(private readonly page: Page) {}

	evaluate<T>(
		// biome-ignore lint/suspicious/noExplicitAny: the page-evaluated fn accepts arbitrary serialised args.
		fn: (...args: any[]) => T | Promise<T>,
		...args: unknown[]
	): Promise<T> {
		return this.page.evaluate(fn as never, ...(args as never[])) as Promise<T>;
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
}
