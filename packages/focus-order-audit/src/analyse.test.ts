import { describe, expect, it } from "vitest";
import { findDisorder, type PageGeometry, type SequenceStop } from "./analyse";

const PAGE: PageGeometry = {
	viewportWidth: 1000,
	viewportHeight: 800,
	layoutWidth: 1000,
	layoutHeight: 6000,
	direction: "ltr",
	writingMode: "horizontal-tb",
};

function stop(
	tabIndex: number,
	x: number,
	y: number,
	extra: Partial<SequenceStop> = {},
): SequenceStop {
	return {
		tabIndex,
		selector: `#s${tabIndex}`,
		html: `<a id="s${tabIndex}">`,
		rect: { x, y, width: 100, height: 20 },
		excluded: false,
		...extra,
	};
}

/** Stops at the given (x, y) positions, in tab order. */
function sequence(...points: Array<[number, number]>): SequenceStop[] {
	return points.map(([x, y], i) => stop(i + 1, x, y));
}

describe("findDisorder", () => {
	it("is silent on a monotonic top-to-bottom sequence", () => {
		expect(findDisorder(sequence([0, 0], [0, 900], [0, 1800], [0, 2700]), PAGE)).toEqual([]);
	});

	it("tolerates up to two backwards jumps and reports the third", () => {
		const twoJumps = sequence([0, 3000], [0, 2000], [0, 4000], [0, 3000], [0, 5000]);
		const threeJumps = sequence([0, 3000], [0, 2000], [0, 1000], [0, 0]);

		expect(findDisorder(twoJumps, PAGE)).toEqual([]);
		expect(findDisorder(threeJumps, PAGE).map((t) => [t.from.tabIndex, t.to.tabIndex])).toEqual([
			[1, 2],
			[2, 3],
			[3, 4],
		]);
	});

	it("never counts an upward move within one viewport", () => {
		expect(findDisorder(sequence([0, 3000], [0, 2300], [0, 1600], [0, 900]), PAGE)).toEqual([]);
	});

	it("allows a column-major form whose columns sit close together", () => {
		const form = sequence([0, 0], [0, 100], [0, 200], [400, 0], [400, 100], [400, 200]);

		expect(findDisorder(form, PAGE)).toEqual([]);
	});

	it("reports two independent columns read across each other once a jump accompanies them", () => {
		const interleaved = sequence(
			[0, 2000],
			[800, 2000],
			[0, 2300],
			[800, 2150],
			[0, 2600],
			[800, 2350],
			[0, 0],
		);
		const kinds = findDisorder(interleaved, PAGE).map((t) => t.kind);

		expect(kinds).toContain("column-thrash");
		expect(kinds).toContain("backwards-jump");
	});

	it("needs a backwards jump alongside column thrash", () => {
		const interleaved = sequence([0, 0], [800, 0], [0, 300], [800, 150], [0, 600], [800, 350]);

		expect(findDisorder(interleaved, PAGE)).toEqual([]);
	});

	it("allows a two-column grid read row by row, even beside a backwards jump", () => {
		const grid = sequence(
			[0, 2000],
			[800, 2000],
			[0, 2300],
			[800, 2300],
			[0, 2600],
			[800, 2600],
			[0, 0],
		);

		expect(findDisorder(grid, PAGE)).toEqual([]);
	});

	it("does not count a slightly higher neighbour as climbing back across the page", () => {
		const header = sequence([900, 20], [0, 18], [900, 22], [0, 16], [900, 24], [0, 14]);

		expect(findDisorder(header, PAGE)).toEqual([]);
	});

	it("ignores fixed, sticky and dialog elements interleaved at odd positions", () => {
		const stops = [
			stop(1, 0, 3000),
			stop(2, 0, 0, { excluded: true }),
			stop(3, 0, 3100),
			stop(4, 0, 0, { excluded: true }),
			stop(5, 0, 3200),
			stop(6, 0, 0, { excluded: true }),
			stop(7, 0, 3300),
		];

		expect(findDisorder(stops, PAGE)).toEqual([]);
	});

	it("ignores zero-size elements", () => {
		const stops = sequence([0, 3000], [0, 0], [0, 3100], [0, 0], [0, 3200], [0, 0], [0, 3300]).map(
			(s, i) => (i % 2 === 1 ? { ...s, rect: { ...s.rect, width: 0, height: 0 } } : s),
		);

		expect(findDisorder(stops, PAGE)).toEqual([]);
	});

	it("classifies a mirrored right-to-left page the same way", () => {
		const ltr = sequence([0, 2000], [800, 2000], [0, 2300], [800, 2150], [0, 2600], [0, 0]);
		const rtl = ltr.map((s) => ({
			...s,
			rect: { ...s.rect, x: PAGE.layoutWidth - s.rect.x - 100 },
		}));

		expect(findDisorder(rtl, { ...PAGE, direction: "rtl" }).map((t) => t.kind)).toEqual(
			findDisorder(ltr, PAGE).map((t) => t.kind),
		);
	});

	it("reads a vertical-rl page right to left, so moving left is forwards", () => {
		const page: PageGeometry = { ...PAGE, writingMode: "vertical-rl", layoutWidth: 6000 };
		const columns = sequence([5000, 0], [4000, 0], [3000, 0], [2000, 0]);

		expect(findDisorder(columns, page)).toEqual([]);
		expect(findDisorder(sequence([2000, 0], [3200, 0], [4400, 0], [5600, 0]), page)).toHaveLength(
			3,
		);
	});

	it("analyses a truncated sequence as far as it got", () => {
		expect(
			findDisorder(sequence([0, 3000], [0, 2000], [0, 1000], [0, 0]).slice(0, 3), PAGE),
		).toEqual([]);
	});
});
