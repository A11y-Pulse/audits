import { contrastRatio, parseOpaqueRgb, type Rect } from "@a11y-pulse/browser-adaptor";
import type { StyleSnapshot } from "@a11y-pulse/tab-orchestrator";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import type { ColorOnlyChange } from "./result";

export { bufferedClip } from "@a11y-pulse/browser-adaptor";
export type { Rect, StyleSnapshot };

/** Whether a computed colour paints nothing at all. */
function isTransparent(color: string | undefined): boolean {
	if (color === undefined) {
		return false;
	}

	const value = color.replace(/\s+/g, "").toLowerCase();

	return value === "transparent" || /^rgba\(.*,0\)$/.test(value) || /\/0\)$/.test(value);
}

// Every function value in a computed `box-shadow` or `text-decoration` is a colour.
const COLOR_FUNCTION_PATTERN = /[a-z-]+\([^)]*\)/gi;

/** Whether every shadow in a computed `box-shadow` is drawn in a fully transparent colour. */
function isInvisibleShadow(value: string | undefined): boolean {
	if (value === undefined || value === "none" || value === "") {
		return false;
	}

	const colors = value.match(COLOR_FUNCTION_PATTERN) ?? [];

	return colors.length > 0 && colors.every(isTransparent);
}

/**
 * Collapse the parts of a style record that are not actually painted, so that a change to one of
 * them is not mistaken for a visible focus indicator:
 *
 * - the colour/width of a decoration (outline, each border edge) whose style is `none` or `hidden`,
 *   whose width is `0px`, or whose colour is fully transparent (the `outline: 2px solid transparent`
 *   idiom, which only shows in forced-colours mode);
 * - a `box-shadow` whose every shadow is fully transparent;
 * - `opacity`, which is watched to tell whether the element is painted at all and is not itself
 *   compared (a page fading in would otherwise look like a focus change);
 * - `outline-offset`, which is watched to tell whether an outline sits inside or outside the element.
 */
function renderedStyles(record: Record<string, string>): Record<string, string> {
	const out = { ...record };

	const collapse = (style: string, width: string, color: string): void => {
		if (
			out[style] === "none" ||
			out[style] === "hidden" ||
			out[width] === "0px" ||
			isTransparent(out[color])
		) {
			delete out[style];
			delete out[width];
			delete out[color];
		}
	};

	collapse("outline-style", "outline-width", "outline-color");

	for (const side of ["top", "right", "bottom", "left"]) {
		collapse(`border-${side}-style`, `border-${side}-width`, `border-${side}-color`);
	}

	if (isInvisibleShadow(out["box-shadow"])) {
		out["box-shadow"] = "none";
	}

	delete out.opacity;
	// Read to tell where an outline sits when its contrast is measured, and not compared either.
	delete out["outline-offset"];

	return out;
}

function isIdleComputedValue(property: string, value: string): boolean {
	const v = value.trim().toLowerCase();

	if (
		v === "" ||
		v === "none" ||
		v === "hidden" ||
		v === "normal" ||
		v === "transparent" ||
		v === "0px" ||
		v === "0"
	) {
		return true;
	}

	if (v === "rgba(0, 0, 0, 0)" || v === "rgba(0,0,0,0)") {
		return true;
	}

	if (property === "font-weight" && v === "400") {
		return true;
	}

	if (property === "text-decoration" && v.startsWith("none")) {
		return true;
	}

	return false;
}

function omitIdleComputedStyles(
	record: Record<string, string>,
	dropUnusedPseudo: boolean,
): Record<string, string> {
	if (dropUnusedPseudo && isIdleComputedValue("content", record.content ?? "none")) {
		return {};
	}

	const out: Record<string, string> = {};

	for (const [property, value] of Object.entries(renderedStyles(record))) {
		if (!isIdleComputedValue(property, value)) {
			out[property] = value;
		}
	}

	return collapseUniformBorderSides(out);
}

const BORDER_SIDES = ["top", "right", "bottom", "left"] as const;
const BORDER_FACETS = ["color", "style", "width"] as const;

function collapseUniformBorderSides(record: Record<string, string>): Record<string, string> {
	const out = { ...record };

	for (const facet of BORDER_FACETS) {
		const keys = BORDER_SIDES.map((side) => `border-${side}-${facet}`);
		const values = keys.map((key) => out[key]);
		const first = values[0];

		if (first === undefined || values.some((value) => value !== first)) {
			continue;
		}

		out[`border-${facet}`] = first;

		for (const key of keys) {
			delete out[key];
		}
	}

	return out;
}

/**
 * Drop computed values that do not paint, so evidence only keeps styles that could be a visible
 * indicator. `getComputedStyle` cannot tell authored from initial; this is the used-value
 * equivalent of "none".
 */
export function omitIdleStyleSnapshot(snapshot: StyleSnapshot): StyleSnapshot {
	return {
		element: omitIdleComputedStyles(snapshot.element, false),
		before: omitIdleComputedStyles(snapshot.before, true),
		after: omitIdleComputedStyles(snapshot.after, true),
	};
}

const LAYERS = ["element", "before", "after"] as const;

/**
 * The painted properties that differ between two style snapshots: plain names for the element
 * itself, prefixed with `::before` or `::after` for its pseudo-elements.
 */
export function changedStyleProperties(baseline: StyleSnapshot, focused: StyleSnapshot): string[] {
	const changed: string[] = [];

	for (const layer of LAYERS) {
		// A pseudo-element with no content is not drawn, whatever its styles compute to (it inherits
		// the element's text colour, for one).
		if (
			layer !== "element" &&
			isIdleComputedValue("content", baseline[layer].content ?? "none") &&
			isIdleComputedValue("content", focused[layer].content ?? "none")
		) {
			continue;
		}

		const base = renderedStyles(baseline[layer]);
		const next = renderedStyles(focused[layer]);

		// Iterate the union of both snapshots' keys so a property that is removed on focus still counts
		// as a difference.
		const props = new Set([...Object.keys(base), ...Object.keys(next)]);

		for (const prop of props) {
			if (base[prop] !== next[prop]) {
				changed.push(layer === "element" ? prop : `::${layer} ${prop}`);
			}
		}
	}

	return changed.sort();
}

export function stylesIndicateFocus(baseline: StyleSnapshot, focused: StyleSnapshot): boolean {
	return changedStyleProperties(baseline, focused).length > 0;
}

/**
 * Whether an element can show nothing of its own: it is fully transparent, clipped down to a pixel
 * (the "visually hidden" pattern), or positioned off the page. The real `<input>` of a custom
 * checkbox, radio or switch is hidden one of these ways, and any focus style it has is invisible.
 */
export function isUnpainted(rect: Rect, styles: StyleSnapshot): boolean {
	if (rect.width <= 1 || rect.height <= 1) {
		return true;
	}

	if (rect.x + rect.width <= 0 || rect.y + rect.height <= 0) {
		return true;
	}

	const opacity = styles.element.opacity;

	return opacity !== undefined && opacity !== "" && Number.parseFloat(opacity) === 0;
}

function changedRenderedProperties(
	baseline: Record<string, string>,
	focused: Record<string, string>,
): string[] {
	const base = renderedStyles(baseline);
	const next = renderedStyles(focused);
	const props = new Set([...Object.keys(base), ...Object.keys(next)]);

	return [...props].filter((prop) => {
		if (prop === "text-decoration") {
			// An unstyled underline is drawn in the text colour, so it changes along with it.
			return (
				base[prop]?.replace(COLOR_FUNCTION_PATTERN, "") !==
				next[prop]?.replace(COLOR_FUNCTION_PATTERN, "")
			);
		}

		return base[prop] !== next[prop];
	});
}

// WCAG 1.4.1 Understanding: colours whose luminance differs by 3:1 are distinguishable by lightness,
// not by colour alone.
export const MIN_LIGHTNESS_CONTRAST = 3;

const BORDER_COLOR_PATTERN = /^border-(top|right|bottom|left)-color$/;

/** Which single colour the changed properties amount to, or null when they are anything more. */
function colorGroup(changes: string[]): ColorOnlyChange["property"] | null {
	if (changes.length === 0) {
		return null;
	}

	if (changes.every((prop) => BORDER_COLOR_PATTERN.test(prop))) {
		return "border-color";
	}

	if (changes.length !== 1) {
		return null;
	}

	const [only] = changes;

	return only === "color" || only === "outline-color" || only === "background-color" ? only : null;
}

/**
 * Report the colour change when one colour (the text, the border, the outline or the background) is
 * the only painted difference between the baseline and focused styles, or null otherwise. A border
 * or outline here was already drawn before focus: one that appears on focus changes its width or
 * style too.
 *
 * `backdrop` is the opaque colour behind the element, when known. A background that is see-through
 * in one state shows that colour, so it stands in for the see-through one when the two are compared.
 */
export function colorOnlyChange(
	baseline: StyleSnapshot,
	focused: StyleSnapshot,
	backdrop?: string | null,
): ColorOnlyChange | null {
	const elementChanges = changedRenderedProperties(baseline.element, focused.element);
	const property = colorGroup(elementChanges);

	if (property === null) {
		return null;
	}

	for (const layer of ["before", "after"] as const) {
		const generatesContent =
			!isIdleComputedValue("content", baseline[layer].content ?? "none") ||
			!isIdleComputedValue("content", focused[layer].content ?? "none");

		if (!generatesContent) {
			continue;
		}

		const layerChanges = changedRenderedProperties(baseline[layer], focused[layer]);

		// Generated content inherits the text colour, so it follows a text colour change. Any other
		// change there is a second cue.
		if (layerChanges.some((prop) => property !== "color" || prop !== "color")) {
			return null;
		}
	}

	// Each changed border edge is judged on its own: the edge that changes most is the one seen.
	let best: { unfocused: string; focused: string; ratio: number | null } | null = null;
	let shownThrough: string | undefined;

	/** What a background colour looks like: the colour behind the element where it is see-through. */
	const painted = (color: string): string => {
		if (property === "background-color" && isTransparent(color) && backdrop) {
			shownThrough = backdrop;

			return backdrop;
		}

		return color;
	};

	for (const prop of elementChanges) {
		const unfocused = baseline.element[prop]!;
		const next = focused.element[prop]!;
		const unfocusedRgb = parseOpaqueRgb(painted(unfocused));
		const focusedRgb = parseOpaqueRgb(painted(next));
		const ratio = unfocusedRgb && focusedRgb ? contrastRatio(unfocusedRgb, focusedRgb) : null;

		if (best === null || (ratio !== null && (best.ratio === null || ratio > best.ratio))) {
			best = { unfocused, focused: next, ratio };
		}
	}

	const background = focused.element["background-color"];

	return {
		property,
		unfocusedColor: best!.unfocused,
		focusedColor: best!.focused,
		contrastRatio: best!.ratio,
		...(property !== "background-color" && background && !isTransparent(background)
			? { backgroundColor: background }
			: {}),
		...(shownThrough !== undefined ? { backgroundColor: shownThrough } : {}),
	};
}

/** A point identifying where the element sits within a screenshot clip. */
export type ClipAnchor = { x: number; y: number };

/**
 * Determine whether two screenshots differ by at least `minDiffPixels` pixels once aligned on their
 * anchors (the element's offset within each clip). Aligning first keeps a :focus rule that moves
 * the element (e.g. a margin change), or a fixed-position element whose page-relative rect changed
 * with the scroll position, from registering as a difference. Only the region both screenshots
 * cover is compared; without any overlap the comparison is inconclusive, which does not count as a
 * difference.
 */
export function alignedRegionsDiffer(
	pngA: Buffer,
	anchorA: ClipAnchor,
	pngB: Buffer,
	anchorB: ClipAnchor,
	minDiffPixels: number,
): boolean {
	const a = PNG.sync.read(pngA);
	const b = PNG.sync.read(pngB);

	// Crop each image so both start at the same offset from their anchor.
	const originX = Math.min(anchorA.x, anchorB.x);
	const originY = Math.min(anchorA.y, anchorB.y);
	const startA = {
		x: Math.round(anchorA.x - originX),
		y: Math.round(anchorA.y - originY),
	};
	const startB = {
		x: Math.round(anchorB.x - originX),
		y: Math.round(anchorB.y - originY),
	};

	const width = Math.min(a.width - startA.x, b.width - startB.x);
	const height = Math.min(a.height - startA.y, b.height - startB.y);

	if (width <= 0 || height <= 0) {
		return false;
	}

	const croppedA = crop(a, startA, width, height);
	const croppedB = crop(b, startB, width, height);

	const diffPixels = pixelmatch(croppedA.data, croppedB.data, undefined, width, height, {
		threshold: 0.1,
		// Blend semitransparent pixels against white so they do not introduce checkerboard noise into
		// focus/unfocus diffs.
		checkerboard: false,
	});

	return diffPixels >= minDiffPixels;
}

function crop(png: PNG, start: { x: number; y: number }, width: number, height: number): PNG {
	if (start.x === 0 && start.y === 0 && png.width === width && png.height === height) {
		return png;
	}

	const out = new PNG({ width, height });
	PNG.bitblt(png, out, start.x, start.y, width, height, 0, 0);

	return out;
}
