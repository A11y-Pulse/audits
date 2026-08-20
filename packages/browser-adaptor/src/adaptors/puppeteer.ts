import type { JSHandle, Page } from "puppeteer";
import type { BrowserAdaptor, ElementRef, Rect } from "../adaptor";

// Pages that already have focus emulation enabled. A fresh adaptor is created per
// audit run, but a page is often reused across runs (e.g. one page per snapshot,
// many checks), so without this each run would open another CDP session that is
// never detached. The emulation persists for the page's lifetime, so enabling it
// once is enough. (Detaching the session instead is not an option. Chrome clears
// the emulation when the CDP client disconnects.)
const focusEmulationEnabled = new WeakSet<Page>();

/** A BrowserAdaptor backed by a Puppeteer Page. */
export class PuppeteerAdaptor implements BrowserAdaptor {
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

	async pressEnter(): Promise<void> {
		await this.page.keyboard.press("Enter");
	}

	async screenshotClip(clip: Rect): Promise<Uint8Array> {
		return (await this.page.screenshot({ type: "png", clip })) as Uint8Array;
	}

	async ensureFocusReporting(): Promise<void> {
		// Pages only report focus while they are the foreground tab. Since this browser instance
		// is likely running in the background, we need to enable focus emulation to get accurate
		// results.
		//
		// Note this function does not throw if enabling emulation fails; it is a best-effort.
		if (focusEmulationEnabled.has(this.page)) {
			return;
		}

		try {
			const client = await this.page.createCDPSession();
			await client.send("Emulation.setFocusEmulationEnabled", {
				enabled: true,
			});
			focusEmulationEnabled.add(this.page);
		} catch (error) {
			console.warn("Could not enable focus emulation for the browser adaptor", {
				error,
			});
		}
	}
}
