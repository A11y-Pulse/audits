import type { Rect } from "./adaptor";

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
