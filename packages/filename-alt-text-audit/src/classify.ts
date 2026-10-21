import { filenameOf } from "./sources";

/**
 * - `filename-match`: the alt text is the full filename of one of the image's own sources.
 * - `filename-near-match`: the alt text matches one of the image's own filenames once the extension
 *   is dropped or separators are read as spaces.
 * - `camera-name`: the alt text is a camera, phone or screenshot file name.
 * - `filename-like`: the alt text ends with an image file extension.
 * - `placeholder`: the alt text is placeholder text, a numbered placeholder, a dimensions string,
 *   digits only or symbols only.
 */
export type AltTextSignal =
	| "filename-match"
	| "filename-near-match"
	| "camera-name"
	| "filename-like"
	| "placeholder";

export type AltTextMatch = {
	signal: AltTextSignal;
	/** The source URL whose filename the alt text matches, for the filename signals. */
	source: string | null;
};

const IMAGE_EXTENSION = /\.(?:jpe?g|jfif|png|gif|webp|svg|avif|bmp|tiff?|ico|heic|heif)$/i;

const ANY_EXTENSION = /\.[a-z0-9]{1,5}$/i;

// The digits-only tail keeps product names such as "IMG-2000 Pro" out.
const CAMERA_NAME =
	/^(?:dsc[nf]?|img|imag|gopr|dji|pxl|mvimg|pano|sam|wp)[\s_-]?\d+(?:[\s_-]\d+)*(?:\s?\(\d+\))?(?:\.[a-z0-9]{2,5})?$/i;

const SCREENSHOT_NAME =
	/^(?:screenshot|screen shot|whatsapp image)[\s_-]+\d[\d\s._:-]*(?:at\s+\d[\d\s.:]*(?:[ap]m)?)?(?:\s?\(\d+\))?(?:\.[a-z0-9]{2,5})?$/i;

const DIMENSIONS = /^\d{2,5}\s?[x×]\s?\d{2,5}$/i;

const DIGITS_ONLY = /^\d+$/;

const SYMBOLS_ONLY = /^[\p{P}\p{S}\s]+$/u;

const NUMBERED = /[\s_-]*\d+$/;

const TERMINAL_PUNCTUATION = /[.!?:;,…]+$/u;

function fold(value: string): string {
	return value.normalize("NFC").trim().toLowerCase();
}

/**
 * Fold `value` and read `-`, `_`, `+` and runs of whitespace as single spaces.
 */
function words(value: string): string {
	// Filenames use these between words.
	return fold(value)
		.replace(/[\s_+-]+/g, " ")
		.trim();
}

function matchOwnFilename(alt: string, sources: readonly string[]): AltTextMatch | null {
	let nearMatch: AltTextMatch | null = null;

	for (const source of sources) {
		const filename = filenameOf(source);

		// An extensionless last segment, such as an image resizer's `/_next/image`, is a route rather
		// than a filename an author or CMS could have copied.
		if (filename === null || !ANY_EXTENSION.test(filename)) {
			continue;
		}

		if (fold(alt) === fold(filename)) {
			return { signal: "filename-match", source };
		}

		const stem = filename.replace(ANY_EXTENSION, "");
		const altWords = words(alt);

		if (nearMatch === null && stem && (altWords === words(filename) || altWords === words(stem))) {
			nearMatch = { signal: "filename-near-match", source };
		}
	}

	return nearMatch;
}

function isPlaceholder(alt: string, placeholders: ReadonlySet<string>): boolean {
	const text = words(alt.replace(TERMINAL_PUNCTUATION, ""));

	if (placeholders.has(text)) {
		return true;
	}

	const unnumbered = text.replace(NUMBERED, "");

	if (unnumbered !== text && placeholders.has(unnumbered)) {
		return true;
	}

	return DIMENSIONS.test(text) || DIGITS_ONLY.test(text) || SYMBOLS_ONLY.test(alt);
}

/**
 * Find what, if anything, makes `alt` a filename or placeholder rather than a text alternative.
 * `sources` are the image's own absolute source URLs; `placeholders` are lower-case placeholder
 * words for the page language.
 */
export function classifyAltText(
	alt: string,
	sources: readonly string[],
	placeholders: ReadonlySet<string>,
): AltTextMatch | null {
	const ownFilename = matchOwnFilename(alt, sources);

	if (ownFilename) {
		return ownFilename;
	}

	const trimmed = alt.trim();

	if (CAMERA_NAME.test(trimmed) || SCREENSHOT_NAME.test(trimmed)) {
		return { signal: "camera-name", source: null };
	}

	if (IMAGE_EXTENSION.test(trimmed)) {
		return { signal: "filename-like", source: null };
	}

	if (isPlaceholder(trimmed, placeholders)) {
		return { signal: "placeholder", source: null };
	}

	return null;
}
