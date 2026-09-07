import type { Rect } from "@a11y-pulse/browser-adaptor";

export type { Rect } from "@a11y-pulse/browser-adaptor";

/**
 * An element handle in the page. This type is adaptor-specific and is opaque to the audit.
 */
export type ElementRef = unknown;

/**
 * A framework-specific adaptor that provides the primitives needed by the audit. An adaptor wraps a
 * single page in a web browser.
 */
export interface TextSpacingAuditAdaptor {
	/**
	 * Run `fn` in the page context, passing in any serialisable `args`
	 */
	evaluate<T>(
		// biome-ignore lint/suspicious/noExplicitAny: `fn` accepts arbitrary serialised arguments
		fn: (...args: any[]) => T | Promise<T>,
		...args: unknown[]
	): Promise<T>;

	/**
	 * Screenshot a clipped region of the page defined by `clip`. `scale` is the device scale factor
	 * (bitmap pixels per CSS pixel), multiplied against whatever deviceScaleFactor the page itself
	 * currently has (Puppeteer does not replace it). The caller is responsible for the page being at
	 * a known deviceScaleFactor before invoking this. This function must return PNG bytes.
	 */
	screenshotClip(clip: Rect, scale?: number): Promise<Uint8Array>;

	/** Device scale factor for evidence screenshots. Defaults to 1. */
	readonly screenshotClipScale?: number;
}
