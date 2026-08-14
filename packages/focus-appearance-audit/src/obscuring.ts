/**
 * Focus not obscured (WCAG 2.4.11) measurement types and AA bucket classification.
 */

export type ObscuredOpacity = "opaque" | "semi-transparent" | "unknown";

export type ObscuredBy = {
	selector: string;
	html: string;
};

export type ObscuredMeasurement = {
	/** Fraction of the visible element rect covered by unrelated content (0..1). */
	coveredFraction: number;
	/** True when sampling + containment confirm the component is entirely hidden. */
	fullyObscured: boolean;
	/** True when the focused element has no intersection with the viewport. */
	offscreen: boolean;
	opacity: ObscuredOpacity;
	obscuredBy: ObscuredBy | null;
};

/**
 * AA bucket for 2.4.11. Partial covers are recorded on the element but are not
 * failures under the Minimum criterion (that is AAA / 2.4.12).
 */
export type ObscuringBucket = "violation" | "incomplete" | "pass";

export function classifyObscuring(m: ObscuredMeasurement): ObscuringBucket {
	if (m.offscreen) {
		return "incomplete";
	}

	if (!m.fullyObscured) {
		return "pass";
	}

	if (m.opacity === "opaque") {
		return "violation";
	}

	if (m.opacity === "unknown") {
		return "incomplete";
	}

	// Semi-transparent: visible through the cover, so not "entirely hidden".
	return "pass";
}
