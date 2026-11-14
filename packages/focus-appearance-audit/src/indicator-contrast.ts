import { contrastRatio, parseOpaqueRgb, type Rgb } from "@a11y-pulse/browser-adaptor";
import type { StyleSnapshot } from "@a11y-pulse/tab-orchestrator";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { ClipAnchor } from "./detection";
import type { IndicatorContrast } from "./result";

// WCAG 1.4.11 Non-text Contrast: the visual information needed to identify a state (focus included)
// has a contrast ratio of at least 3:1 against adjacent colours.
export const MIN_INDICATOR_CONTRAST = 3;

type Reason = NonNullable<IndicatorContrast["reason"]>;
type Property = NonNullable<IndicatorContrast["property"]>;
type ComparedAgainst = NonNullable<IndicatorContrast["comparedAgainst"]>;

/** One colour the indicator is drawn next to, or why that colour is not known. */
type Adjacent = { against: ComparedAgainst } & ({ color: string } | { reason: Reason });

type Candidate = {
	property: Property;
	indicatorColor: string;
	/** The colours it is seen against. It only has to stand out from one of them to be seen. */
	adjacent: Adjacent[];
	/** How the same part looked without focus, when it was already drawn. */
	unfocusedColor?: string;
};

function isTransparent(color: string | undefined): boolean {
	if (color === undefined || color === "") {
		return true;
	}

	const value = color.replace(/\s+/g, "").toLowerCase();

	return value === "transparent" || /^rgba\(.*,0\)$/.test(value) || /\/0\)$/.test(value);
}

type Decoration = { style: string; width: string; color: string };

/** A border edge or outline as painted, or null when it draws nothing. */
function decoration(styles: Record<string, string>, prefix: string): Decoration | null {
	const style = styles[`${prefix}-style`];
	const width = styles[`${prefix}-width`];
	const color = styles[`${prefix}-color`];

	if (
		style === undefined ||
		width === undefined ||
		color === undefined ||
		style === "none" ||
		style === "hidden" ||
		Number.parseFloat(width) === 0 ||
		isTransparent(color)
	) {
		return null;
	}

	return { style, width, color };
}

function hasImage(styles: Record<string, string>): boolean {
	const image = styles["background-image"];

	return image !== undefined && image !== "" && image !== "none";
}

type Known = { color: string } | { reason: Reason };

function surroundings(backdrop: string | null | undefined): Known {
	return backdrop ? { color: backdrop } : { reason: "background-unresolved" };
}

/** The colour that fills the element's own box, falling back to what is behind it. */
function fill(styles: Record<string, string>, backdrop: string | null | undefined): Known {
	if (hasImage(styles)) {
		return { reason: "background-image" };
	}

	const color = styles["background-color"];

	if (!isTransparent(color)) {
		return parseOpaqueRgb(color!) ? { color: color! } : { reason: "translucent" };
	}

	return surroundings(backdrop);
}

type Shadow = { color: string; inset: boolean; soft: boolean; text: string };

/** Split a computed `box-shadow` into its shadows. Commas inside colour functions do not separate. */
function parseShadows(value: string | undefined): Shadow[] {
	if (value === undefined || value === "" || value === "none") {
		return [];
	}

	const parts: string[] = [];
	let depth = 0;
	let current = "";

	for (const char of value) {
		if (char === "(") depth++;
		if (char === ")") depth--;

		if (char === "," && depth === 0) {
			parts.push(current.trim());
			current = "";
		} else {
			current += char;
		}
	}

	parts.push(current.trim());

	return parts
		.filter((part) => part !== "")
		.map((text) => {
			const color = /[a-z-]+\([^)]*\)/i.exec(text)?.[0] ?? "";
			const lengths = (text.replace(color, "").match(/-?[\d.]+px/g) ?? []).map(Number.parseFloat);
			const blur = lengths[2] ?? 0;
			const spread = lengths[3] ?? 0;

			return { color, inset: /\binset\b/.test(text), soft: blur > 0 && spread <= 0, text };
		});
}

const MEASURED_PROPERTY =
	/^(outline-|border-(top|right|bottom|left)-|box-shadow$|background-color$)/;

/**
 * The parts of a focus indicator whose colours can be read from styles, each with the colours it is
 * drawn next to. WCAG 1.4.11 asks an indicator to contrast with its adjacent colours, not with how
 * the element looked before focus, so a part that was already drawn and only changed colour is
 * judged where it sits like any other.
 */
function collectCandidates(
	baseline: Record<string, string>,
	focused: Record<string, string>,
	backdrop: string | null | undefined,
): Candidate[] {
	const candidates: Candidate[] = [];
	const outside: Adjacent = { against: "surroundings", ...surroundings(backdrop) };
	const inside: Adjacent = { against: "own-background", ...fill(focused, backdrop) };

	const addDecoration = (property: "outline" | "border", prefix: string): void => {
		const after = decoration(focused, prefix);

		if (!after) {
			return;
		}

		const before = decoration(baseline, prefix);
		const sameShape =
			before !== null && before.style === after.style && before.width === after.width;
		const offset = property === "outline" ? Number.parseFloat(focused["outline-offset"] ?? "0") : 0;
		const offsetBefore =
			property === "outline" ? Number.parseFloat(baseline["outline-offset"] ?? "0") : 0;

		if (sameShape && before.color === after.color && offset === offsetBefore) {
			// Drawn the same with and without focus: not part of the indicator.
			return;
		}

		let adjacent: Adjacent[];

		if (property === "border") {
			// A border lies between the element's own fill and what is around the element.
			adjacent = [outside, inside];
		} else {
			const width = Number.parseFloat(after.width);
			const safeOffset = Number.isNaN(offset) ? 0 : offset;

			if (safeOffset + width <= 0) {
				// Pulled wholly inside the element's box by a negative offset.
				adjacent = [inside];
			} else if (safeOffset >= 0) {
				adjacent = [outside];
			} else {
				adjacent = [outside, inside];
			}
		}

		candidates.push({
			property,
			indicatorColor: after.color,
			adjacent,
			...(sameShape && before.color !== after.color ? { unfocusedColor: before.color } : {}),
		});
	};

	// The default focus ring (`outline-style: auto`) is drawn by the browser, in two tones, and is
	// outside what 1.4.11 asks of authors.
	if (focused["outline-style"] !== "auto") {
		addDecoration("outline", "outline");
	}

	for (const side of ["top", "right", "bottom", "left"]) {
		addDecoration("border", `border-${side}`);
	}

	const before = new Set(parseShadows(baseline["box-shadow"]).map((shadow) => shadow.text));

	for (const shadow of parseShadows(focused["box-shadow"])) {
		if (before.has(shadow.text) || isTransparent(shadow.color)) {
			continue;
		}

		candidates.push({
			property: "box-shadow",
			indicatorColor: shadow.color,
			adjacent: [
				shadow.soft
					? { against: shadow.inset ? "own-background" : "surroundings", reason: "translucent" }
					: shadow.inset
						? inside
						: outside,
			],
		});
	}

	if (
		baseline["background-color"] !== undefined &&
		focused["background-color"] !== undefined &&
		baseline["background-color"] !== focused["background-color"] &&
		(hasImage(focused) || !isTransparent(focused["background-color"]))
	) {
		// A fill that appears or changes is seen against what is around the element.
		const after = fill(focused, backdrop);
		const was = fill(baseline, backdrop);

		candidates.push({
			property: "background-color",
			indicatorColor: "color" in after ? after.color : focused["background-color"],
			adjacent: ["color" in after ? outside : { against: "surroundings", ...after }],
			...("color" in was ? { unfocusedColor: was.color } : {}),
		});
	}

	return candidates;
}

function measure(candidate: Candidate): IndicatorContrast {
	const base = {
		method: "style" as const,
		property: candidate.property,
		indicatorColor: candidate.indicatorColor,
	};

	const indicator = parseOpaqueRgb(candidate.indicatorColor);
	const first = candidate.adjacent[0]!;

	if (!indicator) {
		return { ...base, comparedAgainst: first.against, ratio: null, reason: "translucent" };
	}

	const unfocused = candidate.unfocusedColor ? parseOpaqueRgb(candidate.unfocusedColor) : null;
	const stateChange = unfocused ? { stateChangeRatio: contrastRatio(indicator, unfocused) } : {};

	let best: { ratio: number; color: string; against: ComparedAgainst } | null = null;
	let unknown: { against: ComparedAgainst; reason: Reason; color?: string } | null = null;

	for (const adjacent of candidate.adjacent) {
		if ("reason" in adjacent) {
			unknown ??= { against: adjacent.against, reason: adjacent.reason };
			continue;
		}

		const rgb = parseOpaqueRgb(adjacent.color);

		if (!rgb) {
			unknown ??= { against: adjacent.against, reason: "translucent", color: adjacent.color };
			continue;
		}

		const ratio = contrastRatio(indicator, rgb);

		if (best === null || ratio > best.ratio) {
			best = { ratio, color: adjacent.color, against: adjacent.against };
		}
	}

	// Standing out from one neighbour is enough; when it does not, a neighbour that could not be
	// read might still be the one it stands out from.
	if (best !== null && (best.ratio >= MIN_INDICATOR_CONTRAST || unknown === null)) {
		return {
			...base,
			...stateChange,
			ratio: best.ratio,
			adjacentColor: best.color,
			comparedAgainst: best.against,
		};
	}

	return {
		...base,
		...stateChange,
		ratio: null,
		comparedAgainst: unknown!.against,
		...(unknown!.color ? { adjacentColor: unknown!.color } : {}),
		reason: unknown!.reason,
	};
}

/**
 * The contrast of a focus indicator found by comparing computed styles: an outline, border,
 * box-shadow or background fill against the colours next to it. That is what surrounds the element
 * for anything drawn outside its box, the element's own fill for an inset shadow or an outline
 * pulled inside by a negative `outline-offset`, and either of the two for a border, which lies
 * between them. Text colour is not an indicator part and is never measured here.
 *
 * Returns undefined when there is nothing of that kind to measure, or when a weak one is not the
 * whole indicator (something else, such as an underline, changes too). When several parts change,
 * the strongest counts; if a part that cannot be measured might be stronger, the ratio is null.
 */
export function styleIndicatorContrast(
	baseline: StyleSnapshot,
	focused: StyleSnapshot,
	changedProperties: readonly string[],
	backdrop: string | null | undefined,
): IndicatorContrast | undefined {
	const measured = collectCandidates(baseline.element, focused.element, backdrop).map(measure);

	if (measured.length === 0) {
		return undefined;
	}

	const known = measured
		.filter((entry) => entry.ratio !== null)
		.sort((a, b) => b.ratio! - a.ratio!);
	const best = known[0];

	if (best && best.ratio! >= MIN_INDICATOR_CONTRAST) {
		return best;
	}

	// Another painted change (an underline, bolder text, a pseudo-element) may carry the indicator,
	// and so does the browser's own focus ring, which is not measured.
	if (
		changedProperties.some((property) => !MEASURED_PROPERTY.test(property)) ||
		hasDefaultRing(focused.element)
	) {
		return undefined;
	}

	return measured.find((entry) => entry.ratio === null) ?? best;
}

/** Whether the browser's own focus ring (`outline-style: auto`) is drawn. */
export function hasDefaultRing(styles: Record<string, string>): boolean {
	return styles["outline-style"] === "auto" && decoration(styles, "outline") !== null;
}

// Colours are grouped into buckets this many levels wide per channel to find the dominant one.
const BUCKET = 24;
// The dominant colour has to account for this share of the pixels for it to stand for them all.
const DOMINANT_SHARE = 0.5;
// Fewer changed pixels than this (per device pixel squared) is too little to take a colour from.
const MIN_CHANGED_PIXELS = 12;

// Colour tolerance that still registers a change too faint for the indicator detection to count.
export const FAINT_CHANGE_THRESHOLD = 0.02;

type Tally = { count: number; r: number; g: number; b: number };

function dominant(pixels: readonly Rgb[]): { color: Rgb; share: number } | null {
	const buckets = new Map<number, Tally>();

	for (const [r, g, b] of pixels) {
		const key =
			(Math.floor(r / BUCKET) << 16) | (Math.floor(g / BUCKET) << 8) | Math.floor(b / BUCKET);
		const tally = buckets.get(key) ?? { count: 0, r: 0, g: 0, b: 0 };
		tally.count++;
		tally.r += r;
		tally.g += g;
		tally.b += b;
		buckets.set(key, tally);
	}

	let top: Tally | null = null;

	for (const tally of buckets.values()) {
		if (top === null || tally.count > top.count) {
			top = tally;
		}
	}

	if (top === null) {
		return null;
	}

	// Neighbouring buckets hold the same colour when it sits on a bucket edge.
	const mean: Rgb = [top.r / top.count, top.g / top.count, top.b / top.count];
	const near = pixels.filter(
		([r, g, b]) =>
			Math.abs(r - mean[0]) <= BUCKET &&
			Math.abs(g - mean[1]) <= BUCKET &&
			Math.abs(b - mean[2]) <= BUCKET,
	);
	const sum = near.reduce<[number, number, number]>(
		(acc, [r, g, b]) => [acc[0] + r, acc[1] + g, acc[2] + b],
		[0, 0, 0],
	);

	return {
		color: [
			Math.round(sum[0] / near.length),
			Math.round(sum[1] / near.length),
			Math.round(sum[2] / near.length),
		],
		share: near.length / pixels.length,
	};
}

function toCss([r, g, b]: Rgb): string {
	return `rgb(${r}, ${g}, ${b})`;
}

function crop(png: PNG, start: { x: number; y: number }, width: number, height: number): PNG {
	const out = new PNG({ width, height });
	PNG.bitblt(png, out, start.x, start.y, width, height, 0, 0);

	return out;
}

// How far from a changed pixel (in CSS pixels) an unchanged one still counts as next to it. Wide
// enough to step over the anti-aliased fringe of the indicator.
const ADJACENT_REACH = 2;
// The colour the changed pixels had before has to make up this share of their unchanged neighbours
// for the indicator to count as drawn on top of it.
const SURROUNDING_SHARE = 0.15;

function near(a: Rgb, b: Rgb): boolean {
	return (
		Math.abs(a[0] - b[0]) <= BUCKET &&
		Math.abs(a[1] - b[1]) <= BUCKET &&
		Math.abs(a[2] - b[2]) <= BUCKET
	);
}

/**
 * The contrast of a focus indicator found by comparing screenshots: the colour most of the changed
 * pixels took on focus, against the colour next to them in the focused screenshot. When the
 * indicator was drawn on top of a colour that still surrounds it (an outline or a highlight
 * appearing on the page background), that colour is the one it is seen against; when something
 * already there was recoloured, it is the unchanged pixels around it. The contrast with how the
 * same pixels looked before focus is given as `stateChangeRatio`, which 1.4.11 does not ask for.
 *
 * The ratio is null when too few pixels changed, or when the indicator or what is next to it has no
 * single dominant colour (a gradient, an image, a soft glow). `threshold` is pixelmatch's colour
 * tolerance: lower it to pick up a change too faint to have counted as a difference.
 */
export function pixelIndicatorContrast(
	focusedPng: Uint8Array,
	focusedAnchor: ClipAnchor,
	unfocusedPng: Uint8Array,
	unfocusedAnchor: ClipAnchor,
	scale: number,
	threshold = 0.1,
): IndicatorContrast {
	const focused = PNG.sync.read(Buffer.from(focusedPng));
	const unfocused = PNG.sync.read(Buffer.from(unfocusedPng));
	const undetermined = (reason: Reason): IndicatorContrast => ({
		method: "pixels",
		comparedAgainst: "adjacent-pixels",
		ratio: null,
		reason,
	});

	const originX = Math.min(focusedAnchor.x, unfocusedAnchor.x);
	const originY = Math.min(focusedAnchor.y, unfocusedAnchor.y);
	const startF = {
		x: Math.round(focusedAnchor.x - originX),
		y: Math.round(focusedAnchor.y - originY),
	};
	const startU = {
		x: Math.round(unfocusedAnchor.x - originX),
		y: Math.round(unfocusedAnchor.y - originY),
	};
	const width = Math.min(focused.width - startF.x, unfocused.width - startU.x);
	const height = Math.min(focused.height - startF.y, unfocused.height - startU.y);

	if (width <= 0 || height <= 0) {
		return undetermined("too-small");
	}

	const a = crop(focused, startF, width, height);
	const b = crop(unfocused, startU, width, height);
	const mask = new PNG({ width, height });

	pixelmatch(a.data, b.data, mask.data, width, height, {
		threshold,
		checkerboard: false,
		diffMask: true,
	});

	const colorAt = (png: PNG, index: number): Rgb => [
		png.data[index * 4]!,
		png.data[index * 4 + 1]!,
		png.data[index * 4 + 2]!,
	];
	// Anti-aliased pixels are drawn in the mask too, in another colour; only true differences are red.
	const isChanged = (index: number): boolean =>
		mask.data[index * 4 + 3] !== 0 &&
		mask.data[index * 4] === 255 &&
		mask.data[index * 4 + 1] === 0;
	const isUntouched = (index: number): boolean => mask.data[index * 4 + 3] === 0;

	const changed: number[] = [];

	for (let i = 0; i < width * height; i++) {
		if (isChanged(i)) {
			changed.push(i);
		}
	}

	if (changed.length < MIN_CHANGED_PIXELS * scale * scale) {
		return undetermined("too-small");
	}

	const indicator = dominant(changed.map((index) => colorAt(a, index)));

	if (!indicator || indicator.share < DOMINANT_SHARE) {
		return undetermined("noisy");
	}

	// Only the pixels that took the indicator's colour: other things may have changed too (text
	// turning white on a highlight).
	const ofIndicator = changed.filter((index) => near(colorAt(a, index), indicator.color));
	const previous = dominant(ofIndicator.map((index) => colorAt(b, index)));

	// The unchanged pixels within reach of the indicator, in the focused screenshot.
	const reach = Math.max(1, Math.round(ADJACENT_REACH * scale));
	const seen = new Uint8Array(width * height);
	const neighbours: Rgb[] = [];

	for (const index of ofIndicator) {
		const x = index % width;
		const y = (index - x) / width;

		for (let dy = -reach; dy <= reach; dy++) {
			const ny = y + dy;

			if (ny < 0 || ny >= height) {
				continue;
			}

			for (let dx = -reach; dx <= reach; dx++) {
				const nx = x + dx;

				if (nx < 0 || nx >= width) {
					continue;
				}

				const at = ny * width + nx;

				if (seen[at] === 0 && isUntouched(at)) {
					seen[at] = 1;
					neighbours.push(colorAt(a, at));
				}
			}
		}
	}

	const stateChange =
		previous && previous.share >= DOMINANT_SHARE
			? { stateChangeRatio: contrastRatio(indicator.color, previous.color) }
			: {};

	let adjacent: Rgb | null = null;

	if (neighbours.length > 0) {
		if (
			previous &&
			previous.share >= DOMINANT_SHARE &&
			neighbours.filter((color) => near(color, previous.color)).length / neighbours.length >=
				SURROUNDING_SHARE
		) {
			// Drawn on top of a colour that is still next to it: that is what it is seen against.
			adjacent = previous.color;
		} else {
			const around = dominant(neighbours);

			if (around && around.share >= DOMINANT_SHARE) {
				adjacent = around.color;
			}
		}
	}

	if (
		adjacent === null &&
		neighbours.length === 0 &&
		previous &&
		previous.share >= DOMINANT_SHARE
	) {
		// The indicator fills everything the screenshots show. A fill that appeared over one flat
		// colour is taken to have that colour around it still, beyond the edge of the screenshots.
		adjacent = previous.color;
	}

	if (adjacent === null) {
		return { ...undetermined("noisy"), ...stateChange };
	}

	return {
		method: "pixels",
		comparedAgainst: "adjacent-pixels",
		ratio: contrastRatio(indicator.color, adjacent),
		indicatorColor: toCss(indicator.color),
		adjacentColor: toCss(adjacent),
		...stateChange,
	};
}
