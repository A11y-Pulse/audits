// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	applyOverrideScript,
	type BaselineConfig,
	type BaselinePayload,
	collectBaselineScript,
	describeFindingsScript,
	FREEZE_CSS,
	findOverlapPairs,
	MAX_TEXT_RECTS,
	OVERRIDE_CSS,
	remeasureScript,
	restoreAndVerifyScript,
} from "./browser-scripts";
import type { CandidateSnapshot } from "./result";

/**
 * These tests run the scripts that are injected into the page, in a DOM with no layout engine.
 * Geometry is therefore supplied by hand: `place` gives an element its box, and the text inside an
 * element occupies that box unless `placeText` says otherwise. What a real engine makes of real
 * markup is covered by the integration suite.
 */

type Box = { x: number; y: number; width: number; height: number };

const CONFIG: BaselineConfig = {
	limit: 500,
	freezeCss: FREEZE_CSS,
	overrideCss: OVERRIDE_CSS,
	maxTextRects: MAX_TEXT_RECTS,
};

const textBoxes = new WeakMap<Element, Box[]>();
const originalGetClientRects = Range.prototype.getClientRects;

function domRect(box: Box): DOMRect {
	return {
		...box,
		left: box.x,
		top: box.y,
		right: box.x + box.width,
		bottom: box.y + box.height,
		toJSON() {
			return {};
		},
	} as DOMRect;
}

function place(
	el: Element,
	box: Box,
	extra: { border?: number; scrollWidth?: number; scrollHeight?: number } = {},
): void {
	const border = extra.border ?? 0;
	const clientWidth = box.width - 2 * border;
	const clientHeight = box.height - 2 * border;

	el.getBoundingClientRect = () => domRect(box);

	for (const [name, value] of Object.entries({
		clientLeft: border,
		clientTop: border,
		clientWidth,
		clientHeight,
		scrollWidth: extra.scrollWidth ?? clientWidth,
		scrollHeight: extra.scrollHeight ?? clientHeight,
	})) {
		Object.defineProperty(el, name, { configurable: true, value });
	}
}

function placeText(el: Element, ...lines: Box[]): void {
	textBoxes.set(el, lines);
}

function byId(id: string): HTMLElement {
	return document.getElementById(id) as HTMLElement;
}

/** Give every element under `root` the same small box, for tests that are not about geometry. */
function placeAll(root: ParentNode = document.body): void {
	for (const el of Array.from(root.querySelectorAll("*"))) {
		place(el, { x: 0, y: 0, width: 200, height: 20 });
	}
}

/** Selector of each candidate, in the order the page reported them. */
function selectorsOf(payload: { candidates: CandidateSnapshot[] }): string[] {
	const described = describeFindingsScript({
		elements: payload.candidates.map((candidate) => candidate.index),
		clippers: [],
	});

	return described.elements.map((element) => element.selector);
}

function clipperSelector(index: number | null): string | null {
	if (index === null) {
		return null;
	}

	return describeFindingsScript({ elements: [], clippers: [index] }).clippers[0]?.selector ?? null;
}

/** Stylesheets the audit has added to a document or shadow root, by either route. */
function injectedCount(root: Document | ShadowRoot): number {
	const adopted = root instanceof ShadowRoot ? root.adoptedStyleSheets.length : 0;

	return adopted + root.querySelectorAll("style[data-a11y-pulse]").length;
}

async function baseline(overrides: Partial<BaselineConfig> = {}): Promise<BaselinePayload> {
	return collectBaselineScript({ ...CONFIG, ...overrides });
}

beforeEach(() => {
	Range.prototype.getClientRects = function getClientRects(this: Range) {
		const el = this.startContainer.parentElement;

		if (!el) {
			return [] as unknown as DOMRectList;
		}

		const lines = textBoxes.get(el) ?? [el.getBoundingClientRect()];

		return lines.map(domRect) as unknown as DOMRectList;
	};
});

afterEach(async () => {
	await restoreAndVerifyScript();
	document.body.innerHTML = "";
	Range.prototype.getClientRects = originalGetClientRects;
});

describe("collectBaselineScript: candidates", () => {
	it("includes elements with a non-whitespace direct text node", async () => {
		document.body.innerHTML = `<p id="copy">Hello world</p>`;
		placeAll();

		expect(selectorsOf(await baseline())).toEqual(["#copy"]);
	});

	it("rejects whitespace-only text nodes", async () => {
		document.body.innerHTML = `<p id="empty">   \n\t  </p>`;
		placeAll();

		expect((await baseline()).candidates).toEqual([]);
	});

	it("rejects wrappers that only contain element children", async () => {
		document.body.innerHTML = `<div id="wrap"><span id="inner">Hello</span></div>`;
		placeAll();

		expect(selectorsOf(await baseline())).toEqual(["#inner"]);
	});

	it("rejects display none and visibility hidden", async () => {
		document.body.innerHTML = `
			<p id="gone" style="display:none">Hidden</p>
			<p id="invisible" style="visibility:hidden">Invisible</p>
			<p id="ok">Visible</p>
		`;
		placeAll();

		expect(selectorsOf(await baseline())).toEqual(["#ok"]);
	});

	it("rejects elements with no box", async () => {
		document.body.innerHTML = `<p id="flat">Text</p><p id="ok">Text</p>`;
		place(byId("flat"), { x: 0, y: 0, width: 0, height: 0 });
		place(byId("ok"), { x: 0, y: 0, width: 200, height: 20 });

		expect(selectorsOf(await baseline())).toEqual(["#ok"]);
	});

	it("skips script and style elements even though they hold text", async () => {
		document.body.innerHTML = `<script id="js">var x = 1;</script><style id="css">p{}</style><p id="ok">Text</p>`;
		placeAll();

		expect(selectorsOf(await baseline())).toEqual(["#ok"]);
	});

	it("walks open shadow roots", async () => {
		document.body.innerHTML = `<div id="host"></div>`;
		const shadow = byId("host").attachShadow({ mode: "open" });
		shadow.innerHTML = `<p id="inside">Shadow text</p>`;
		place(byId("host"), { x: 0, y: 0, width: 200, height: 20 });
		placeAll(shadow);

		expect(selectorsOf(await baseline())).toEqual(["#inside"]);
	});

	it("stops at the candidate limit, in document order, and says it did", async () => {
		document.body.innerHTML = `<p id="a">A</p><p id="b">B</p><p id="c">C</p>`;
		placeAll();

		const capped = await baseline({ limit: 2 });

		expect(selectorsOf(capped)).toEqual(["#a", "#b"]);
		expect(capped.limitReached).toBe(true);
	});

	it("does not report the limit as reached when the page has exactly that many candidates", async () => {
		document.body.innerHTML = `<p id="a">A</p><p id="b">B</p><div><i></i></div>`;
		placeAll();

		const whole = await baseline({ limit: 2 });

		expect(whole.candidates).toHaveLength(2);
		expect(whole.limitReached).toBe(false);
	});

	it("leaves selector and html to be looked up for findings only", async () => {
		document.body.innerHTML = `<p id="copy" class="lede">Hello world</p>`;
		place(byId("copy"), { x: 10, y: 30, width: 200, height: 20 });

		const { candidates } = await baseline();

		expect(candidates[0]).toMatchObject({ index: 0, selector: "", html: "" });
		expect(describeFindingsScript({ elements: [0], clippers: [] }).elements).toEqual([
			{
				index: 0,
				selector: "#copy",
				html: '<p id="copy" class="lede"></p>',
				rect: { x: 10, y: 30, width: 200, height: 20 },
				overflowX: "visible",
				overflowY: "visible",
				truncates: false,
				visible: true,
			},
		]);
	});

	it("marks a candidate that moves between two frames as unstable", async () => {
		document.body.innerHTML = `<p id="ticker">Moving</p><p id="still">Still</p>`;
		placeAll();

		let x = 0;
		byId("ticker").getBoundingClientRect = () => {
			x += 40;

			return domRect({ x, y: 0, width: 200, height: 20 });
		};

		const { candidates } = await baseline();

		expect(candidates.map((candidate) => candidate.unstable)).toEqual([true, false]);
	});
});

describe("collectBaselineScript: clipping", () => {
	it("records one box per line of text and no clipping when nothing clips", async () => {
		document.body.innerHTML = `<p id="copy">Two lines of text</p>`;
		place(byId("copy"), { x: 0, y: 0, width: 200, height: 40 });
		placeText(
			byId("copy"),
			{ x: 0, y: 0, width: 200, height: 18 },
			{ x: 0, y: 20, width: 90, height: 18 },
		);

		const [candidate] = (await baseline()).candidates;

		expect(candidate).toMatchObject({
			textRects: [
				{ x: 0, y: 0, width: 200, height: 18 },
				{ x: 0, y: 20, width: 90, height: 18 },
			],
			clippedXPx: 0,
			clippedYPx: 0,
			clipperXIndex: null,
			clipperYIndex: null,
		});
	});

	it("measures text against an outer clipping box when an inner one also clips", async () => {
		document.body.innerHTML = `
			<div id="card" style="overflow:hidden">
				<div id="body" style="overflow:hidden"><p id="copy">Text</p></div>
			</div>
		`;
		place(byId("card"), { x: 0, y: 0, width: 300, height: 80 });
		// The inner wrapper grows with its text, so the text never leaves it.
		place(byId("body"), { x: 0, y: 0, width: 300, height: 96 });
		place(byId("copy"), { x: 0, y: 0, width: 300, height: 96 });

		const [candidate] = (await baseline()).candidates;

		expect(candidate?.clippedYPx).toBe(16);
		expect(clipperSelector(candidate?.clipperYIndex ?? null)).toBe("#card");
		expect(candidate?.clippedXPx).toBe(0);
	});

	it("measures against the padding box, inside the clipping element's border", async () => {
		document.body.innerHTML = `<div id="card" style="overflow:hidden"><p id="copy">Text</p></div>`;
		place(byId("card"), { x: 0, y: 0, width: 300, height: 80 }, { border: 5 });
		place(byId("copy"), { x: 5, y: 5, width: 290, height: 73 });

		const [candidate] = (await baseline()).candidates;

		// The card shows y 5 to 75; the text runs to 78.
		expect(candidate?.clippedYPx).toBe(3);
	});

	it("scales the clipping box by the transform it is drawn under", async () => {
		document.body.innerHTML = `<div id="card" style="overflow:hidden"><p id="copy">Text</p></div>`;
		// Laid out at 300x40 and drawn at one and a half times that.
		place(byId("card"), { x: 0, y: 0, width: 300, height: 40 });
		byId("card").getBoundingClientRect = () => domRect({ x: 0, y: 0, width: 450, height: 60 });
		Object.defineProperty(byId("card"), "offsetWidth", { configurable: true, value: 300 });
		Object.defineProperty(byId("card"), "offsetHeight", { configurable: true, value: 40 });
		place(byId("copy"), { x: 0, y: 0, width: 450, height: 54 });

		// The text ends at 54, inside the 60 the card shows, though past the 40 it is laid out at.
		expect((await baseline()).candidates[0]).toMatchObject({ clippedXPx: 0, clippedYPx: 0 });

		place(byId("copy"), { x: 0, y: 0, width: 450, height: 69 });

		expect((await applyOverrideScript(0)).candidates[0]).toMatchObject({
			clippedXPx: 0,
			clippedYPx: 9,
		});
	});

	it("scales a clipping box's border along with it", async () => {
		document.body.innerHTML = `<div id="card" style="overflow:hidden"><p id="copy">Text</p></div>`;
		// A 5px border around a 290x30 padding box, all drawn at twice the size.
		place(byId("card"), { x: 0, y: 0, width: 300, height: 40 }, { border: 5 });
		byId("card").getBoundingClientRect = () => domRect({ x: 0, y: 0, width: 600, height: 80 });
		Object.defineProperty(byId("card"), "offsetWidth", { configurable: true, value: 300 });
		Object.defineProperty(byId("card"), "offsetHeight", { configurable: true, value: 40 });
		place(byId("copy"), { x: 10, y: 10, width: 580, height: 66 });

		// The card shows y 10 to 70; the text runs to 76.
		expect((await baseline()).candidates[0]).toMatchObject({ clippedXPx: 0, clippedYPx: 6 });
	});

	it("records each line as far as the clipping ancestors leave it showing", async () => {
		document.body.innerHTML = `
			<div id="card" style="overflow:hidden"><p id="copy">Text</p></div>
			<p id="free">Text</p>`;
		place(byId("card"), { x: 0, y: 0, width: 300, height: 50 });
		place(byId("copy"), { x: 0, y: 0, width: 360, height: 80 });
		placeText(
			byId("copy"),
			{ x: 0, y: 0, width: 360, height: 18 },
			{ x: 0, y: 40, width: 200, height: 18 },
			{ x: 0, y: 60, width: 200, height: 18 },
		);
		place(byId("free"), { x: 0, y: 60, width: 200, height: 18 });

		const [copy, free] = (await baseline()).candidates;

		expect(copy?.textRects).toHaveLength(3);
		// Cut short on the right, cut through at the bottom, and hidden altogether.
		expect(copy?.visibleTextRects).toEqual([
			{ x: 0, y: 0, width: 300, height: 18 },
			{ x: 0, y: 40, width: 200, height: 10 },
		]);
		expect(free?.visibleTextRects).toEqual(free?.textRects);
	});

	it("leaves out text scrolled out of a scrolling ancestor", async () => {
		document.body.innerHTML = `<div id="list" style="overflow:auto"><p id="copy">Text</p></div>`;
		place(byId("list"), { x: 0, y: 0, width: 300, height: 50 }, { scrollHeight: 200 });
		place(byId("copy"), { x: 0, y: 120, width: 200, height: 18 });

		expect((await baseline()).candidates[0]).toMatchObject({ visibleTextRects: [], clippedYPx: 0 });
	});

	it("measures text cut off on the left or top as well as the right or bottom", async () => {
		document.body.innerHTML = `<div id="card" style="overflow:hidden"><p id="copy">Text</p></div>`;
		place(byId("card"), { x: 100, y: 100, width: 200, height: 50 });
		place(byId("copy"), { x: 70, y: 110, width: 100, height: 20 });

		const [candidate] = (await baseline()).candidates;

		expect(candidate).toMatchObject({ clippedXPx: 30, clippedYPx: 0 });
	});

	it("treats an element that clips its own text as the clipper", async () => {
		document.body.innerHTML = `<div id="card" style="overflow:hidden">Text</div>`;
		place(byId("card"), { x: 0, y: 0, width: 300, height: 20 });
		placeText(
			byId("card"),
			{ x: 0, y: 0, width: 200, height: 18 },
			{ x: 0, y: 24, width: 200, height: 18 },
		);

		const [candidate] = (await baseline()).candidates;

		expect(candidate?.clippedYPx).toBe(22);
		expect(clipperSelector(candidate?.clipperYIndex ?? null)).toBe("#card");
	});

	it("does not count text that can be scrolled to inside a clipped box", async () => {
		document.body.innerHTML = `
			<div id="card" style="overflow:hidden">
				<div id="log" style="overflow:auto"><p id="copy">Text</p></div>
			</div>
		`;
		place(byId("card"), { x: 0, y: 0, width: 300, height: 80 });
		place(byId("log"), { x: 0, y: 0, width: 300, height: 80 }, { scrollHeight: 200 });
		place(byId("copy"), { x: 0, y: 0, width: 300, height: 200 });

		const [candidate] = (await baseline()).candidates;

		expect(candidate).toMatchObject({ clippedXPx: 0, clippedYPx: 0 });
	});

	it("still counts a clipping box inside a scrolling one", async () => {
		document.body.innerHTML = `
			<div id="page" style="overflow:auto">
				<div id="card" style="overflow:hidden"><p id="copy">Text</p></div>
			</div>
		`;
		place(byId("page"), { x: 0, y: 0, width: 300, height: 600 });
		place(byId("card"), { x: 0, y: 0, width: 300, height: 80 });
		place(byId("copy"), { x: 0, y: 0, width: 300, height: 120 });

		expect((await baseline()).candidates[0]?.clippedYPx).toBe(40);
	});

	it("does not clip absolutely positioned text by a box it is not laid out against", async () => {
		const markup = (position: string): string => `
			<div id="stage" style="position:relative">
				<div id="wrap" style="overflow:hidden">
					<p id="menu" style="position:${position}">Menu</p>
				</div>
			</div>
		`;
		const arrange = (): void => {
			place(byId("stage"), { x: 0, y: 0, width: 300, height: 200 });
			place(byId("wrap"), { x: 0, y: 0, width: 300, height: 20 });
			place(byId("menu"), { x: 0, y: 30, width: 100, height: 20 });
		};

		document.body.innerHTML = markup("absolute");
		arrange();

		expect((await baseline()).candidates[0]?.clippedYPx).toBe(0);

		await restoreAndVerifyScript();
		document.body.innerHTML = markup("static");
		arrange();

		expect((await baseline()).candidates[0]?.clippedYPx).toBe(30);
	});

	it("re-measures without applying the override when asked to", async () => {
		document.body.innerHTML = `<div id="card" style="overflow:hidden"><p id="copy">Text</p></div>`;
		place(byId("card"), { x: 0, y: 0, width: 300, height: 40 });
		place(byId("copy"), { x: 0, y: 0, width: 300, height: 40 });

		await baseline();

		// What a narrower viewport would do to the layout.
		place(byId("copy"), { x: 0, y: 0, width: 150, height: 70 });

		const after = (await remeasureScript(0)).candidates;

		expect(after[0]).toMatchObject({ index: 0, clippedYPx: 30 });
		expect(document.querySelectorAll('style[data-a11y-pulse="ts-override"]')).toHaveLength(0);
		expect(document.querySelectorAll('style[data-a11y-pulse="ts-freeze"]')).toHaveLength(1);
	});

	it("keeps to the baseline's candidates and styles unless asked to collect again", async () => {
		document.body.innerHTML = `
			<div id="card"><p id="copy">Text</p></div>
			<p id="late" style="display:none">Text</p>`;
		place(byId("card"), { x: 0, y: 0, width: 300, height: 40 });
		place(byId("copy"), { x: 0, y: 0, width: 300, height: 70 });
		place(byId("late"), { x: 0, y: 100, width: 300, height: 20 });

		expect((await baseline()).candidates).toHaveLength(1);

		// What a media query would do: the card starts clipping, and hidden text is rendered.
		byId("card").style.overflow = "hidden";
		byId("late").style.display = "block";

		const stale = await remeasureScript(0);

		expect(stale.candidates).toHaveLength(1);
		expect(stale.candidates[0]?.clippedYPx).toBe(0);
		expect(stale.limitReached).toBeUndefined();
	});

	it("collects again under the current styles when asked to", async () => {
		document.body.innerHTML = `
			<div id="card"><p id="copy">Text</p></div>
			<p id="late" style="display:none">Text</p>
			<p id="going">Text</p>`;
		place(byId("card"), { x: 0, y: 0, width: 300, height: 40 });
		place(byId("copy"), { x: 0, y: 0, width: 300, height: 70 });
		place(byId("late"), { x: 0, y: 100, width: 300, height: 20 });
		place(byId("going"), { x: 0, y: 200, width: 300, height: 20 });

		const before = await baseline();

		expect(selectorsOf(before)).toEqual(["#copy", "#going"]);

		byId("card").style.overflow = "hidden";
		byId("late").style.display = "block";

		const after = await remeasureScript(0, true);

		// The baseline's candidates keep their indexes; text rendered only now comes after them.
		expect(selectorsOf(after)).toEqual(["#copy", "#going", "#late"]);
		expect(after.candidates.map((candidate) => candidate.index)).toEqual([0, 1, 2]);
		expect(after.limitReached).toBe(false);
		// The card's new clipping is seen.
		expect(after.candidates[0]?.clippedYPx).toBe(30);
		expect(clipperSelector(after.candidates[0]?.clipperYIndex ?? null)).toBe("#card");
	});

	it("re-reads what truncates each candidate when it collects again", async () => {
		document.body.innerHTML = `<p id="title">Text</p>`;
		place(byId("title"), { x: 0, y: 0, width: 300, height: 20 });

		expect((await baseline()).candidates[0]?.truncated).toBe(false);

		byId("title").style.cssText = "overflow:hidden;text-overflow:ellipsis;white-space:nowrap";
		place(byId("title"), { x: 0, y: 0, width: 150, height: 20 }, { scrollWidth: 300 });

		expect((await remeasureScript(0)).candidates[0]?.truncated).toBe(false);
		expect((await remeasureScript(0, true)).candidates[0]?.truncated).toBe(true);
	});

	it("says when the candidate limit cuts the second collection short", async () => {
		document.body.innerHTML = `
			<p id="first">Text</p>
			<p id="late" style="display:none">Text</p>`;
		placeAll();

		expect((await baseline({ limit: 1 })).limitReached).toBe(false);

		byId("late").style.display = "block";

		const after = await remeasureScript(0, true);

		expect(after.limitReached).toBe(true);
		expect(after.candidates).toHaveLength(1);
	});

	it("describes how a finding's element is styled now", async () => {
		document.body.innerHTML = `
			<p id="plain">Text</p>
			<p id="cut" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Text</p>
			<p id="gone" style="visibility:hidden">Text</p>`;
		placeAll();

		await baseline();

		const { elements } = describeFindingsScript({ elements: [0, 1], clippers: [] });

		expect(elements[0]).toMatchObject({ selector: "#plain", truncates: false, visible: true });
		expect(elements[1]).toMatchObject({ selector: "#cut", truncates: true, overflowX: "hidden" });
	});

	it("re-measures the same candidates after the override, reusing what cannot change", async () => {
		document.body.innerHTML = `<div id="card" style="overflow:hidden"><p id="copy">Text</p></div>`;
		place(byId("card"), { x: 0, y: 0, width: 300, height: 40 });
		place(byId("copy"), { x: 0, y: 0, width: 300, height: 40 });

		const before = (await baseline()).candidates;

		// What the spacing override would do to the layout.
		place(byId("copy"), { x: 0, y: 0, width: 300, height: 58 });

		const after = (await applyOverrideScript(0)).candidates;

		expect(before[0]?.clippedYPx).toBe(0);
		expect(after[0]).toMatchObject({
			index: 0,
			clippedYPx: 18,
			rect: { x: 0, y: 0, width: 300, height: 58 },
			fontSize: before[0]?.fontSize,
			position: before[0]?.position,
		});
		expect(clipperSelector(after[0]?.clipperYIndex ?? null)).toBe("#card");
	});
});

describe("collectBaselineScript: truncation", () => {
	function ellipsisMarkup(): void {
		document.body.innerHTML = `
			<div id="title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
				<span id="label">A long product name</span>
			</div>
		`;
		place(byId("label"), { x: 0, y: 0, width: 240, height: 20 });
	}

	it("marks text behind an active ellipsis as truncated, on the element doing the truncating", async () => {
		ellipsisMarkup();
		place(byId("title"), { x: 0, y: 0, width: 100, height: 20 }, { scrollWidth: 240 });

		const [candidate] = (await baseline()).candidates;

		expect(candidate).toMatchObject({ truncated: true, truncationOverflowPx: 140 });
		expect(clipperSelector(candidate?.truncatorIndex ?? null)).toBe("#title");
	});

	it("does not mark text as truncated when the ellipsis is set but everything fits", async () => {
		ellipsisMarkup();
		place(byId("title"), { x: 0, y: 0, width: 300, height: 20 });

		const [candidate] = (await baseline()).candidates;

		expect(candidate).toMatchObject({
			truncated: false,
			truncatorIndex: null,
			truncationOverflowPx: 0,
		});
	});

	it("re-reads the truncating element's overflow after the override", async () => {
		ellipsisMarkup();
		place(byId("title"), { x: 0, y: 0, width: 100, height: 20 }, { scrollWidth: 240 });
		await baseline();

		place(byId("title"), { x: 0, y: 0, width: 100, height: 20 }, { scrollWidth: 310 });

		expect((await applyOverrideScript(0)).candidates[0]?.truncationOverflowPx).toBe(210);
	});
});

describe("injected stylesheets", () => {
	function shadowPage(): ShadowRoot {
		document.body.innerHTML = `<p id="copy">Text</p><div id="host"></div>`;
		const shadow = byId("host").attachShadow({ mode: "open" });
		shadow.innerHTML = `<p id="inside">Shadow text</p>`;
		placeAll();
		placeAll(shadow);

		return shadow;
	}

	it("freezes motion in the document and in every open shadow root before measuring", async () => {
		const shadow = shadowPage();

		await baseline();

		expect(document.querySelectorAll('style[data-a11y-pulse="ts-freeze"]')).toHaveLength(1);
		expect(document.querySelectorAll('style[data-a11y-pulse="ts-override"]')).toHaveLength(0);
		expect(injectedCount(shadow)).toBe(1);
	});

	it("puts its stylesheet first in the document, where its cascade layer outranks the page's", async () => {
		document.head.innerHTML = `<style id="site">p { line-height: 1 !important; }</style>`;
		shadowPage();

		await baseline();
		await applyOverrideScript(0);

		expect(
			Array.from(document.head.children).map((el) => el.getAttribute("data-a11y-pulse") ?? el.id),
		).toEqual(["ts-override", "ts-freeze", "site"]);

		await restoreAndVerifyScript();
		document.head.innerHTML = "";
	});

	it("applies the override in the document and in every open shadow root", async () => {
		const shadow = shadowPage();

		await baseline();
		await applyOverrideScript(0);

		expect(document.querySelectorAll('style[data-a11y-pulse="ts-override"]')).toHaveLength(1);
		expect(injectedCount(shadow)).toBe(2);
	});

	it("does not add to a shadow root's children, which would change what :first-child matches", async () => {
		const shadow = shadowPage();

		await baseline();
		await applyOverrideScript(0);

		expect(shadow.firstElementChild?.id).toBe("inside");
	});

	it("does not stack stylesheets when run again without a restore in between", async () => {
		const shadow = shadowPage();

		await baseline();
		await applyOverrideScript(0);
		await baseline();
		await applyOverrideScript(0);

		expect(injectedCount(document)).toBe(2);
		expect(injectedCount(shadow)).toBe(2);
	});

	it("removes everything it injected on restore", async () => {
		const shadow = shadowPage();

		await baseline();
		await applyOverrideScript(0);

		expect(await restoreAndVerifyScript()).toEqual({ restored: true });
		expect(injectedCount(document)).toBe(0);
		expect(injectedCount(shadow)).toBe(0);
	});
});

describe("restoreAndVerifyScript", () => {
	it("reports restored false when an element is not back where it started", async () => {
		document.body.innerHTML = `<p id="copy">Text</p>`;
		place(byId("copy"), { x: 0, y: 0, width: 200, height: 20 });
		await baseline();
		await applyOverrideScript(0);

		place(byId("copy"), { x: 0, y: 0, width: 200, height: 30 });

		expect(await restoreAndVerifyScript()).toEqual({ restored: false });
		expect(injectedCount(document)).toBe(0);
	});

	it("does not hold a moving element against the restore", async () => {
		document.body.innerHTML = `<p id="ticker">Moving</p>`;

		let x = 0;
		byId("ticker").getBoundingClientRect = () => {
			x += 40;

			return domRect({ x, y: 0, width: 200, height: 20 });
		};

		await baseline();

		expect(await restoreAndVerifyScript()).toEqual({ restored: true });
	});

	it("removes stray stylesheets and does not throw when there is nothing to restore", async () => {
		document.head.innerHTML = `<style data-a11y-pulse="ts-override"></style>`;

		expect(await restoreAndVerifyScript()).toEqual({ restored: true });
		expect(injectedCount(document)).toBe(0);
	});

	it("leaves nothing for a later script to act on", async () => {
		document.body.innerHTML = `<p id="copy">Text</p>`;
		placeAll();
		await baseline();
		await restoreAndVerifyScript();

		expect(await applyOverrideScript(0)).toEqual({ candidates: [] });
		expect(describeFindingsScript({ elements: [0], clippers: [] }).elements).toEqual([]);
		expect(injectedCount(document)).toBe(0);
	});
});

describe("findOverlapPairs", () => {
	const base = { fontSize: 16, position: "static", unstable: false };

	it("pairs nearby rects that newly intersect, with the area and region they share", () => {
		const before = [
			{ ...base, index: 0, selector: "#a", rect: { x: 0, y: 0, width: 80, height: 16 } },
			{ ...base, index: 1, selector: "#b", rect: { x: 0, y: 20, width: 80, height: 16 } },
		];
		const after = [
			{ ...before[0]!, rect: { x: 0, y: 0, width: 80, height: 24 } },
			{ ...before[1]!, rect: { x: 0, y: 16, width: 80, height: 24 } },
		];

		expect(findOverlapPairs(before, after)).toEqual([
			{
				selector: "#a",
				overlapsWith: "#b",
				index: 0,
				otherIndex: 1,
				beforeAreaPx2: 0,
				afterAreaPx2: 640,
				rect: { x: 0, y: 16, width: 80, height: 8 },
			},
		]);
	});

	it("uses each element's lines of text when it has them, not its box", () => {
		const before = [
			{ ...base, index: 0, selector: "#a", rect: { x: 0, y: 0, width: 200, height: 20 } },
			{ ...base, index: 1, selector: "#b", rect: { x: 0, y: 22, width: 200, height: 20 } },
		];
		// The boxes now overlap by 6px, but the text inside them keeps to its own lines.
		const after = [
			{
				...before[0]!,
				rect: { x: 0, y: 0, width: 200, height: 28 },
				textRects: [{ x: 0, y: 4, width: 120, height: 18 }],
			},
			{
				...before[1]!,
				rect: { x: 0, y: 22, width: 200, height: 28 },
				textRects: [{ x: 0, y: 27, width: 120, height: 18 }],
			},
		];

		expect(findOverlapPairs(before, after)).toEqual([]);
	});

	it("compares text only as far as it shows, when told how far that is", () => {
		const before = [
			{ ...base, index: 0, selector: "#a", rect: { x: 0, y: 0, width: 200, height: 20 } },
			{ ...base, index: 1, selector: "#b", rect: { x: 0, y: 22, width: 200, height: 20 } },
		];
		// The last line of the first runs over the second, but a clipping box hides that line.
		const lines = [
			{ x: 0, y: 0, width: 200, height: 18 },
			{ x: 0, y: 24, width: 200, height: 18 },
		];
		const second = { ...before[1]!, textRects: [{ x: 0, y: 22, width: 200, height: 18 }] };

		expect(
			findOverlapPairs(before, [
				{ ...before[0]!, textRects: lines, visibleTextRects: [lines[0]!] },
				second,
			]),
		).toEqual([]);
		// Nothing showing at all is nothing to overlap, not a fall back to the full lines.
		expect(
			findOverlapPairs(before, [{ ...before[0]!, textRects: lines, visibleTextRects: [] }, second]),
		).toEqual([]);
		expect(findOverlapPairs(before, [{ ...before[0]!, textRects: lines }, second])).toHaveLength(1);
	});

	it("skips pairs that already intersected at baseline", () => {
		const before = [
			{ ...base, index: 0, selector: "#a", rect: { x: 0, y: 0, width: 80, height: 24 } },
			{ ...base, index: 1, selector: "#b", rect: { x: 0, y: 16, width: 80, height: 24 } },
		];

		expect(findOverlapPairs(before, before)).toEqual([]);
	});

	it("honours the area tolerance", () => {
		const before = [
			{ ...base, index: 0, selector: "#a", rect: { x: 0, y: 0, width: 80, height: 16 } },
			{ ...base, index: 1, selector: "#b", rect: { x: 0, y: 20, width: 80, height: 16 } },
		];
		const after = [before[0]!, { ...before[1]!, rect: { x: 78, y: 14, width: 80, height: 16 } }];

		// 2px by 2px shared: over the default 4px² only if the tolerance is lowered.
		expect(findOverlapPairs(before, after)).toEqual([]);
		expect(findOverlapPairs(before, after, 3)).toHaveLength(1);
	});
});
