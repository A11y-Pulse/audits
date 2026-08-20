export type Rect = { x: number; y: number; width: number; height: number };

/**
 * An element handle in the page. This type is adaptor-specific and is opaque to the audit.
 */
export type ElementRef = unknown;

/**
 * A framework-specific adaptor that provides the primitives needed by the audit. An adaptor wraps
 * a single page in a web browser.
 */
export interface BrowserAdaptor {
	/**
	 * Run `fn` in the page context, passing in any serialisable `args`
	 */
	evaluate<T>(
		// biome-ignore lint/suspicious/noExplicitAny: `fn` accepts arbitrary serialised arguments
		fn: (...args: any[]) => T | Promise<T>,
		...args: unknown[]
	): Promise<T>;

	/**
	 * Return an opaque handle to an element in the page
	 */
	evaluateHandle(fn: () => Element | null): Promise<ElementRef>;

	/**
	 * Release a handle previously returned by evaluateHandle
	 */
	disposeRef(ref: ElementRef): Promise<void>;

	/**
	 * Press the tab key
	 */
	pressTab(): Promise<void>;

	/**
	 * Screenshot a clipped region of the page. `scale` is the device scale
	 * factor (bitmap pixels per CSS pixel).
	 */
	screenshotClip(clip: Rect, scale?: number): Promise<Uint8Array>;

	/** Device scale factor for evidence screenshots stored on failure. */
	readonly screenshotClipScale?: number;

	/**
	 * Ensure the page reports focus for its lifetime. In particular, `document.hasFocus()` must
	 * function correctly and :focus styles must be applied, even when the page is not the
	 * foreground.
	 *
	 * This function must not throw.
	 */
	ensureFocusReporting(): Promise<void>;
}
