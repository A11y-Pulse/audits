import type { AltTextSignal } from "./classify";

export type FilenameAltTextImage = {
	/** Selector for the image (see getSelector). */
	selector: string;

	/** Truncated opening tag. */
	html: string;

	/** The `aria-label`, or the `alt` when there is no `aria-label`, trimmed. */
	altText: string;

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
	/** Alt text that is the image's own filename, extension included: failure F30. */
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
