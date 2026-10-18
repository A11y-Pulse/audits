import { describe, expect, it } from "vitest";
import { contrastRatio, parseOpaqueRgb, relativeLuminance } from "./contrast";

describe("parseOpaqueRgb", () => {
	it("parses a computed rgb() value", () => {
		expect(parseOpaqueRgb("rgb(46, 93, 46)")).toEqual([46, 93, 46]);
	});

	it("parses an rgba() value with full alpha", () => {
		expect(parseOpaqueRgb("rgba(0, 0, 238, 1)")).toEqual([0, 0, 238]);
	});

	it("rejects a translucent colour", () => {
		expect(parseOpaqueRgb("rgba(0, 0, 0, 0.5)")).toBeNull();
		expect(parseOpaqueRgb("rgba(0, 0, 0, 0)")).toBeNull();
	});

	it("rejects colours outside the sRGB functional notation", () => {
		expect(parseOpaqueRgb("oklch(0.5 0.1 140)")).toBeNull();
		expect(parseOpaqueRgb("color(display-p3 0 1 0)")).toBeNull();
		expect(parseOpaqueRgb("transparent")).toBeNull();
	});
});

describe("relativeLuminance", () => {
	it("is 0 for black and 1 for white", () => {
		expect(relativeLuminance([0, 0, 0])).toBe(0);
		expect(relativeLuminance([255, 255, 255])).toBe(1);
	});
});

describe("contrastRatio", () => {
	it("is 21 for black on white, in either order", () => {
		expect(contrastRatio([0, 0, 0], [255, 255, 255])).toBe(21);
		expect(contrastRatio([255, 255, 255], [0, 0, 0])).toBe(21);
	});

	it("is 1 for identical colours", () => {
		expect(contrastRatio([51, 51, 51], [51, 51, 51])).toBe(1);
	});

	it("matches the published ratio for #767676 on white", () => {
		expect(contrastRatio([118, 118, 118], [255, 255, 255])).toBeCloseTo(4.54, 2);
	});
});
