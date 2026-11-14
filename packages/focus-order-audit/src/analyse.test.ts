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

	it("does not count one or two upward moves within one viewport", () => {
		expect(findDisorder(sequence([0, 3000], [0, 2300], [0, 3100]), PAGE)).toEqual([]);
		expect(findDisorder(sequence([0, 3000], [0, 2300], [0, 1600], [0, 3100]), PAGE)).toEqual([]);
	});

	it("reports a run of short climbs that together exceed a viewport as one drift", () => {
		// A 12-item list stacked in reverse: each move climbs 100px, the run 1100px.
		const reversed = sequence(
			...Array.from({ length: 12 }, (_, i): [number, number] => [0, 3000 - i * 100]),
		);
		const disorder = findDisorder([...reversed, stop(13, 0, 3200)], PAGE);

		expect(disorder).toHaveLength(1);
		expect(disorder[0]).toMatchObject({
			kind: "backwards-drift",
			from: { tabIndex: 1 },
			to: { tabIndex: 12 },
			distance: { block: -1100, inline: 0 },
			direction: "up",
			steps: 11,
		});
	});

	it("leaves alone a run of short climbs that stays within a viewport", () => {
		const shortList = sequence(
			...Array.from({ length: 8 }, (_, i): [number, number] => [0, 3000 - i * 100]),
		);

		expect(findDisorder(shortList, PAGE)).toEqual([]);
	});

	it("carries a drift across neighbours that sit level, as rows stacked in reverse do", () => {
		const rows = Array.from(
			{ length: 5 },
			(_, row): Array<[number, number]> => [
				[0, 3000 - row * 250],
				[300, 3000 - row * 250],
			],
		).flat();
		const disorder = findDisorder(sequence(...rows), PAGE);

		expect(disorder.map((t) => [t.kind, t.from.tabIndex, t.to.tabIndex])).toEqual([
			["backwards-drift", 1, 10],
		]);
	});

	it("ends a drift when focus moves on down the page", () => {
		// Two reversed groups of three, the second below the first: neither climbs a viewport.
		const groups = sequence([0, 1000], [0, 700], [0, 400], [0, 2000], [0, 1700], [0, 1400]);

		expect(findDisorder(groups, PAGE)).toEqual([]);
	});

	it("reports a single backwards jump to or from an element with a positive tabindex", () => {
		// A form at the foot of the page whose fields take focus first, then the header.
		const form = [
			stop(1, 0, 3000, { positiveTabindex: 1 }),
			stop(2, 0, 3050, { positiveTabindex: 2 }),
			stop(3, 0, 3100, { positiveTabindex: 3 }),
			stop(4, 0, 0),
			stop(5, 0, 1500),
		];
		const disorder = findDisorder(form, PAGE);

		expect(disorder.map((t) => [t.kind, t.from.tabIndex, t.to.tabIndex])).toEqual([
			["backwards-jump", 3, 4],
		]);
		expect(disorder[0]?.distance.block).toBe(-3100);
		expect(
			findDisorder(
				form.map(({ positiveTabindex, ...rest }) => rest),
				PAGE,
			),
		).toEqual([]);
	});

	it("does not report a positive tabindex that causes no backwards jump", () => {
		const skipLink = [stop(1, 0, 0, { positiveTabindex: 1 }), stop(2, 0, 100), stop(3, 0, 2000)];

		expect(findDisorder(skipLink, PAGE)).toEqual([]);
	});

	it("allows tall columns read one after the other, each starting level with the last", () => {
		// Four 4,000px columns of links below a header: every wrap climbs five viewports.
		const header: Array<[number, number]> = [
			[0, 0],
			[200, 0],
		];
		const columns = Array.from({ length: 4 }, (_, column) =>
			Array.from({ length: 41 }, (_, row): [number, number] => [column * 250, 200 + row * 100]),
		).flat();

		expect(findDisorder(sequence(...header, ...columns), PAGE)).toEqual([]);
	});

	it("allows the next column to start below a logo that heads the first", () => {
		const logo: Array<[number, number]> = [[0, 0]];
		const columns = Array.from({ length: 3 }, (_, column) =>
			Array.from({ length: 30 }, (_, row): [number, number] => [column * 300, 400 + row * 100]),
		).flat();

		expect(findDisorder(sequence(...logo, ...columns), PAGE)).toEqual([]);
	});

	it("still reports climbs that land above where the column just read began", () => {
		const stops = sequence(
			[0, 4000],
			[0, 5000],
			[250, 2000],
			[250, 3500],
			[500, 1000],
			[500, 2300],
			[750, 0],
		);

		expect(findDisorder(stops, PAGE).map((t) => t.kind)).toEqual([
			"backwards-jump",
			"backwards-jump",
			"backwards-jump",
		]);
	});

	it("does not take a climb back along the line for a column wrap", () => {
		const stops = sequence(
			[750, 0],
			[750, 2000],
			[500, 0],
			[500, 2000],
			[250, 0],
			[250, 2000],
			[0, 0],
		);

		expect(findDisorder(stops, PAGE)).toHaveLength(3);
	});

	it("recognises column wraps on right-to-left and vertical pages", () => {
		const ltr = Array.from({ length: 4 }, (_, column) =>
			Array.from({ length: 30 }, (_, row): [number, number] => [column * 250, row * 100]),
		).flat();
		const rtl = ltr.map(([x, y], i) => stop(i + 1, PAGE.layoutWidth - x - 100, y));
		// vertical-rl: lines run top to bottom and columns of lines stack right to left, so a "column"
		// of content is a row across the page and the wrap returns to the right-hand edge.
		const page: PageGeometry = { ...PAGE, writingMode: "vertical-rl", layoutWidth: 6000 };
		const vertical = ltr.map(([x, y], i) => ({
			...stop(i + 1, page.layoutWidth - y - 20, x),
			rect: { x: page.layoutWidth - y - 20, y: x, width: 20, height: 100 },
		}));

		expect(findDisorder(rtl, { ...PAGE, direction: "rtl" })).toEqual([]);
		expect(findDisorder(vertical, page)).toEqual([]);
		// The same stops are disorder when the page says it reads the other way.
		expect(findDisorder(rtl, PAGE)).not.toEqual([]);
	});

	it("never takes a move to or from a positive tabindex for a column wrap", () => {
		// A sidebar of 20 links given tabindex 1 to 20 takes focus first, then the header beside it.
		const sidebar = Array.from({ length: 20 }, (_, i) =>
			stop(i + 1, 0, 100 + i * 60, { positiveTabindex: i + 1 }),
		);
		const page = [...sidebar, stop(21, 300, 0), stop(22, 300, 100), stop(23, 300, 1500)];
		const disorder = findDisorder(page, PAGE);

		expect(disorder.map((t) => [t.kind, t.from.tabIndex, t.to.tabIndex])).toEqual([
			["backwards-jump", 20, 21],
		]);

		// Level with the sidebar's first link, the header would be the next column for links that
		// keep the source order, but not for links a positive tabindex put first.
		const level = [...sidebar, stop(21, 300, 100), stop(22, 300, 200), stop(23, 300, 1500)];

		expect(findDisorder(level, PAGE).map((t) => t.kind)).toEqual(["backwards-jump"]);
		expect(
			findDisorder(
				level.map(({ positiveTabindex, ...rest }) => rest),
				PAGE,
			),
		).toEqual([]);
	});

	it("reports columns that each start well above the one before", () => {
		// Each column begins 60px higher than the last: three times an element's height.
		const columns = Array.from({ length: 4 }, (_, column) =>
			Array.from({ length: 16 }, (_, row): [number, number] => [
				column * 250,
				180 - column * 60 + row * 100,
			]),
		).flat();

		expect(findDisorder(sequence(...columns), PAGE).map((t) => t.kind)).toEqual([
			"backwards-jump",
			"backwards-jump",
			"backwards-jump",
		]);
	});

	it("allows the next column's first link to sit a line above the first link of the last", () => {
		const columns = Array.from({ length: 4 }, (_, column) =>
			Array.from({ length: 16 }, (_, row): [number, number] => [
				column * 250,
				60 - column * 20 + row * 100,
			]),
		).flat();

		expect(findDisorder(sequence(...columns), PAGE)).toEqual([]);
	});

	it("allows tall columns of text whose links sit at different points along their lines", () => {
		// Four columns of 60 lines, a link on each line, alternately at the start and middle of it.
		const columns = Array.from({ length: 4 }, (_, column) =>
			Array.from({ length: 60 }, (_, line): [number, number] => [
				column * 250 + (line % 2) * 120,
				200 + line * 30,
			]),
		).flat();

		expect(findDisorder(sequence([0, 0], ...columns), PAGE)).toEqual([]);
	});

	it("allows a grid filled column by column whose cards hold two controls side by side", () => {
		const cards = Array.from({ length: 4 }, (_, column) =>
			Array.from(
				{ length: 12 },
				(_, row): Array<[number, number]> => [
					[column * 240, row * 100],
					[column * 240 + 110, row * 100],
				],
			).flat(),
		).flat();

		expect(findDisorder(sequence(...cards), PAGE)).toEqual([]);
	});

	it("carries a drift across cards that each hold two stacked controls", () => {
		// A feed of 20 cards stacked in reverse: a title link, then a reply button 100px below it.
		const feed = Array.from(
			{ length: 20 },
			(_, card): Array<[number, number]> => [
				[0, 3000 - card * 150],
				[0, 3100 - card * 150],
			],
		).flat();
		const disorder = findDisorder(sequence(...feed), PAGE);

		expect(disorder.map((t) => [t.kind, t.from.tabIndex, t.to.tabIndex])).toEqual([
			["backwards-drift", 2, 39],
		]);
		expect(disorder[0]?.distance.block).toBe(-2950);
	});

	it("does not report a page that only ever steps down, with the odd field a shade higher", () => {
		const steps = Array.from({ length: 150 }, (_, i): [number, number] => [
			i % 10 === 9 ? 300 : 0,
			i * 20 - (i % 10 === 9 ? 22 : 0),
		]);

		expect(findDisorder(sequence(...steps), PAGE)).toEqual([]);
	});

	it("finds a reversed list that follows a long stretch of closely spaced links", () => {
		const above = Array.from({ length: 150 }, (_, i): [number, number] => [0, i * 20]);
		const reversed = Array.from({ length: 12 }, (_, i): [number, number] => [0, 4200 - i * 100]);

		expect(
			findDisorder(sequence(...above, ...reversed), PAGE).map((t) => [
				t.kind,
				t.from.tabIndex,
				t.to.tabIndex,
			]),
		).toEqual([["backwards-drift", 151, 162]]);
	});

	it("says which way focus went on screen", () => {
		const page: PageGeometry = { ...PAGE, writingMode: "vertical-rl", layoutWidth: 6000 };
		const disorder = findDisorder(sequence([2000, 0], [3200, 0], [4400, 0], [5600, 0]), page);

		expect(disorder.map((t) => t.direction)).toEqual(["right", "right", "right"]);
		expect(disorder.map((t) => t.distance.block)).toEqual([-1200, -1200, -1200]);
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
