import type { Rect } from "@a11y-pulse/browser-adaptor";

// Focus can climb this many viewports' worth of the block axis before a move counts as backwards.
// Smaller upward moves are ordinary layout (multi-column forms, nav bars).
const BACKWARDS_VIEWPORTS = 1;

// A move across more than this fraction of the layout's inline size changes column.
const COLUMN_SPAN = 0.6;

// Upward movement smaller than this fraction of the viewport is the difference in height between
// neighbours on one line, not a climb.
const CLIMB_TOLERANCE = 0.1;

// Alternating column changes in a row before they count as thrash rather than one column change.
const THRASH_MOVES = 3;

// Backwards jumps needed before a page is reported (or one jump alongside column thrash), so one
// odd transition never is.
const STRIKES = 3;

export type SequenceStop = {
	tabIndex: number;
	selector: string;
	html: string;
	/** Page-relative rect when the element was focused. */
	rect: Rect;
	/** On a fixed or sticky ancestor, or inside a dialog, so its position says nothing about order. */
	excluded: boolean;
};

export type PageGeometry = {
	viewportWidth: number;
	viewportHeight: number;
	layoutWidth: number;
	layoutHeight: number;
	direction: "ltr" | "rtl";
	writingMode: "horizontal-tb" | "vertical-rl" | "vertical-lr";
};

export type TransitionKind = "backwards-jump" | "column-thrash";

export type Transition = {
	kind: TransitionKind;
	from: SequenceStop;
	to: SequenceStop;
};

type Point = { block: number; inline: number };

/**
 * Position in reading-order coordinates: `block` grows towards the end of the page and `inline`
 * towards the end of a line, whatever the document's writing mode and direction.
 */
function toReadingOrder(rect: Rect, page: PageGeometry): Point {
	if (page.writingMode === "horizontal-tb") {
		return {
			block: rect.y,
			inline: page.direction === "rtl" ? page.layoutWidth - (rect.x + rect.width) : rect.x,
		};
	}

	const inline = page.direction === "rtl" ? page.layoutHeight - (rect.y + rect.height) : rect.y;
	const block =
		page.writingMode === "vertical-rl" ? page.layoutWidth - (rect.x + rect.width) : rect.x;

	return { block, inline };
}

/**
 * The transitions in a tab sequence that move gross distances against the reading order, or none
 * when there are too few to suggest the order is broken rather than merely unusual.
 */
export function findDisorder(sequence: readonly SequenceStop[], page: PageGeometry): Transition[] {
	const vertical = page.writingMode !== "horizontal-tb";
	const blockViewport = vertical ? page.viewportWidth : page.viewportHeight;
	// The viewport, not the layout: content scrolled or hidden off the side of the page (an off-canvas
	// drawer) widens the layout without widening what a user reads across.
	const inlineSize = vertical ? page.viewportHeight : page.viewportWidth;

	const stops = sequence.filter(
		(stop) => !stop.excluded && stop.rect.width > 0 && stop.rect.height > 0,
	);
	const points = stops.map((stop) => toReadingOrder(stop.rect, page));

	const jumps: Transition[] = [];
	const thrash: Transition[] = [];
	let run: Transition[] = [];
	let runClimbs = false;
	let lastSign = 0;

	const closeRun = (): void => {
		// Rows of a grid line up, so reading one row by row never climbs. Only columns of uneven
		// heights read across each other do.
		if (run.length >= THRASH_MOVES && runClimbs) {
			thrash.push(...run);
		}

		run = [];
		runClimbs = false;
	};

	for (let i = 1; i < stops.length; i++) {
		const from = points[i - 1]!;
		const to = points[i]!;
		const transition = { from: stops[i - 1]!, to: stops[i]! };
		const blockDelta = to.block - from.block;
		const inlineDelta = to.inline - from.inline;
		const climbsAtAll = blockDelta < -CLIMB_TOLERANCE * blockViewport;

		const climbs = blockDelta < -BACKWARDS_VIEWPORTS * blockViewport;
		const crossesBack = inlineDelta < -COLUMN_SPAN * inlineSize && climbsAtAll;

		if (climbs || crossesBack) {
			jumps.push({ kind: "backwards-jump", ...transition });
			closeRun();
			lastSign = 0;

			continue;
		}

		const sign = Math.abs(inlineDelta) > COLUMN_SPAN * inlineSize ? Math.sign(inlineDelta) : 0;

		if (sign === 0 || sign !== -lastSign) {
			closeRun();
		}

		if (sign !== 0) {
			run.push({ kind: "column-thrash", ...transition });
			runClimbs ||= climbsAtAll;
		}

		lastSign = sign;
	}

	closeRun();

	const disordered = jumps.length >= STRIKES || (thrash.length > 0 && jumps.length > 0);

	if (!disordered) {
		return [];
	}

	return [...jumps, ...thrash].sort((a, b) => a.from.tabIndex - b.from.tabIndex);
}
