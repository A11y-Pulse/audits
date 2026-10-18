export type Rgb = readonly [number, number, number];

// Computed colours serialise as `rgb()` or `rgba()` with comma separators for sRGB values. Colours
// authored in other spaces (oklch, display-p3) keep their own notation and are not parsed.
const RGB_PATTERN = /^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/;

/**
 * Parse a computed `rgb()` or `rgba()` colour, or return null when it is translucent or in another
 * notation.
 */
export function parseOpaqueRgb(value: string): Rgb | null {
	const match = RGB_PATTERN.exec(value.trim());

	if (!match) {
		return null;
	}

	if (match[4] !== undefined && Number(match[4]) < 1) {
		return null;
	}

	return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function linearise(channel: number): number {
	const c = channel / 255;

	return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * The WCAG relative luminance of an sRGB colour, from 0 (black) to 1 (white).
 */
export function relativeLuminance([r, g, b]: Rgb): number {
	return 0.2126 * linearise(r) + 0.7152 * linearise(g) + 0.0722 * linearise(b);
}

/**
 * The WCAG contrast ratio between two colours, from 1 to 21.
 */
export function contrastRatio(a: Rgb, b: Rgb): number {
	const la = relativeLuminance(a);
	const lb = relativeLuminance(b);

	return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
