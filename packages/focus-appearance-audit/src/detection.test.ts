import { FOCUS_STYLE_PROPERTIES } from "@a11y-pulse/tab-orchestrator";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";
import {
	alignedRegionsDiffer,
	colorOnlyChange,
	omitIdleStyleSnapshot,
	type StyleSnapshot,
	stylesIndicateFocus,
} from "./detection";

function snapshot(overrides: Partial<Record<string, string>> = {}): StyleSnapshot {
	const base = {
		"outline-style": "none",
		"box-shadow": "none",
		color: "rgb(0, 0, 0)",
	};

	return {
		element: { ...base, ...overrides },
		before: { content: "none" },
		after: { content: "none" },
	};
}

function solidPng(width: number, height: number, rgb: [number, number, number]): Buffer {
	const png = new PNG({ width, height });

	for (let i = 0; i < png.data.length; i += 4) {
		png.data[i] = rgb[0];
		png.data[i + 1] = rgb[1];
		png.data[i + 2] = rgb[2];
		png.data[i + 3] = 255;
	}

	return PNG.sync.write(png);
}

describe("stylesIndicateFocus", () => {
	it("is true when the outline style changes", () => {
		expect(stylesIndicateFocus(snapshot(), snapshot({ "outline-style": "solid" }))).toBe(true);
	});

	it("is true when a box-shadow appears", () => {
		expect(
			stylesIndicateFocus(snapshot(), snapshot({ "box-shadow": "rgb(0,0,255) 0px 0px 3px" })),
		).toBe(true);
	});

	it("is false when nothing in the allowlist changes", () => {
		expect(stylesIndicateFocus(snapshot(), snapshot())).toBe(false);
	});

	it("is true when a pseudo-element indicator appears", () => {
		const focused: StyleSnapshot = { ...snapshot(), after: { content: '""' } };
		expect(stylesIndicateFocus(snapshot(), focused)).toBe(true);
	});

	it("is true when a focus-relevant property is removed on focus", () => {
		const baseline = snapshot({ "outline-style": "solid" });
		const focused: StyleSnapshot = {
			element: { "box-shadow": "none", color: "rgb(0, 0, 0)" },
			before: { content: "none" },
			after: { content: "none" },
		};
		expect(stylesIndicateFocus(baseline, focused)).toBe(true);
	});

	it("ignores an outline-color change while outline-style stays none", () => {
		const baseline = snapshot({
			"outline-style": "none",
			"outline-color": "rgb(31, 41, 55)",
		});
		const focused = snapshot({
			"outline-style": "none",
			"outline-color": "rgb(37, 99, 235)",
		});
		expect(stylesIndicateFocus(baseline, focused)).toBe(false);
	});

	it("still detects an outline that appears on focus", () => {
		const baseline = snapshot({
			"outline-style": "none",
			"outline-color": "rgb(31, 41, 55)",
		});
		const focused = snapshot({
			"outline-style": "solid",
			"outline-width": "3px",
			"outline-color": "rgb(37, 99, 235)",
		});
		expect(stylesIndicateFocus(baseline, focused)).toBe(true);
	});

	it("ignores a border-color change on an edge whose border-style is none", () => {
		const baseline = snapshot({
			"border-top-style": "none",
			"border-top-color": "rgb(31, 41, 55)",
		});
		const focused = snapshot({
			"border-top-style": "none",
			"border-top-color": "rgb(37, 99, 235)",
		});
		expect(stylesIndicateFocus(baseline, focused)).toBe(false);
	});

	it("ignores a border-color change on an edge whose border-style is hidden", () => {
		const baseline = snapshot({
			"border-top-style": "hidden",
			"border-top-color": "rgb(31, 41, 55)",
		});
		const focused = snapshot({
			"border-top-style": "hidden",
			"border-top-color": "rgb(37, 99, 235)",
		});
		expect(stylesIndicateFocus(baseline, focused)).toBe(false);
	});

	it("detects a border edge that becomes visible on focus", () => {
		const baseline = snapshot({
			"border-top-style": "none",
			"border-top-width": "0px",
		});
		const focused = snapshot({
			"border-top-style": "solid",
			"border-top-width": "2px",
			"border-top-color": "rgb(37, 99, 235)",
		});
		expect(stylesIndicateFocus(baseline, focused)).toBe(true);
	});
});

describe("colorOnlyChange", () => {
	const GREY = "rgb(51, 51, 51)";
	const DARK_GREEN = "rgb(46, 93, 46)";

	it("reports a text colour change with the contrast between the two colours", () => {
		const change = colorOnlyChange(snapshot({ color: GREY }), snapshot({ color: DARK_GREEN }));

		expect(change).toMatchObject({ unfocusedColor: GREY, focusedColor: DARK_GREEN });
		expect(change?.contrastRatio).toBeCloseTo(1.64, 2);
	});

	it("is null when nothing changes", () => {
		expect(colorOnlyChange(snapshot(), snapshot())).toBeNull();
	});

	it("is null when another indicator appears with the colour change", () => {
		expect(
			colorOnlyChange(
				snapshot({ color: GREY }),
				snapshot({ color: DARK_GREEN, "outline-style": "solid" }),
			),
		).toBeNull();
	});

	it("treats an underline that follows the text colour as part of the text", () => {
		const change = colorOnlyChange(
			snapshot({ color: GREY, "text-decoration": `underline solid ${GREY}` }),
			snapshot({ color: DARK_GREEN, "text-decoration": `underline solid ${DARK_GREEN}` }),
		);

		expect(change?.focusedColor).toBe(DARK_GREEN);
	});

	it("is null when an underline appears with the colour change", () => {
		expect(
			colorOnlyChange(
				snapshot({ color: GREY, "text-decoration": `none solid ${GREY}` }),
				snapshot({ color: DARK_GREEN, "text-decoration": `underline solid ${DARK_GREEN}` }),
			),
		).toBeNull();
	});

	it("allows generated pseudo content to change colour with the text", () => {
		const baseline = snapshot({ color: GREY });
		const focused = snapshot({ color: DARK_GREEN });
		baseline.after = { content: '"→"', color: GREY };
		focused.after = { content: '"→"', color: DARK_GREEN };

		expect(colorOnlyChange(baseline, focused)).not.toBeNull();
	});

	it("is null when generated pseudo content paints something other than colour", () => {
		const baseline = snapshot({ color: GREY });
		const focused = snapshot({ color: DARK_GREEN });
		baseline.after = { content: '""', "background-color": "rgba(0, 0, 0, 0)" };
		focused.after = { content: '""', "background-color": DARK_GREEN };

		expect(colorOnlyChange(baseline, focused)).toBeNull();
	});

	it("ignores pseudo layers that generate no content", () => {
		const baseline = snapshot({ color: GREY });
		const focused = snapshot({ color: DARK_GREEN });
		baseline.before = { content: "none", "box-shadow": "none" };
		focused.before = { content: "none", "box-shadow": "rgb(0, 0, 0) 0px 0px 4px 0px" };

		expect(colorOnlyChange(baseline, focused)).not.toBeNull();
	});

	it("is null when only a pseudo-element changes colour", () => {
		const baseline = snapshot();
		const focused = snapshot();
		baseline.before = { content: '"•"', color: GREY };
		focused.before = { content: '"•"', color: DARK_GREEN };

		expect(colorOnlyChange(baseline, focused)).toBeNull();
	});

	it("has no contrast ratio when either colour is translucent", () => {
		const change = colorOnlyChange(
			snapshot({ color: GREY }),
			snapshot({ color: "rgba(46, 93, 46, 0.6)" }),
		);

		expect(change?.contrastRatio).toBeNull();
	});
});

describe("omitIdleStyleSnapshot", () => {
	it("drops none-like values and unused pseudo layers", () => {
		expect(
			omitIdleStyleSnapshot({
				element: {
					"background-color": "rgba(0, 0, 0, 0)",
					"background-image": "none",
					"border-bottom-style": "none",
					"border-bottom-width": "0px",
					"border-bottom-color": "rgb(255, 255, 255)",
					"box-shadow": "none",
					color: "rgb(255, 255, 255)",
					"font-weight": "400",
					"outline-style": "none",
					"outline-width": "3px",
					"outline-color": "rgb(255, 255, 255)",
					"text-decoration": "none",
				},
				before: {
					content: "none",
					color: "rgb(255, 255, 255)",
					"outline-width": "3px",
				},
				after: { content: "none" },
			}),
		).toEqual({
			element: { color: "rgb(255, 255, 255)" },
			before: {},
			after: {},
		});
	});

	it("keeps painted decorations and generated pseudo content", () => {
		expect(
			omitIdleStyleSnapshot({
				element: {
					"outline-style": "solid",
					"outline-width": "2px",
					"outline-color": "rgb(0, 10, 22)",
					"font-weight": "700",
				},
				before: { content: '""', "background-color": "rgb(0, 0, 0)" },
				after: {},
			}),
		).toEqual({
			element: {
				"outline-style": "solid",
				"outline-width": "2px",
				"outline-color": "rgb(0, 10, 22)",
				"font-weight": "700",
			},
			before: { content: '""', "background-color": "rgb(0, 0, 0)" },
			after: {},
		});
	});

	it("collapses uniform border sides into shorthand", () => {
		expect(
			omitIdleStyleSnapshot({
				element: {
					"border-top-color": "rgb(0, 0, 0)",
					"border-right-color": "rgb(0, 0, 0)",
					"border-bottom-color": "rgb(0, 0, 0)",
					"border-left-color": "rgb(0, 0, 0)",
					"border-top-style": "solid",
					"border-right-style": "solid",
					"border-bottom-style": "solid",
					"border-left-style": "solid",
					"border-top-width": "1px",
					"border-right-width": "1px",
					"border-bottom-width": "1px",
					"border-left-width": "1px",
				},
				before: {},
				after: {},
			}),
		).toEqual({
			element: {
				"border-color": "rgb(0, 0, 0)",
				"border-style": "solid",
				"border-width": "1px",
			},
			before: {},
			after: {},
		});
	});

	it("keeps per-side border properties when a side differs", () => {
		expect(
			omitIdleStyleSnapshot({
				element: {
					"border-top-color": "rgb(255, 0, 0)",
					"border-right-color": "rgb(0, 0, 0)",
					"border-bottom-color": "rgb(0, 0, 0)",
					"border-left-color": "rgb(0, 0, 0)",
					"border-top-style": "solid",
					"border-right-style": "solid",
					"border-bottom-style": "solid",
					"border-left-style": "solid",
					"border-top-width": "1px",
					"border-right-width": "1px",
					"border-bottom-width": "1px",
					"border-left-width": "1px",
				},
				before: {},
				after: {},
			}),
		).toEqual({
			element: {
				"border-top-color": "rgb(255, 0, 0)",
				"border-right-color": "rgb(0, 0, 0)",
				"border-bottom-color": "rgb(0, 0, 0)",
				"border-left-color": "rgb(0, 0, 0)",
				"border-style": "solid",
				"border-width": "1px",
			},
			before: {},
			after: {},
		});
	});
});

describe("FOCUS_STYLE_PROPERTIES", () => {
	it("excludes layout properties", () => {
		for (const layout of ["margin", "padding", "width", "height", "position", "transform"]) {
			expect(FOCUS_STYLE_PROPERTIES).not.toContain(layout);
		}
	});

	it("includes the core indicator properties", () => {
		expect(FOCUS_STYLE_PROPERTIES).toContain("outline-style");
		expect(FOCUS_STYLE_PROPERTIES).toContain("box-shadow");
	});
});

describe("alignedRegionsDiffer", () => {
	const ORIGIN = { x: 0, y: 0 };

	function dotAt(png: Buffer, x: number, y: number): Buffer {
		const parsed = PNG.sync.read(png);
		const i = (y * parsed.width + x) * 4;
		parsed.data[i] = 0;
		parsed.data[i + 1] = 0;
		parsed.data[i + 2] = 0;

		return PNG.sync.write(parsed);
	}

	it("is false for identical images", () => {
		const a = solidPng(8, 8, [255, 255, 255]);
		const b = solidPng(8, 8, [255, 255, 255]);
		expect(alignedRegionsDiffer(a, ORIGIN, b, ORIGIN, 1)).toBe(false);
	});

	it("is true for clearly different images", () => {
		const a = solidPng(8, 8, [255, 255, 255]);
		const b = solidPng(8, 8, [0, 0, 0]);
		expect(alignedRegionsDiffer(a, ORIGIN, b, ORIGIN, 1)).toBe(true);
	});

	it("requires at least `minDiffPixels` differing pixels", () => {
		// One black pixel on an otherwise-white 8x8 image: exactly 1 pixel differs.
		const a = solidPng(8, 8, [255, 255, 255]);
		const oneDiff = dotAt(solidPng(8, 8, [255, 255, 255]), 0, 0);

		// Meets the threshold of 1, but not a threshold of 2.
		expect(alignedRegionsDiffer(a, ORIGIN, oneDiff, ORIGIN, 1)).toBe(true);
		expect(alignedRegionsDiffer(a, ORIGIN, oneDiff, ORIGIN, 2)).toBe(false);
	});

	it("aligns the regions on their anchors before comparing", () => {
		// The same mark drawn relative to each anchor: a pure positional shift of the element between
		// the two screenshots, which is not an indicator.
		const a = dotAt(solidPng(20, 20, [255, 255, 255]), 6, 7);
		const b = dotAt(solidPng(20, 20, [255, 255, 255]), 2, 3);

		expect(alignedRegionsDiffer(a, { x: 6, y: 7 }, b, { x: 2, y: 3 }, 1)).toBe(false);
	});

	it("compares only the overlap when the images differ in size", () => {
		// One screenshot was clamped smaller (e.g. at a page edge); the area both cover is identical,
		// so no indicator is detected.
		const a = solidPng(8, 8, [255, 255, 255]);
		const b = solidPng(8, 10, [255, 255, 255]);
		expect(alignedRegionsDiffer(a, ORIGIN, b, ORIGIN, 1)).toBe(false);
	});

	it("is false (inconclusive) when the aligned regions do not overlap", () => {
		const a = solidPng(8, 8, [255, 255, 255]);
		const b = solidPng(8, 8, [0, 0, 0]);

		expect(alignedRegionsDiffer(a, ORIGIN, b, { x: 30, y: 0 }, 1)).toBe(false);
	});
});
