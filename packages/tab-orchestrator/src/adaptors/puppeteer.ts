import type { CDPSession, JSHandle, Page } from "puppeteer";
import type { BrowserAdaptor, ElementRef, Rect } from "../adaptor";

// The CDP session holding focus emulation for each page. A fresh adaptor is created per audit run,
// but a page often outlives one run, so without this each run would open another CDP session that
// is never detached. The session is kept attached for the page's lifetime: Chrome clears the
// emulation when the CDP client disconnects.
const focusEmulationSessions = new WeakMap<Page, CDPSession>();

/** A BrowserAdaptor backed by a Puppeteer Page. */
export class PuppeteerAdaptor implements BrowserAdaptor {
	readonly screenshotClipScale = 2;

	constructor(private readonly page: Page) {}

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

	async screenshotClip(clip: Rect, scale = 1): Promise<Uint8Array> {
		return (await this.page.screenshot({
			type: "png",
			optimizeForSpeed: true,
			clip: {
				...clip,
				scale,
			},
		})) as Uint8Array;
	}

	async ensureFocusReporting(): Promise<void> {
		// Pages only report focus while they are the foreground tab. Since this browser instance is
		// likely running in the background, we need to enable focus emulation to get accurate results.
		//
		// Note this function does not throw if enabling emulation fails; it is a best-effort.
		try {
			const existing = focusEmulationSessions.get(this.page);

			if (existing) {
				// Chromium ignores a redundant enable, so re-asserting has to toggle.
				await existing.send("Emulation.setFocusEmulationEnabled", {
					enabled: false,
				});
				await existing.send("Emulation.setFocusEmulationEnabled", {
					enabled: true,
				});

				return;
			}

			const client = await this.page.createCDPSession();
			await client.send("Emulation.setFocusEmulationEnabled", {
				enabled: true,
			});
			focusEmulationSessions.set(this.page, client);
		} catch (error) {
			console.warn("Could not enable focus emulation for the tab orchestrator", { error });
		}
	}
}
