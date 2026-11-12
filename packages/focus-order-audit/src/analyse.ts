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

// Consecutive climbing moves, none a jump on its own, before their combined climb counts as drift.
// Two short climbs are a reordered pair; a steady run is an order that reads backwards.
const DRIFT_MOVES = 3;

export type SequenceStop = {
	tabIndex: number;
	selector: string;
	html: string;
	/** Page-relative rect when the element was focused. */
	rect: Rect;
	/** On a fixed or sticky ancestor, or inside a dialog, so its position says nothing about order. */
	excluded: boolean;
	/** The element's own `tabindex` when it is positive. */
	positiveTabindex?: number;
};

export type PageGeometry = {
	viewportWidth: number;
	viewportHeight: number;
	layoutWidth: number;
	layoutHeight: number;
	direction: "ltr" | "rtl";
	writingMode: "horizontal-tb" | "vertical-rl" | "vertical-lr";
};

export type TransitionKind = "backwards-jump" | "backwards-drift" | "column-thrash";

/** Where focus went on screen, by the larger of its horizontal and vertical movement. */
export type TransitionDirection = "up" | "down" | "left" | "right";

export type Transition = {
	kind: TransitionKind;
	from: SequenceStop;
	to: SequenceStop;
	/**
	 * Movement in reading-order pixels: `block` is negative when focus moved back towards the start
	 * of the page, `inline` when it moved back towards the start of a line.
	 */
	distance: { block: number; inline: number };
	direction: TransitionDirection;
	/** Tab presses between `from` and `to`: 1 except for `backwards-drift`, which spans a run. */
	steps: number;
};

type Point = { block: number; inline: number; inlineSize: number; blockSize: number };

/**
 * Position in reading-order coordinates: `block` grows towards the end of the page and `inline`
 * towards the end of a line, whatever the document's writing mode and direction.
 */
function toReadingOrder(rect: Rect, page: PageGeometry): Point {
	if (page.writingMode === "horizontal-tb") {
		return {
			block: rect.y,
			inline: page.direction === "rtl" ? page.layoutWidth - (rect.x + rect.width) : rect.x,
			inlineSize: rect.width,
			blockSize: rect.height,
		};
	}

	const inline = page.direction === "rtl" ? page.layoutHeight - (rect.y + rect.height) : rect.y;
	const block =
		page.writingMode === "vertical-rl" ? page.layoutWidth - (rect.x + rect.width) : rect.x;

	return { block, inline, inlineSize: rect.height, blockSize: rect.width };
}

function physicalDirection(from: Rect, to: Rect): TransitionDirection {
	const dx = to.x + to.width / 2 - (from.x + from.width / 2);
	const dy = to.y + to.height / 2 - (from.y + from.height / 2);

	if (Math.abs(dy) >= Math.abs(dx)) {
		return dy < 0 ? "up" : "down";
	}

	return dx < 0 ? "left" : "right";
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
	const tolerance = CLIMB_TOLERANCE * blockViewport;

	const stops = sequence.filter(
		(stop) => !stop.excluded && stop.rect.width > 0 && stop.rect.height > 0,
	);
	const points = stops.map((stop) => toReadingOrder(stop.rect, page));

	const between = (kind: TransitionKind, fromIndex: number, toIndex: number): Transition => {
		const from = stops[fromIndex]!;
		const to = stops[toIndex]!;

		return {
			kind,
			from,
			to,
			distance: {
				block: Math.round(points[toIndex]!.block - points[fromIndex]!.block),
				inline: Math.round(points[toIndex]!.inline - points[fromIndex]!.inline),
			},
			direction: physicalDirection(from.rect, to.rect),
			steps: toIndex - fromIndex,
		};
	};

	const jumps: Transition[] = [];
	const drifts: Transition[] = [];
	const thrash: Transition[] = [];
	let tabindexJump = false;
	let run: Transition[] = [];
	let runClimbs = false;
	let lastSign = 0;
	// The stop the last backwards jump landed on: nothing before it belongs to the columns being read.
	let lastJump = 0;
	// The run of climbs focus is in: the stop it started at, the highest stop it has reached and how
	// many moves climbed.
	let driftStart = 0;
	let driftHigh = 0;
	let driftClimbs = 0;

	const closeRun = (): void => {
		// Rows of a grid line up, so reading one row by row never climbs. Only columns of uneven
		// heights read across each other do.
		if (run.length >= THRASH_MOVES && runClimbs) {
			thrash.push(...run);
		}

		run = [];
		runClimbs = false;
	};

	/** End the run of climbs, and start looking for the next one from stop `next`. */
	const closeDrift = (next: number): void => {
		if (
			driftClimbs >= DRIFT_MOVES &&
			points[driftHigh]!.block - points[driftStart]!.block < -BACKWARDS_VIEWPORTS * blockViewport
		) {
			drifts.push(between("backwards-drift", driftStart, driftHigh));
		}

		driftStart = next;
		driftHigh = next;
		driftClimbs = 0;
	};

	/**
	 * Where the columns read just before stop `index` began: the highest of the stops leading up to
	 * it that sit wholly before it along the line. Links sit at different points along the lines of
	 * a column, and a card can hold two controls side by side, so the column is everything on the
	 * near side of the target, not only the stops that share an edge. The run ends at a stop that
	 * reaches the target's own stretch of the line: the target then continues a column already begun
	 * (two columns read across each other), and only what came since counts.
	 */
	const columnTopBefore = (index: number): number => {
		const target = points[index]!;
		let top = Number.POSITIVE_INFINITY;

		for (let j = index - 1; j >= lastJump; j--) {
			const point = points[j]!;

			if (point.inline + point.inlineSize > target.inline + 1) {
				break;
			}

			top = Math.min(top, point.block);
		}

		return top;
	};

	for (let i = 1; i < stops.length; i++) {
		const from = points[i - 1]!;
		const to = points[i]!;
		const blockDelta = to.block - from.block;
		const inlineDelta = to.inline - from.inline;
		const climbsAtAll = blockDelta < -tolerance;

		const positiveTabindex =
			stops[i - 1]!.positiveTabindex !== undefined || stops[i]!.positiveTabindex !== undefined;

		// Text set in columns, or a grid filled column by column, climbs to the top of the next column:
		// further along the line, and no higher than the columns read so far began. Level with them,
		// give or take the element's own height (the first link of one column of text can sit a line
		// above the first link of the last), or lower when a heading or logo sits above the first
		// column. A positive tabindex is never the reading order, so a move it causes is never a wrap.
		const columnWrap =
			climbsAtAll &&
			!positiveTabindex &&
			inlineDelta >= from.inlineSize / 2 &&
			to.block >= columnTopBefore(i) - to.blockSize;

		if (columnWrap) {
			closeRun();
			closeDrift(i);
			lastSign = 0;

			continue;
		}

		const climbs = blockDelta < -BACKWARDS_VIEWPORTS * blockViewport;
		const crossesBack = inlineDelta < -COLUMN_SPAN * inlineSize && climbsAtAll;

		if (climbs || crossesBack) {
			jumps.push(between("backwards-jump", i - 1, i));
			tabindexJump ||= positiveTabindex;
			closeRun();
			closeDrift(i);
			lastSign = 0;
			lastJump = i;

			continue;
		}

		if (blockDelta < 0) {
			driftClimbs++;

			if (to.block <= points[driftHigh]!.block) {
				driftHigh = i;
			}
		} else if (to.block > points[driftStart]!.block + (driftClimbs > 0 ? tolerance : 0)) {
			// Dropping below where the run began ends it. Coming part of the way back down does not:
			// cards stacked in reverse climb from one card to the next and step down within each.
			closeDrift(i);
		} else if (to.block <= points[driftHigh]!.block) {
			// A neighbour level with the highest stop so far (the next cell of a reversed row).
			driftHigh = i;
		}

		const sign = Math.abs(inlineDelta) > COLUMN_SPAN * inlineSize ? Math.sign(inlineDelta) : 0;

		if (sign === 0 || sign !== -lastSign) {
			closeRun();
		}

		if (sign !== 0) {
			run.push(between("column-thrash", i - 1, i));
			runClimbs ||= climbsAtAll;
		}

		lastSign = sign;
	}

	closeRun();

	if (stops.length > 0) {
		closeDrift(stops.length - 1);
	}

	// A drift is already several moves, and a jump to or from a positive tabindex has a known cause,
	// so either is reported on its own. Other jumps need company: one odd transition proves nothing.
	const disordered =
		drifts.length > 0 ||
		tabindexJump ||
		jumps.length >= STRIKES ||
		(thrash.length > 0 && jumps.length > 0);

	if (!disordered) {
		return [];
	}

	return [...jumps, ...drifts, ...thrash].sort((a, b) => a.from.tabIndex - b.from.tabIndex);
}
