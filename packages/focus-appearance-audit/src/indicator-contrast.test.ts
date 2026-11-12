import type { StyleSnapshot } from "@a11y-pulse/tab-orchestrator";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
	FAINT_CHANGE_THRESHOLD,
	pixelIndicatorContrast,
	styleIndicatorContrast,
} from "./indicator-contrast";

const WHITE = "rgb(255, 255, 255)";

// What Chrome computes for an unstyled link: no outline, no border, no shadow, no background.
const IDLE: Record<string, string> = {
	"background-color": "rgba(0, 0, 0, 0)",
	"background-image": "none",
	"box-shadow": "none",
	color: "rgb(0, 0, 238)",
	"outline-color": "rgb(0, 0, 238)",
	"outline-style": "none",
	"outline-width": "0px",
	"text-decoration": "underline solid rgb(0, 0, 238)",
	...Object.fromEntries(
		["top", "right", "bottom", "left"].flatMap((side) => [
			[`border-${side}-color`, "rgb(0, 0, 238)"],
			[`border-${side}-style`, "none"],
			[`border-${side}-width`, "0px"],
		]),
	),
};

function snapshot(overrides: Record<string, string> = {}): StyleSnapshot {
	return { element: { ...IDLE, ...overrides }, before: {}, after: {} };
}

function border(color: string, width = "2px"): Record<string, string> {
	return Object.fromEntries(
		["top", "right", "bottom", "left"].flatMap((side) => [
			[`border-${side}-color`, color],
			[`border-${side}-style`, "solid"],
			[`border-${side}-width`, width],
		]),
	);
}

function contrast(
	baseline: Record<string, string>,
	focused: Record<string, string>,
	backdrop: string | null | undefined = WHITE,
) {
	const before = snapshot(baseline);
	const after = snapshot(focused);
	const changed = Object.keys(after.element).filter(
		(key) => before.element[key] !== after.element[key],
	);

	return styleIndicatorContrast(before, after, changed, backdrop);
}

const OUTLINE = { "outline-style": "solid", "outline-width": "2px" };

describe("styleIndicatorContrast", () => {
	it("compares an outline that appears on focus with the background around the element", () => {
		const result = contrast({}, { ...OUTLINE, "outline-color": "rgb(0, 80, 255)" });

		expect(result).toMatchObject({
			method: "style",
			property: "outline",
			indicatorColor: "rgb(0, 80, 255)",
			adjacentColor: WHITE,
			comparedAgainst: "surroundings",
		});
		expect(result?.ratio).toBeCloseTo(5.85, 1);
	});

	it("measures a pale outline on white at well under 3:1", () => {
		const result = contrast({}, { ...OUTLINE, "outline-color": "rgb(217, 217, 217)" });

		expect(result?.ratio).toBeCloseTo(1.41, 1);
	});

	it("judges the same outline colour differently on a dark page", () => {
		const pale = { ...OUTLINE, "outline-color": "rgb(217, 217, 217)" };

		expect(contrast({}, pale, "rgb(20, 33, 61)")?.ratio).toBeGreaterThan(10);
	});

	it("compares a recoloured border with the colours next to it, not with how it looked before", () => {
		const result = contrast(border("rgb(153, 153, 153)"), border("rgb(138, 138, 138)"));

		expect(result).toMatchObject({
			property: "border",
			indicatorColor: "rgb(138, 138, 138)",
			adjacentColor: WHITE,
		});
		expect(result?.ratio).toBeCloseTo(3.45, 1);
		// How far it moved from its unfocused colour is information only.
		expect(result?.stateChangeRatio).toBeCloseTo(1.21, 1);
	});

	it("does not fail a grey border that turns blue on white, with a faint tint behind it", () => {
		// 1.4.11 asks for 3:1 against adjacent colours. Blue against the grey it replaced is 1.9:1,
		// which is beside the point: against the white on either side of it, it is 8.6:1.
		const result = contrast(
			{ ...border("rgb(118, 118, 118)"), "background-color": WHITE },
			{ ...border("rgb(0, 0, 255)"), "background-color": "rgb(247, 247, 255)" },
		);

		expect(result).toMatchObject({ property: "border", indicatorColor: "rgb(0, 0, 255)" });
		expect(result?.ratio).toBeGreaterThan(8);
		expect(result?.stateChangeRatio).toBeCloseTo(1.89, 1);
	});

	it("compares a border on a filled element with the fill when that is where it stands out", () => {
		const base = { "background-color": "rgb(20, 33, 61)" };
		const result = contrast(base, { ...base, ...border(WHITE) });

		// White on the white page is invisible from outside; against the dark fill it is not.
		expect(result).toMatchObject({
			property: "border",
			comparedAgainst: "own-background",
			adjacentColor: "rgb(20, 33, 61)",
		});
		expect(result?.ratio).toBeGreaterThan(10);
	});

	describe("outline-offset", () => {
		const button = { "background-color": "rgb(20, 33, 61)" };
		const outline = (offset: string) => ({
			...button,
			...OUTLINE,
			"outline-color": WHITE,
			"outline-offset": offset,
		});

		it("compares an outline pulled inside the element with the element's own fill", () => {
			const result = contrast(button, outline("-5px"));

			expect(result).toMatchObject({
				property: "outline",
				comparedAgainst: "own-background",
				adjacentColor: "rgb(20, 33, 61)",
			});
			expect(result?.ratio).toBeGreaterThan(10);
		});

		it("compares an outline at or beyond the edge with the surroundings", () => {
			for (const offset of ["0px", "2px"]) {
				const result = contrast(button, outline(offset));

				expect(result).toMatchObject({ comparedAgainst: "surroundings", adjacentColor: WHITE });
				expect(result?.ratio).toBeCloseTo(1, 1);
			}
		});

		it("takes the better neighbour for an outline that straddles the edge", () => {
			// 2px wide, pulled in by 1px: half over the fill, half over the page.
			expect(contrast(button, outline("-1px"))).toMatchObject({
				comparedAgainst: "own-background",
			});
		});

		it("measures an outline that only moves on focus", () => {
			const result = contrast(outline("2px"), outline("-5px"));

			expect(result).toMatchObject({ property: "outline", comparedAgainst: "own-background" });
		});
	});

	it("compares a border that appears or thickens with the surroundings", () => {
		const appears = contrast({}, border("rgb(0, 80, 255)"));
		const thickens = contrast(border("rgb(0, 80, 255)", "1px"), border("rgb(0, 80, 255)", "3px"));

		expect(appears).toMatchObject({ property: "border", comparedAgainst: "surroundings" });
		expect(thickens).toMatchObject({ property: "border", comparedAgainst: "surroundings" });
		expect(thickens?.ratio).toBeCloseTo(5.85, 1);
	});

	it("compares a solid box-shadow ring with the surroundings", () => {
		const result = contrast(
			{},
			{ "box-shadow": "rgb(255, 209, 102) 0px 0px 0px 3px" },
			"rgb(20, 33, 61)",
		);

		expect(result).toMatchObject({ property: "box-shadow", adjacentColor: "rgb(20, 33, 61)" });
		expect(result?.ratio).toBeCloseTo(11.1, 0);
	});

	it("compares an inset shadow with the element's own background", () => {
		const base = { "background-color": "rgb(20, 33, 61)" };
		const result = contrast(base, {
			...base,
			"box-shadow": "rgb(255, 255, 255) 0px 0px 0px 2px inset",
		});

		expect(result).toMatchObject({
			comparedAgainst: "own-background",
			adjacentColor: "rgb(20, 33, 61)",
		});
		expect(result?.ratio).toBeGreaterThan(10);
	});

	it("only measures the shadow added on focus, not one that was already there", () => {
		const resting = "rgba(0, 0, 0, 0.2) 0px 1px 2px 0px";
		const result = contrast(
			{ "box-shadow": resting },
			{ "box-shadow": `rgb(0, 80, 255) 0px 0px 0px 3px, ${resting}` },
		);

		expect(result).toMatchObject({ indicatorColor: "rgb(0, 80, 255)" });
		expect(result?.ratio).toBeCloseTo(5.85, 1);
	});

	it("compares a fill that changes with what is around the element", () => {
		const result = contrast(
			{ "background-color": "rgb(244, 244, 244)" },
			{ "background-color": "rgb(29, 53, 87)" },
		);

		expect(result).toMatchObject({
			property: "background-color",
			comparedAgainst: "surroundings",
			adjacentColor: WHITE,
		});
		expect(result?.ratio).toBeGreaterThan(10);
		expect(result?.stateChangeRatio).toBeGreaterThan(10);
	});

	it("judges a dark fill that only gets a little darker as standing out from the page", () => {
		// Hard to tell from the unfocused state, which is the colour-only check's concern, but as
		// a fill next to the white page it has all the contrast 1.4.11 asks for.
		const result = contrast(
			{ "background-color": "rgb(29, 53, 87)" },
			{ "background-color": "rgb(20, 33, 61)" },
		);

		expect(result?.ratio).toBeGreaterThan(10);
		expect(result?.stateChangeRatio).toBeLessThan(1.5);
	});

	it("has nothing to measure when a fill disappears on focus", () => {
		expect(
			contrast(
				{ "background-color": "rgb(240, 240, 240)" },
				{ "background-color": "rgba(0, 0, 0, 0)" },
			),
		).toBeUndefined();
	});

	it("sees a background that was see-through before as the colour behind the element", () => {
		const result = contrast({}, { "background-color": "rgb(240, 240, 240)" });

		expect(result).toMatchObject({ adjacentColor: WHITE });
		expect(result?.ratio).toBeCloseTo(1.14, 1);
	});

	it("takes the strongest part when several change", () => {
		const result = contrast(border("rgb(153, 153, 153)"), {
			...border("rgb(138, 138, 138)"),
			...OUTLINE,
			"outline-color": "rgb(0, 80, 255)",
		});

		expect(result).toMatchObject({ property: "outline" });
		expect(result?.ratio).toBeGreaterThan(3);
	});

	describe("declines rather than guessing", () => {
		it("when a background image or translucent colour is behind the element", () => {
			const result = contrast({}, { ...OUTLINE, "outline-color": "rgb(0, 80, 255)" }, null);

			expect(result).toMatchObject({ ratio: null, reason: "background-unresolved" });
		});

		it("when the indicator colour is translucent", () => {
			const result = contrast({}, { "box-shadow": "rgba(13, 110, 253, 0.25) 0px 0px 0px 4px" });

			expect(result).toMatchObject({ ratio: null, reason: "translucent" });
		});

		it("when the shadow is a soft glow with no spread", () => {
			const result = contrast({}, { "box-shadow": "rgb(0, 80, 255) 0px 0px 8px 0px" });

			expect(result).toMatchObject({ ratio: null, reason: "translucent" });
		});

		it("when an inset shadow sits on a background image", () => {
			const base = { "background-image": "linear-gradient(rgb(0, 0, 0), rgb(255, 255, 255))" };
			const result = contrast(base, {
				...base,
				"box-shadow": "rgb(255, 255, 255) 0px 0px 0px 2px inset",
			});

			expect(result).toMatchObject({ ratio: null, reason: "background-image" });
		});

		it("when a weak part is measured but another cannot be", () => {
			// Bootstrap's form control: the border shifts shade and a translucent ring appears.
			const result = contrast(border("rgb(222, 226, 230)", "1px"), {
				...border("rgb(134, 183, 254)", "1px"),
				"box-shadow": "rgba(13, 110, 253, 0.25) 0px 0px 0px 4px",
			});

			expect(result).toMatchObject({ ratio: null, reason: "translucent" });
		});
	});

	describe("stays out of it", () => {
		it("when nothing it can measure changed", () => {
			expect(contrast({}, { "text-decoration": "none solid rgb(0, 0, 238)" })).toBeUndefined();
			expect(contrast({}, { color: "rgb(200, 0, 0)" })).toBeUndefined();
		});

		it("for the browser's default focus ring", () => {
			const ring = {
				"outline-style": "auto",
				"outline-width": "1px",
				"outline-color": "rgb(16, 16, 16)",
			};

			expect(contrast({}, ring)).toBeUndefined();
			// A pale border shift that comes with the ring: the ring carries the indicator.
			expect(
				contrast(border("rgb(230, 230, 230)"), { ...border("rgb(220, 220, 220)"), ...ring }),
			).toBeUndefined();
		});

		it("when a weak part comes with a change it does not measure, such as an underline", () => {
			const result = contrast(
				{ ...border("rgb(230, 230, 230)"), "text-decoration": "none solid rgb(0, 0, 238)" },
				border("rgb(220, 220, 220)"),
			);

			expect(result).toBeUndefined();
		});

		it("for a change of text colour", () => {
			expect(contrast({ color: "rgb(0, 0, 238)" }, { color: "rgb(0, 0, 160)" })).toBeUndefined();
		});

		it("for an outline whose colour is fully transparent", () => {
			expect(contrast({}, { ...OUTLINE, "outline-color": "rgba(0, 0, 0, 0)" })).toBeUndefined();
		});
	});
});

type Color = [number, number, number];

/** A PNG filled with one colour, then painted by `draw`. */
function image(
	width: number,
	height: number,
	fill: Color,
	draw: (set: (x: number, y: number, color: Color) => void) => void = () => {},
): Uint8Array {
	const png = new PNG({ width, height });
	const set = (x: number, y: number, [r, g, b]: Color): void => {
		const at = (y * width + x) * 4;
		png.data[at] = r;
		png.data[at + 1] = g;
		png.data[at + 2] = b;
		png.data[at + 3] = 255;
	};

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			set(x, y, fill);
		}
	}

	draw(set);

	return PNG.sync.write(png);
}

/** Paint a ring `thickness` pixels wide, `inset` pixels in from the edge. */
function ring(width: number, height: number, inset: number, thickness: number, color: Color) {
	return (set: (x: number, y: number, color: Color) => void): void => {
		for (let y = inset; y < height - inset; y++) {
			for (let x = inset; x < width - inset; x++) {
				const edge = Math.min(x - inset, y - inset, width - inset - 1 - x, height - inset - 1 - y);

				if (edge < thickness) {
					set(x, y, color);
				}
			}
		}
	};
}

const ORIGIN = { x: 0, y: 0 };
const PAGE: Color = [255, 255, 255];

describe("pixelIndicatorContrast", () => {
	it("measures a ring that appears against the page it is drawn on", () => {
		const unfocused = image(80, 40, PAGE);
		const focused = image(80, 40, PAGE, ring(80, 40, 4, 2, [0, 80, 255]));
		const result = pixelIndicatorContrast(focused, ORIGIN, unfocused, ORIGIN, 1);

		expect(result).toMatchObject({
			method: "pixels",
			comparedAgainst: "adjacent-pixels",
			indicatorColor: "rgb(0, 80, 255)",
			adjacentColor: "rgb(255, 255, 255)",
		});
		expect(result.ratio).toBeCloseTo(5.85, 1);
	});

	it("measures a recoloured ring against what is next to it, not what it replaced", () => {
		// A grey border that turns blue: 1.9:1 against the grey it was, 8.6:1 against the white
		// on either side of it, which is what 1.4.11 asks about.
		const unfocused = image(80, 40, PAGE, ring(80, 40, 4, 2, [118, 118, 118]));
		const focused = image(80, 40, PAGE, ring(80, 40, 4, 2, [0, 0, 255]));
		const result = pixelIndicatorContrast(focused, ORIGIN, unfocused, ORIGIN, 1);

		expect(result).toMatchObject({
			indicatorColor: "rgb(0, 0, 255)",
			adjacentColor: "rgb(255, 255, 255)",
		});
		expect(result.ratio).toBeCloseTo(8.59, 1);
		expect(result.stateChangeRatio).toBeCloseTo(1.89, 1);
	});

	it("measures a highlight against the page around it, not against the text inside it", () => {
		const text = (set: (x: number, y: number, color: Color) => void): void => {
			for (let y = 16; y < 24; y++) {
				for (let x = 20; x < 60; x += 3) {
					set(x, y, [0, 0, 0]);
				}
			}
		};
		const unfocused = image(80, 40, PAGE, text);
		const focused = image(80, 40, PAGE, (set) => {
			for (let y = 8; y < 32; y++) {
				for (let x = 8; x < 72; x++) {
					set(x, y, [208, 208, 208]);
				}
			}

			text(set);
		});
		const result = pixelIndicatorContrast(focused, ORIGIN, unfocused, ORIGIN, 1);

		// Pale grey beside black text would be 13:1; beside the white page it sits on, 1.5:1.
		expect(result.adjacentColor).toBe("rgb(255, 255, 255)");
		expect(result.ratio).toBeCloseTo(1.54, 1);
	});

	it("measures a pale highlight at under 3:1", () => {
		const unfocused = image(80, 40, PAGE);
		const focused = image(80, 40, [208, 208, 208]);
		const result = pixelIndicatorContrast(focused, ORIGIN, unfocused, ORIGIN, 1);

		expect(result.ratio).toBeCloseTo(1.54, 1);
	});

	it("ignores text and other pixels that did not change", () => {
		const text = (set: (x: number, y: number, color: Color) => void): void => {
			for (let x = 20; x < 60; x += 2) {
				set(x, 20, [0, 0, 0]);
			}
		};
		const unfocused = image(80, 40, PAGE, text);
		const focused = image(80, 40, PAGE, (set) => {
			ring(80, 40, 2, 3, [29, 53, 87])(set);
			text(set);
		});
		const result = pixelIndicatorContrast(focused, ORIGIN, unfocused, ORIGIN, 1);

		expect(result.indicatorColor).toBe("rgb(29, 53, 87)");
		expect(result.ratio).toBeGreaterThan(10);
	});

	it("lines the screenshots up on their anchors before comparing", () => {
		// The focused clip starts 5px further left, so the same page sits 5px to the right in it.
		const unfocused = image(80, 40, PAGE);
		const focused = image(85, 40, PAGE, (set) => {
			ring(80, 40, 4, 2, [0, 80, 255])((x, y, color) => set(x + 5, y, color));
		});
		const result = pixelIndicatorContrast(focused, { x: 5, y: 0 }, unfocused, ORIGIN, 1);

		expect(result.ratio).toBeCloseTo(5.85, 1);
	});

	it("picks up a change too faint for the default tolerance only when asked to", () => {
		const unfocused = image(80, 40, PAGE);
		const focused = image(80, 40, [244, 244, 244]);

		expect(pixelIndicatorContrast(focused, ORIGIN, unfocused, ORIGIN, 1)).toMatchObject({
			ratio: null,
			reason: "too-small",
		});
		expect(
			pixelIndicatorContrast(focused, ORIGIN, unfocused, ORIGIN, 1, FAINT_CHANGE_THRESHOLD).ratio,
		).toBeCloseTo(1.1, 1);
	});

	it("declines when too few pixels changed, scaled by the device pixel ratio", () => {
		const unfocused = image(80, 40, PAGE);
		const focused = image(80, 40, PAGE, (set) => {
			for (let x = 10; x < 30; x++) {
				set(x, 5, [0, 0, 0]);
			}
		});

		expect(pixelIndicatorContrast(focused, ORIGIN, unfocused, ORIGIN, 1).ratio).toBeCloseTo(21, 0);
		expect(pixelIndicatorContrast(focused, ORIGIN, unfocused, ORIGIN, 2)).toMatchObject({
			ratio: null,
			reason: "too-small",
		});
	});

	it("declines when the indicator sits on a gradient or image", () => {
		const gradient = (set: (x: number, y: number, color: Color) => void): void => {
			for (let y = 0; y < 40; y++) {
				for (let x = 0; x < 80; x++) {
					set(x, y, [x * 3, 255 - x * 3, y * 6]);
				}
			}
		};
		const unfocused = image(80, 40, PAGE, gradient);
		const focused = image(80, 40, PAGE, (set) => {
			gradient(set);
			ring(80, 40, 4, 2, [0, 80, 255])(set);
		});

		expect(pixelIndicatorContrast(focused, ORIGIN, unfocused, ORIGIN, 1)).toMatchObject({
			ratio: null,
			reason: "noisy",
		});
	});

	it("declines when the change itself has no dominant colour", () => {
		const unfocused = image(80, 40, PAGE);
		const focused = image(80, 40, PAGE, (set) => {
			for (let y = 0; y < 40; y++) {
				for (let x = 0; x < 80; x++) {
					set(x, y, [(x * 3) % 256, (y * 6) % 256, ((x + y) * 2) % 256]);
				}
			}
		});

		expect(pixelIndicatorContrast(focused, ORIGIN, unfocused, ORIGIN, 1)).toMatchObject({
			ratio: null,
			reason: "noisy",
		});
	});

	it("declines when the screenshots do not overlap", () => {
		const a = image(10, 10, PAGE);

		expect(pixelIndicatorContrast(a, { x: 50, y: 0 }, a, ORIGIN, 1)).toMatchObject({
			ratio: null,
			reason: "too-small",
		});
	});
});
