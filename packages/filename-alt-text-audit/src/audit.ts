import {
	type BrowserAdaptor,
	captureElementScreenshot,
	releaseStashedElements,
	stashedElementHandle,
	stashedElementSelectors,
} from "@a11y-pulse/browser-adaptor";
import { truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import {
	awaitImageScript,
	type CollectedImage,
	collectImagesScript,
	restoreScrollScript,
	scrollPositionScript,
} from "./browser-scripts";
import { type AltTextMatch, classifyAltText } from "./classify";
import { placeholderWordsFor } from "./placeholder-words";
import type { FilenameAltTextImage, FilenameAltTextResult } from "./result";
import { parseSrcset } from "./sources";

export const DEFAULT_IMAGE_LIMIT = 2000;
export const DEFAULT_REPORT_LIMIT = 10;
export const DEFAULT_SCREENSHOT_LIMIT = 10;

const SCREENSHOT_CLIP_BUFFER = 10;
const SCREENSHOT_SETTLE_MS = 33; // ~2 frames at 60fps
// Long enough for an image near the viewport to arrive, short enough not to stall on a broken one.
const IMAGE_LOAD_TIMEOUT_MS = 2000;

const STASH_KEY = "__a11yPulseFilenameAltText";

// Longer than any filename a common filesystem allows (255 bytes), so a cut-short alt is never one.
const ALT_TEXT_LIMIT = 300;

export type FilenameAltTextOptions = {
	/** Max images to check, so endless galleries cannot balloon the scan. Defaults to 2000. */
	imageLimit?: number;
	/** Max images to report in each of `failed`, `needsReview` and `passed`. Defaults to 10. */
	reportLimit?: number;
	/**
	 * Max reported failed and needs-review images to screenshot, failed first (each is a real
	 * page.screenshot() call). Defaults to 10.
	 */
	screenshotLimit?: number;
};

type Classified = { index: number; image: CollectedImage; match: AltTextMatch | null };

function sourcesOf(image: CollectedImage, baseUrl: string): string[] {
	const fromSrcsets = image.srcsets.flatMap(parseSrcset).flatMap((url) => {
		try {
			return [new URL(url, baseUrl).href];
		} catch {
			return [];
		}
	});

	return [...new Set([...image.urls, ...fromSrcsets])];
}

async function screenshotImage(adaptor: BrowserAdaptor, index: number): Promise<Uint8Array> {
	const handle = await stashedElementHandle(adaptor, STASH_KEY, index);

	try {
		await adaptor.evaluate(awaitImageScript, handle, IMAGE_LOAD_TIMEOUT_MS);

		return await captureElementScreenshot(adaptor, handle, {
			clipBuffer: SCREENSHOT_CLIP_BUFFER,
			settleDelay: SCREENSHOT_SETTLE_MS,
		});
	} finally {
		await adaptor.disposeRef(handle);
	}
}

async function toImages(
	adaptor: BrowserAdaptor,
	classified: readonly Classified[],
	screenshotCount = 0,
): Promise<FilenameAltTextImage[]> {
	const selectors = await stashedElementSelectors(
		adaptor,
		STASH_KEY,
		classified.map(({ index }) => index),
	);
	const images: FilenameAltTextImage[] = [];

	for (const [i, { index, image, match }] of classified.entries()) {
		images.push({
			selector: selectors[i]!,
			html: truncateHtml(image.html),
			altText: image.altText,
			signal: match?.signal ?? null,
			matchedSource: match?.source ?? null,
			...(i < screenshotCount ? { screenshot: await screenshotImage(adaptor, index) } : {}),
		});
	}

	return images;
}

/**
 * Check the alt text of every rendered image on the page for filenames and placeholder text.
 */
export async function runFilenameAltTextAudit(
	adaptor: BrowserAdaptor,
	options: FilenameAltTextOptions = {},
): Promise<FilenameAltTextResult> {
	const imageLimit = options.imageLimit ?? DEFAULT_IMAGE_LIMIT;
	const reportLimit = options.reportLimit ?? DEFAULT_REPORT_LIMIT;
	const screenshotLimit = options.screenshotLimit ?? DEFAULT_SCREENSHOT_LIMIT;

	const collection = await adaptor.evaluate(
		collectImagesScript,
		STASH_KEY,
		imageLimit,
		ALT_TEXT_LIMIT,
	);

	// Screenshots scroll images into view; put the page back where it was for whatever runs next.
	const scroll = await adaptor.evaluate(scrollPositionScript);

	try {
		const placeholders = placeholderWordsFor(collection.lang);
		const classified: Classified[] = collection.images.map((image, index) => ({
			index,
			image,
			match: image.truncated
				? null
				: classifyAltText(image.altText, sourcesOf(image, collection.baseUrl), placeholders),
		}));

		const failed = classified.filter(({ match }) => match?.signal === "filename-match");
		const needsReview = classified.filter(
			({ match }) => match !== null && match.signal !== "filename-match",
		);
		const passed = classified.filter(({ match }) => match === null);

		const reportedFailed = failed.slice(0, reportLimit);
		const failedScreenshots = Math.min(reportedFailed.length, screenshotLimit);

		return {
			failed: await toImages(adaptor, reportedFailed, failedScreenshots),
			needsReview: await toImages(
				adaptor,
				needsReview.slice(0, reportLimit),
				screenshotLimit - failedScreenshots,
			),
			passed: await toImages(adaptor, passed.slice(0, reportLimit)),
			summary: {
				checked: classified.length,
				failed: failed.length,
				needsReview: needsReview.length,
				passed: passed.length,
				unchecked: collection.total - classified.length,
			},
		};
	} finally {
		await releaseStashedElements(adaptor, STASH_KEY);
		await adaptor.evaluate(restoreScrollScript, scroll);
	}
}
