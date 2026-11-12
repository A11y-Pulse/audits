import {
	ANY_TOKEN,
	OBJECT_STRING,
	SCRIPT_VALUES,
	WHOLE_TEMPLATE_TOKEN,
	WHOLE_WEAK_TOKEN,
} from "./script-artefacts";
import { filenameOf } from "./sources";

/**
 * - `filename-match`: the alt text is the full filename of one of the image's own sources, or that
 *   filename before a CMS or build tool added a size or hash to it.
 * - `artefact`: the alt text is a leftover script value or an unrendered template token, such as
 *   "undefined", "[object Object]" or "{{ image.alt }}".
 * - `filename-near-match`: the alt text matches one of the image's own filenames once the extension
 *   is dropped or separators are read as spaces.
 * - `camera-name`: the alt text is a camera, phone or screenshot file name.
 * - `filename-like`: the alt text ends with an image file extension.
 * - `placeholder`: the alt text is placeholder text, a numbered placeholder, a dimensions string,
 *   a long or zero-padded number, symbols only, or has a template token among other words.
 */
export type AltTextSignal =
	| "filename-match"
	| "artefact"
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

// What a CMS, image CDN or bundler appends to the name an author uploaded: WordPress sizes
// ("-300x200", "-scaled", "-e1700000000000"), density ("@2x") and content hashes (".a91f3c2b").
const GENERATED_SUFFIX =
	/(?:-\d{2,5}x\d{2,5}|-scaled|-rotated|-e\d{10,}|@\dx|[._-](?=[a-f\d]*\d)(?=[a-f\d]*[a-f])[a-f\d]{6,})$/i;

// A single plain word is as likely the image's subject ("GitHub" on github.svg) as its filename.
const STEM_SEPARATOR = /[\s_+-]|\d/;

// The digits-only tail keeps product names such as "IMG-2000 Pro" out.
const CAMERA_NAME =
	/^(?:dsc[nf]?|img|imag|gopr|dji|pxl|mvimg|pano|sam|wp)([\s_-]?)(\d+)(?:[\s_-]\d+)*(?:\s?\(\d+\))?(?:\.[a-z0-9]{2,5})?$/i;

// A camera counter has at least four digits; "Pano 360" and "WP 6" are words and a number.
const CAMERA_COUNTER_DIGITS = 4;

const SCREENSHOT_NAME =
	/^(?:screenshot|screen shot|whatsapp image)[\s_-]+\d[\d\s._:-]*(?:at\s+\d[\d\s.:]*(?:[ap]m)?)?(?:\s?\(\d+\))?(?:\.[a-z0-9]{2,5})?$/i;

const DIMENSIONS = /^\d{2,5}\s?[x×]\s?\d{2,5}$/i;

// "1" on a step marker and "2024" on a badge are what the image shows; "0001" and "20240102" are
// counters and identifiers.
const COUNTER_NUMBER = /^(?:0\d+|\d{5,})$/;

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

/**
 * The stem an author uploaded, before generated size, density and hash suffixes were added.
 */
function uploadedStem(stem: string): string {
	let current = stem;

	// Suffixes stack: "team-photo-scaled-300x200.a91f3c2b".
	for (let i = 0; i < 4; i++) {
		const stripped = current.replace(GENERATED_SUFFIX, "");

		if (stripped === current || stripped === "") {
			break;
		}

		current = stripped;
	}

	return current;
}

function matchOwnFilename(alt: string, sources: readonly string[]): AltTextMatch | null {
	let nearMatch: AltTextMatch | null = null;
	const foldedAlt = fold(alt);
	const altWords = words(alt);

	for (const source of sources) {
		const filename = filenameOf(source);

		// An extensionless last segment, such as an image resizer's `/_next/image`, is a route rather
		// than a filename an author or CMS could have copied.
		if (filename === null || !ANY_EXTENSION.test(filename)) {
			continue;
		}

		const extension = ANY_EXTENSION.exec(filename)![0];
		const stem = filename.slice(0, -extension.length);
		const uploaded = uploadedStem(stem);

		if (
			foldedAlt === fold(filename) ||
			(uploaded !== stem && foldedAlt === fold(uploaded + extension))
		) {
			return { signal: "filename-match", source };
		}

		if (nearMatch !== null || !stem) {
			continue;
		}

		const stems = uploaded === stem ? [stem] : [stem, uploaded];
		const isNearMatch = stems.some(
			(candidate) =>
				altWords === words(candidate + extension) ||
				(altWords === words(candidate) && STEM_SEPARATOR.test(candidate.trim())),
		);

		if (isNearMatch) {
			nearMatch = { signal: "filename-near-match", source };
		}
	}

	return nearMatch;
}

function isCameraName(alt: string): boolean {
	const match = CAMERA_NAME.exec(alt);

	if (!match) {
		return false;
	}

	const [, separator, counter] = match;

	return !/\s/.test(separator!) || counter!.length >= CAMERA_COUNTER_DIGITS;
}

function isArtefact(alt: string): boolean {
	return (
		// With case intact: "Nan" is a name and "Null" a word, and a script writes neither.
		SCRIPT_VALUES.includes(alt) ||
		fold(alt).includes(OBJECT_STRING) ||
		WHOLE_TEMPLATE_TOKEN.test(alt) ||
		WHOLE_WEAK_TOKEN.test(alt)
	);
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

	return (
		DIMENSIONS.test(text) ||
		COUNTER_NUMBER.test(text) ||
		SYMBOLS_ONLY.test(alt) ||
		ANY_TOKEN.test(alt)
	);
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
	// Alt text keeps the line breaks of its template: "{{\n image.alt\n}}".
	const trimmed = alt.replace(/\s+/g, " ").trim();
	const ownFilename = matchOwnFilename(trimmed, sources);

	if (ownFilename?.signal === "filename-match") {
		return ownFilename;
	}

	if (isArtefact(trimmed)) {
		return { signal: "artefact", source: null };
	}

	if (ownFilename) {
		return ownFilename;
	}

	if (isCameraName(trimmed) || SCREENSHOT_NAME.test(trimmed)) {
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
