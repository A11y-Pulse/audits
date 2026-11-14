import {
	type BrowserAdaptor,
	captureElementScreenshot,
	releaseStashedElements,
	stashedElementHandle,
	stashedElementSelectors,
} from "@a11y-pulse/browser-adaptor";
import { truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import {
	type CollectedRegion,
	type CollectOptions,
	collectRegionsScript,
	restoreScrollScript,
	scrollPositionScript,
	startObservationScript,
	stopObservationScript,
} from "./browser-scripts";
import { type Classification, classifyRegion, QUIET_GAP_FRACTION, type Verdict } from "./classify";
import type { MovingContentRegion, MovingContentResult } from "./result";

/** WCAG 2.2.2 allows movement that stops within five seconds. */
export const DURATION_LIMIT_MS = 5000;

export const DEFAULT_OBSERVATION_WINDOW = DURATION_LIMIT_MS;
export const DEFAULT_MIN_REGION_AREA = 5000;
export const DEFAULT_LARGE_REGION_AREA = 20_000;
export const DEFAULT_REGION_LIMIT = 20;
export const DEFAULT_SCREENSHOT_LIMIT = 5;
export const DEFAULT_SCREENSHOT_INTERVAL = 1000;

/**
 * Labels of a control that pauses, stops or hides moving content. "Play" only counts as the whole
 * label, paired with "pause", or followed by what is moving ("Play slideshow"): "Play trailer"
 * starts something else.
 */
export const DEFAULT_CONTROL_NAME_PATTERN =
	"(^|[^\\p{L}])(pause|paused|unpause|stop|halt|freeze|hide|close|dismiss|pausar|pausa|detener|parar|pausieren|anhalten|stopp|stoppen|arrêter|pauzeren|fermare|pausera|stoppa|play\\s*(/|\\||&|and|or)\\s*pause|play(ing)?\\s+(the\\s+)?(slideshow|slide\\s?show|slides|carousel|animations?|rotation|ticker|marquee|background\\s+video))($|[^\\p{L}])|^\\s*(play|playing)\\s*$";

const CONTROL_ATTRIBUTE_PATTERN = "(^|[-_\\s])(pause|playpause|play-pause|stop)($|[-_\\s])";

// A verb, then at most two words, then what it acts on: "Turn off animations", "Pause all motion".
// The words are separate, so a link to a "Stop-motion season" is not a switch.
const PAGE_CONTROL_PATTERN =
	"\\b(pause|stop|turn off|disable|reduce)\\s+(\\S+\\s+){0,2}(animations?|motion|movement|moving|autoplay)\\b";

const ESSENTIAL_PATTERN =
	"(^|[-_\\s])(spinner|loader|loading|skeleton|shimmer|progress)($|[-_\\s])";

const STATE_KEY = "__a11yPulseMovingContentState";
const STASH_KEY = "__a11yPulseMovingContent";

const SCREENSHOT_CLIP_BUFFER = 10;
const SCREENSHOT_SETTLE_MS = 33; // ~2 frames at 60fps

// How many times the page is sampled over the window, and the fastest and slowest it is sampled.
const POLLS_PER_WINDOW = 50;
const MIN_POLL_MS = 20;
const MAX_POLL_MS = 250;

// Elements a script touches during the window are watched for movement, up to this many at a
// time. Ones that have settled make room for new ones.
const TRACK_LIMIT = 150;

// A pause between changes has to outlast this many samples to count as one.
const QUIET_GAP_POLLS = 3;

export type MovingContentOptions = {
	/**
	 * How long to watch the page for, in ms. Content still moving at the end is reported. Defaults
	 * to 5000, the limit in WCAG 2.2.2; the audit takes at least this long.
	 */
	observationWindow?: number;
	/** Smallest visible area, in CSS px², of a moving region worth reporting. Defaults to 5000. */
	minRegionArea?: number;
	/**
	 * Smallest visible area, in CSS px², of a region that can fail. Smaller regions are reported
	 * for review. Defaults to 20000.
	 */
	largeRegionArea?: number;
	/** Max moving regions to examine, largest first. Defaults to 20. */
	regionLimit?: number;
	/**
	 * Regular expression source, matched case-insensitively against the label of controls near a
	 * moving region to find one that pauses, stops or hides it.
	 */
	controlNamePattern?: string;
	/**
	 * Max failed and needs-review regions to screenshot, failed first. Each gets two captures,
	 * `screenshotInterval` apart. Defaults to 5; 0 takes none.
	 */
	screenshotLimit?: number;
	/** Time between a region's two screenshots, in ms. Defaults to 1000. */
	screenshotInterval?: number;
};

/** How often, in ms, the page is sampled over an observation window of `observationWindow` ms. */
export function pollInterval(observationWindow: number): number {
	return Math.min(
		MAX_POLL_MS,
		Math.max(MIN_POLL_MS, Math.round(observationWindow / POLLS_PER_WINDOW)),
	);
}

/**
 * How long, in ms, an element has to hold still for its next change to count as a separate burst
 * of movement.
 */
export function quietGap(observationWindow: number): number {
	return Math.max(
		Math.round(observationWindow * QUIET_GAP_FRACTION),
		pollInterval(observationWindow) * QUIET_GAP_POLLS,
	);
}

type Classified = { region: CollectedRegion; classification: Classification };

function sleep(ms: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

async function screenshotRegion(adaptor: BrowserAdaptor, index: number): Promise<Uint8Array> {
	const handle = await stashedElementHandle(adaptor, STASH_KEY, index);

	try {
		return await captureElementScreenshot(adaptor, handle, {
			clipBuffer: SCREENSHOT_CLIP_BUFFER,
			settleDelay: SCREENSHOT_SETTLE_MS,
		});
	} finally {
		await adaptor.disposeRef(handle);
	}
}

async function toRegions(
	adaptor: BrowserAdaptor,
	classified: readonly Classified[],
): Promise<MovingContentRegion[]> {
	const selectors = await stashedElementSelectors(
		adaptor,
		STASH_KEY,
		classified.map(({ region }) => region.elementIndex),
	);
	const controls = classified.flatMap(({ region }) => (region.control ? [region.control] : []));
	const controlSelectors = await stashedElementSelectors(
		adaptor,
		STASH_KEY,
		controls.map((control) => control.elementIndex),
	);

	return classified.map(({ region, classification }, i) => {
		const control = region.control;

		return {
			selector: selectors[i]!,
			html: truncateHtml(region.html),
			rect: region.rect,
			motion: classification.motion,
			detectedBy: classification.detectedBy,
			finding: classification.finding,
			observedMs: classification.observedMs,
			animations: region.animations.map(
				({ name, infinite, activeDurationMs, properties, pseudoElement }) => ({
					name,
					infinite,
					activeDurationMs,
					properties,
					pseudoElement,
				}),
			),
			pauseControl: control
				? {
						selector: controlSelectors[controls.indexOf(control)]!,
						html: truncateHtml(control.html),
						name: control.name,
						foundBy: control.foundBy,
					}
				: null,
			pausesOn: region.pausesOn,
			reducedMotion: region.reducedMotion,
		};
	});
}

/**
 * Watch the page for content that keeps moving on its own and look for a way to pause it. Nothing
 * is pressed or hovered, and the page is left as it was found. Takes `observationWindow` ms, 5
 * seconds by default, plus the time for screenshots.
 */
export async function runMovingContentAudit(
	adaptor: BrowserAdaptor,
	options: MovingContentOptions = {},
): Promise<MovingContentResult> {
	const observationWindow = options.observationWindow ?? DEFAULT_OBSERVATION_WINDOW;
	const screenshotLimit = options.screenshotLimit ?? DEFAULT_SCREENSHOT_LIMIT;
	const screenshotInterval = options.screenshotInterval ?? DEFAULT_SCREENSHOT_INTERVAL;
	const pollMs = pollInterval(observationWindow);
	const quietGapMs = quietGap(observationWindow);
	const collectOptions: CollectOptions = {
		durationLimitMs: DURATION_LIMIT_MS,
		minRegionArea: options.minRegionArea ?? DEFAULT_MIN_REGION_AREA,
		regionLimit: options.regionLimit ?? DEFAULT_REGION_LIMIT,
		controlNamePattern: options.controlNamePattern ?? DEFAULT_CONTROL_NAME_PATTERN,
		controlAttributePattern: CONTROL_ATTRIBUTE_PATTERN,
		pageControlPattern: PAGE_CONTROL_PATTERN,
		essentialPattern: ESSENTIAL_PATTERN,
	};

	await adaptor.evaluate(
		startObservationScript,
		STATE_KEY,
		pollMs,
		DURATION_LIMIT_MS,
		TRACK_LIMIT,
		quietGapMs,
	);

	try {
		await sleep(observationWindow);

		const collection = await adaptor.evaluate(
			collectRegionsScript,
			STATE_KEY,
			STASH_KEY,
			collectOptions,
		);

		const classified = collection.regions.flatMap((region): Classified[] => {
			const classification = classifyRegion(region, {
				observedMs: collection.elapsedMs,
				durationLimitMs: DURATION_LIMIT_MS,
				largeRegionArea: options.largeRegionArea ?? DEFAULT_LARGE_REGION_AREA,
			});

			return classification ? [{ region, classification }] : [];
		});
		const withVerdict = (verdict: Verdict): Classified[] =>
			classified.filter(({ classification }) => classification.verdict === verdict);

		const failed = await toRegions(adaptor, withVerdict("failed"));
		const needsReview = await toRegions(adaptor, withVerdict("needsReview"));
		const passed = await toRegions(adaptor, withVerdict("passed"));

		const toScreenshot = [...withVerdict("failed"), ...withVerdict("needsReview")].slice(
			0,
			screenshotLimit,
		);

		if (toScreenshot.length > 0) {
			const reported = [...failed, ...needsReview];
			// Screenshots scroll regions into view; put the page back where it was afterwards.
			const scroll = await adaptor.evaluate(scrollPositionScript);

			try {
				for (const [i, { region }] of toScreenshot.entries()) {
					reported[i]!.screenshot = await screenshotRegion(adaptor, region.elementIndex);
				}

				await sleep(screenshotInterval);

				for (const [i, { region }] of toScreenshot.entries()) {
					reported[i]!.laterScreenshot = await screenshotRegion(adaptor, region.elementIndex);
				}
			} finally {
				await adaptor.evaluate(restoreScrollScript, scroll);
			}
		}

		return {
			failed,
			needsReview,
			passed,
			observedMs: collection.elapsedMs,
			summary: {
				checked: classified.length,
				failed: failed.length,
				needsReview: needsReview.length,
				passed: passed.length,
				unchecked: collection.total - collection.regions.length,
				ignored: { essential: collection.essential, tooSmall: collection.tooSmall },
			},
		};
	} finally {
		await adaptor.evaluate(stopObservationScript, STATE_KEY);
		await releaseStashedElements(adaptor, STASH_KEY);
	}
}
