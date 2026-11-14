import { truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import type { MeasureObscuringResult } from "./browser-scripts";
import type { ObscuredMeasurement } from "./types";

/**
 * Turn what `measureObscuringScript` reports, and the selector resolved for the cover it marked,
 * into the measurement consumers see.
 */
export function toObscuredMeasurement(
	measured: MeasureObscuringResult,
	obscurerSelector: string | null,
): ObscuredMeasurement {
	let obscuredBy: ObscuredMeasurement["obscuredBy"] = null;

	if (measured.hasObscurer && obscurerSelector !== null) {
		obscuredBy = {
			selector: obscurerSelector,
			html: truncateHtml(measured.obscuredByHtml ?? ""),
		};

		if (measured.coverRect) {
			obscuredBy.rect = measured.coverRect;
		}

		if (measured.coverPosition) {
			obscuredBy.position = measured.coverPosition;
		}

		if (measured.coverIgnoresPointer) {
			obscuredBy.ignoresPointerEvents = true;
		}
	}

	const measurement: ObscuredMeasurement = {
		coveredFraction: measured.coveredFraction,
		fullyObscured: measured.fullyObscured,
		offscreen: measured.offscreen,
		opacity: measured.opacity,
		obscuredBy,
	};

	if (measured.rect) {
		measurement.rect = measured.rect;
	}

	if (measured.measured === "label") {
		measurement.measured = "label";
	}

	if (measured.notPainted) {
		measurement.notPainted = true;
	}

	return measurement;
}
