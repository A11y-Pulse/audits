import type { CDPSession, Dialog, JSHandle, KeyInput, Page } from "puppeteer";
import type { BrowserAdaptor, ElementRef, KeyName, Rect } from "../adaptor";
import { nextPaintScript } from "../paint";

// Keep track of the CDP session for each page so that we can reuse it. The session is kept
// attached for the page's lifetime: Chrome clears focus emulation when the CDP client disconnects.
// Resolves to null when a session cannot be opened, so the failure is not retried on every call.
const cdpSessions = new WeakMap<Page, Promise<CDPSession | null>>();

// Pages that have had focus emulation enabled at least once.
const focusEmulatedPages = new WeakSet<Page>();

// Dialog dismissal per page, shared by every adaptor wrapping that page: how many dialogs were
// dismissed and not yet reported, how many callers currently want dialogs dismissed, the listener
// doing it while any does, and the last dialog the page raised, which may still be open.
type DialogState = {
	count: number;
	holds: number;
	listener: ((dialog: Dialog) => void) | null;
	watching: boolean;
	last: Dialog | null;
};

function dialogStateOf(page: Page): DialogState {
	let state = dialogStates.get(page);

	if (state === undefined) {
		state = { count: 0, holds: 0, listener: null, watching: false, last: null };
		dialogStates.set(page, state);
	}

	return state;
}

/**
 * Remember the last dialog `page` raised, without answering it. Puppeteer leaves a dialog nobody
 * answers open, and an open dialog blocks every call to the page, so whoever starts dismissing
 * dialogs later has to be able to close one that was raised before they started. Watching answers
 * nothing, so the caller's own `dialog` handler is unaffected.
 */
function watchDialogsOn(page: Page): void {
	if (typeof page.on !== "function") {
		return;
	}

	const state = dialogStateOf(page);

	if (state.watching) {
		return;
	}

	state.watching = true;
	page.on("dialog", (dialog: Dialog) => {
		state.last = dialog;
	});
}

const dialogStates = new WeakMap<Page, DialogState>();

const DEFAULT_SCREENSHOT_CLIP_SCALE = 2;

function cdpSession(page: Page): Promise<CDPSession | null> {
	const existing = cdpSessions.get(page);

	if (existing) {
		return existing;
	}

	const session = page.createCDPSession().catch(() => null);
	cdpSessions.set(page, session);

	return session;
}

export type PuppeteerAdaptorOptions = {
	/** Device scale factor for evidence screenshots. Defaults to 2, applied per capture. */
	screenshotClipScale?: number;

	/**
	 * Trade PNG compression for capture speed. Defaults to true, which roughly doubles the encoded
	 * size of each capture without changing a single pixel.
	 */
	optimizeForSpeed?: boolean;

	/**
	 * Let a clip capture content outside the current viewport. Defaults to false: to honour it
	 * Chromium shrinks the emulated viewport to 1x1 and then resizes it for the clip before
	 * restoring it, and the page observes each of those as a real resize (`resize` fires, media
	 * queries flip to their narrowest breakpoint), which can collapse a responsive layout and blur
	 * the focused element mid-capture. Only enable it for evidence of regions the caller cannot
	 * scroll into view, where the page's state does not matter.
	 */
	captureBeyondViewport?: boolean;

	/**
	 * Whether to dismiss native dialogs (`alert`, `confirm`, `prompt`, `beforeunload`), and count
	 * them. A dialog blocks the page until something answers it, so an unanswered one hangs every
	 * later call.
	 *
	 * - `true`, the default: only while something has asked for it through `startDismissingDialogs`,
	 *   which a tab session does for as long as it runs. Outside that the page's dialogs are the
	 *   caller's to handle, and inside it a `dialog` listener of the caller's that answers a dialog
	 *   as it is raised still gets to.
	 * - `"always"`: from construction, for the page's lifetime. For a caller that hands the whole
	 *   page over, such as the audit runner.
	 * - `false`: never. The caller handles `dialog` events itself.
	 */
	dismissDialogs?: boolean | "always";
};

/**
 * Dismiss the dialogs `page` raises, counting them, until the returned function is called. The
 * listener is on the page only while at least one caller holds it, so a caller's own `dialog`
 * handler has the page to itself the rest of the time.
 */
function dismissDialogsOn(page: Page): () => void {
	if (typeof page.on !== "function") {
		return () => {};
	}

	const held = dialogStateOf(page);

	if (held.holds++ === 0) {
		// A dialog raised before anyone was dismissing them may still be open, blocking the page.
		// Dismissing one that was answered since rejects, which is fine. It is not counted: it
		// predates whatever is starting now.
		const earlier = held.last;
		held.last = null;

		if (earlier !== null) {
			Promise.resolve()
				.then(() => earlier.dismiss())
				.catch(() => {});
		}

		const listener = (dialog: Dialog): void => {
			held.count++;

			// Not answered until every other listener has had the dialog: one of the caller's own that
			// answers it as it is raised then gets to, instead of finding it already handled. The
			// dismissal rejects when that happened, which is as good as dismissed.
			setTimeout(() => {
				dialog.dismiss().catch(() => {});
			}, 0);
		};

		held.listener = listener;
		page.on("dialog", listener);
	}

	let released = false;

	return () => {
		if (released) {
			return;
		}

		released = true;

		if (--held.holds === 0 && held.listener !== null) {
			page.off("dialog", held.listener);
			held.listener = null;
		}
	};
}

/** A BrowserAdaptor backed by a Puppeteer Page. */
export class PuppeteerAdaptor implements BrowserAdaptor {
	readonly screenshotClipScale: number;

	private readonly optimizeForSpeed: boolean;

	private readonly captureBeyondViewport: boolean;

	private readonly dismissDialogs: boolean | "always";

	constructor(
		private readonly page: Page,
		options: PuppeteerAdaptorOptions = {},
	) {
		this.screenshotClipScale = options.screenshotClipScale ?? DEFAULT_SCREENSHOT_CLIP_SCALE;
		this.optimizeForSpeed = options.optimizeForSpeed ?? true;
		this.captureBeyondViewport = options.captureBeyondViewport ?? false;
		this.dismissDialogs = options.dismissDialogs ?? true;

		if (this.dismissDialogs === "always") {
			dismissDialogsOn(page);
		} else if (this.dismissDialogs) {
			watchDialogsOn(page);
		}
	}

	startDismissingDialogs(): () => void {
		return this.dismissDialogs === false ? () => {} : dismissDialogsOn(this.page);
	}

	takeDismissedDialogs(): number {
		const state = dialogStates.get(this.page);
		const count = state?.count ?? 0;

		if (state) {
			state.count = 0;
		}

		return count;
	}

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

	async pressKey(key: KeyName): Promise<void> {
		const { keyboard } = this.page;
		// Puppeteer has no syntax for a combination, so modifiers are held down by hand.
		const modifiers = key.split("+") as KeyInput[];
		const name = modifiers.pop()!;

		for (const modifier of modifiers) {
			await keyboard.down(modifier);
		}

		try {
			await keyboard.press(name);
		} finally {
			for (const modifier of modifiers) {
				await keyboard.up(modifier);
			}
		}
	}

	async screenshotClip(clip: Rect, scale = 1): Promise<Uint8Array> {
		const session = await cdpSession(this.page);

		if (!session) {
			await this.page.evaluate(nextPaintScript);

			// Without CDP the public API is all there is. With captureBeyondViewport off it intersects
			// the clip with the viewport, so a clip that does not fit comes back smaller than asked
			// for, with a shifted origin.
			return (await this.page.screenshot({
				type: "png",
				optimizeForSpeed: this.optimizeForSpeed,
				captureBeyondViewport: this.captureBeyondViewport,
				clip: { ...clip, scale },
			})) as Uint8Array;
		}

		// No wait for a paint first: Chromium renders a frame of the page as it stands for every
		// capture it is asked for through CDP.
		//
		// Straight to CDP rather than page.screenshot(): with captureBeyondViewport off, Puppeteer
		// intersects the clip with the visual viewport and silently moves the origin that callers
		// align element rects against. Keeping captureBeyondViewport off ensures that Chromium does
		// not resize the viewport, which can trigger media queries and hide the element we are
		// trying to capture.
		const { data } = await session.send("Page.captureScreenshot", {
			format: "png",
			optimizeForSpeed: this.optimizeForSpeed,
			captureBeyondViewport: this.captureBeyondViewport,
			clip: { ...clip, scale },
		});

		return Buffer.from(data, "base64");
	}

	async ensureFocusReporting(): Promise<void> {
		// Pages only report focus while they are the foreground tab. Since this browser instance is
		// likely running in the background, we need to enable focus emulation to get accurate results.
		//
		// Note this function does not throw if enabling emulation fails; it is a best-effort.
		try {
			const session = await cdpSession(this.page);

			if (!session) {
				throw new Error("Could not open a CDP session");
			}

			if (focusEmulatedPages.has(this.page)) {
				// Chromium ignores a redundant enable, so re-asserting has to toggle.
				await session.send("Emulation.setFocusEmulationEnabled", {
					enabled: false,
				});
			}

			await session.send("Emulation.setFocusEmulationEnabled", {
				enabled: true,
			});
			focusEmulatedPages.add(this.page);
		} catch (error) {
			console.warn("Could not enable focus emulation for the browser adaptor", {
				error,
			});
		}
	}
}
