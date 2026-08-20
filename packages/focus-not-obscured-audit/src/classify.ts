/**
 * Focus not obscured (WCAG 2.4.11) AA bucket classification.
 */

export type { ObscuredMeasurement } from "@a11y-pulse/tab-orchestrator";

import type { ObscuredMeasurement } from "@a11y-pulse/tab-orchestrator";

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
