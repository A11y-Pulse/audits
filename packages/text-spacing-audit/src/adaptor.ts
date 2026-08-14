/**
 * An element handle in the page. This type is adaptor-specific and is opaque to the audit.
 */
export type ElementRef = unknown;

/**
 * A framework-specific adaptor that provides the primitives needed by the audit. An adaptor wraps
 * a single page in a web browser.
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
}
