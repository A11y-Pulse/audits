import type { AltTextSource } from "./browser-scripts";
import type { AltTextSignal } from "./classify";

export type FilenameAltTextImage = {
	/** Selector for the image (see getSelector). */
	selector: string;

	/** Truncated opening tag. */
	html: string;

	/** The `aria-label`, or the `alt` or SVG `<title>` when there is no `aria-label`, trimmed. */
	altText: string;

	/** Where `altText` was read from. `title` is the `<title>` of an inline SVG. */
	altTextSource: AltTextSource;

	/** What makes the alt text a filename or placeholder, or null when nothing does. */
	signal: AltTextSignal | null;

	/** The source URL whose filename the alt text matches, for the filename signals. */
	matchedSource: string | null;
	/**
	 * PNG bytes of the image, clipped and padded. Only captured for failed and needs-review images,
	 * and omitted past `screenshotLimit`.
	 */
	screenshot?: Uint8Array;
};

export type FilenameAltTextResult = {
	/**
	 * Alt text that is the image's own filename, extension included, or a leftover script value or
	 * template token: failure F30.
	 */
	failed: FilenameAltTextImage[];

	/** Alt text that looks like a filename or placeholder, for a human to check. */
	needsReview: FilenameAltTextImage[];

	passed: FilenameAltTextImage[];

	/** Full counts. Each image list stops at `reportLimit`. */
	summary: {
		/** Rendered images with alt text, up to `imageLimit`. */
		checked: number;
		failed: number;
		needsReview: number;
		passed: number;
		/** Images with alt text past `imageLimit`, which were not checked. */
		unchecked: number;
	};
};
