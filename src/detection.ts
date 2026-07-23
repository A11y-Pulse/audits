import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

/** A snapshot of an element's focus-relevant computed styles, plus its pseudo-elements. */
export type StyleSnapshot = {
	element: Record<string, string>;
	before: Record<string, string>;
	after: Record<string, string>;
};

export type Rect = { x: number; y: number; width: number; height: number };

/**
 * A screenshot clip framing `rect` with up to `buffer` pixels of padding on each side, shrunk
 * where the page edges leave less room. The padding allows for indicators drawn just outside
 * the element box (outlines, shadows) and for anti-aliasing.
 */
export function bufferedClip(
	rect: Rect,
	pageWidth: number,
	pageHeight: number,
	buffer: number,
): Rect {
	const left = Math.max(0, Math.min(buffer, rect.x));
	const top = Math.max(0, Math.min(buffer, rect.y));
	const right = Math.max(0, Math.min(buffer, pageWidth - rect.x - rect.width));
	const bottom = Math.max(
		0,
		Math.min(buffer, pageHeight - rect.y - rect.height),
	);

	// Clamp to non-negative origins: an element positioned partially off the top
	// or left of the document has a negative page-relative rect, and Puppeteer
	// rejects a screenshot clip with negative x/y.
	return {
		x: Math.max(0, rect.x - left),
		y: Math.max(0, rect.y - top),
		width: rect.width + left + right,
		height: rect.height + top + bottom,
	};
}

/**
 * Collapse the colour/width of a decoration (outline, each border edge) that is
 * not actually painted — its style is `none` or `hidden`, or its width is `0px`. This keeps a
 * change to a non-rendered property (e.g. `outline-color` while `outline-style`
 * stays `none`) from being mistaken for a visible focus indicator.
 */
function renderedStyles(
	record: Record<string, string>,
): Record<string, string> {
	const out = { ...record };

	const collapse = (style: string, width: string, color: string): void => {
		if (
			out[style] === "none" ||
			out[style] === "hidden" ||
			out[width] === "0px"
		) {
			delete out[width];
			delete out[color];
		}
	};

	collapse("outline-style", "outline-width", "outline-color");

	for (const side of ["top", "right", "bottom", "left"]) {
		collapse(
			`border-${side}-style`,
			`border-${side}-width`,
			`border-${side}-color`,
		);
	}

	return out;
}

/**
 * Determine whether style differences indicate a focus appearance
 */
export function stylesIndicateFocus(
	baseline: StyleSnapshot,
	focused: StyleSnapshot,
): boolean {
	for (const layer of ["element", "before", "after"] as const) {
		const base = renderedStyles(baseline[layer]);
		const next = renderedStyles(focused[layer]);

		// Iterate the union of both snapshots' keys so a property that is removed
		// on focus still counts as a difference.
		const props = new Set([...Object.keys(base), ...Object.keys(next)]);

		for (const prop of props) {
			if (base[prop] !== next[prop]) {
				return true;
			}
		}
	}

	return false;
}

/** A point identifying where the element sits within a screenshot clip. */
export type ClipAnchor = { x: number; y: number };

/**
 * Determine whether two screenshots differ by at least `minDiffPixels` pixels once aligned on
 * their anchors (the element's offset within each clip). Aligning first keeps a :focus rule that
 * moves the element (e.g. a margin change), or a fixed-position element whose page-relative rect
 * changed with the scroll position, from registering as a difference. Only the region both
 * screenshots cover is compared; without any overlap the comparison is inconclusive, which does
 * not count as a difference.
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

	const diffPixels = pixelmatch(
		croppedA.data,
		croppedB.data,
		null,
		width,
		height,
		{ threshold: 0.1 },
	);

	return diffPixels >= minDiffPixels;
}

function crop(
	png: PNG,
	start: { x: number; y: number },
	width: number,
	height: number,
): PNG {
	if (
		start.x === 0 &&
		start.y === 0 &&
		png.width === width &&
		png.height === height
	) {
		return png;
	}

	const out = new PNG({ width, height });
	PNG.bitblt(png, out, start.x, start.y, width, height, 0, 0);

	return out;
}
