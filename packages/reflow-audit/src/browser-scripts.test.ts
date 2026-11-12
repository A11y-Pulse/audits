// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
	measureReflowScript,
	ROUNDING_TOLERANCE,
	readLayoutFingerprintScript,
} from "./browser-scripts";

function mockRect(
	el: Element,
	rect: { left?: number; top?: number; width: number; height: number },
): void {
	const left = rect.left ?? 0;
	const top = rect.top ?? 0;
	const width = rect.width;
	const height = rect.height;
	const right = left + width;
	const bottom = top + height;

	el.getBoundingClientRect = () =>
		({
			x: left,
			y: top,
			left,
			top,
			width,
			height,
			right,
			bottom,
			toJSON() {
				return {};
			},
		}) as DOMRect;
}

function mockBox(target: Element, sizes: { scrollWidth: number; clientWidth: number }): void {
	Object.defineProperty(target, "scrollWidth", {
		configurable: true,
		get: () => sizes.scrollWidth,
	});
	Object.defineProperty(target, "clientWidth", {
		configurable: true,
		get: () => sizes.clientWidth,
	});
}

function mockInnerWidth(width: number): void {
	Object.defineProperty(window, "innerWidth", {
		configurable: true,
		value: width,
	});
}

function mockScroll(x: number, y: number): void {
	Object.defineProperty(window, "scrollX", { configurable: true, value: x });
	Object.defineProperty(window, "scrollY", { configurable: true, value: y });
}

/** A 320px viewport whose document is `scrollWidth` wide. */
function mockDocument(scrollWidth: number): void {
	mockInnerWidth(320);
	mockBox(document.documentElement, { scrollWidth, clientWidth: 320 });
	mockBox(document.body, { scrollWidth, clientWidth: 320 });
}

function el(id: string): HTMLElement {
	return document.getElementById(id) as HTMLElement;
}

function reasons(measure: ReturnType<typeof measureReflowScript>): Record<string, string> {
	return Object.fromEntries(measure.offenders.map((o) => [o.selector, o.reason]));
}

afterEach(() => {
	document.body.innerHTML = "";
	document.body.removeAttribute("style");
	document.documentElement.removeAttribute("style");
	document.documentElement.removeAttribute("dir");
	mockScroll(0, 0);
});

describe("measureReflowScript document overflow", () => {
	it("uses the larger of documentElement and body overflow when both scroll", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 330, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 900, clientWidth: 320 });
		document.documentElement.style.overflowX = "auto";
		document.body.style.overflowX = "auto";

		expect(measureReflowScript().documentOverflowPx).toBe(580);
	});

	it("clamps negative overflow to zero", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 300, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 310, clientWidth: 320 });

		expect(measureReflowScript().documentOverflowPx).toBe(0);
	});

	it("ignores overflow the viewport clips with overflow-x hidden on body", () => {
		mockDocument(1200);
		document.body.style.overflowX = "hidden";

		expect(measureReflowScript().documentOverflowPx).toBe(0);
	});

	it("ignores a visible body spilling into a root element that clips with overflow-x hidden", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 1200, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 1200, clientWidth: 320 });
		document.documentElement.style.overflowX = "hidden";
		document.body.innerHTML = `<div id="wide">cut off</div>`;
		mockRect(el("wide"), { width: 1200, height: 40 });

		const measure = measureReflowScript();

		expect(measure.documentOverflowPx).toBe(0);
		expect(reasons(measure)).toEqual({ "#wide": "clipped-content" });
	});

	it("counts overflow on body when html is hidden and body is a scroller", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 320, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 1200, clientWidth: 320 });
		document.documentElement.style.overflowX = "hidden";
		document.body.style.overflowX = "auto";

		expect(measureReflowScript().documentOverflowPx).toBe(880);
	});
});

describe("measureReflowScript exemptions", () => {
	function measureWide(markup: string, id: string) {
		mockDocument(800);
		document.body.innerHTML = markup;
		mockRect(el(id), { width: 800, height: 40 });

		return measureReflowScript();
	}

	it.each([
		["a header cell", `<table id="t"><tr><th>Region</th></tr><tr><td>North</td></tr></table>`],
		["a caption", `<table id="t"><caption>Sales</caption><tr><td>North</td></tr></table>`],
		["a thead", `<table id="t"><thead><tr><td>Region</td></tr></thead></table>`],
		["a scoped cell", `<table id="t"><tr><td scope="row">North</td><td>1</td></tr></table>`],
		["role=grid", `<table id="t" role="grid"><tr><td>1</td></tr></table>`],
	])("exempts a table with %s as a data table", (_label, markup) => {
		const measure = measureWide(markup, "t");

		expect(measure.offenders).toEqual([]);
		expect(measure.explainedByExempt).toBe(true);
	});

	it("does not exempt a table with no header cells, caption or roles", () => {
		const measure = measureWide(
			`<table id="t" width="800"><tr><td>Menu</td><td>Content</td></tr></table>`,
			"t",
		);

		expect(reasons(measure)).toEqual({ "#t": "element-overflow" });
		expect(measure.explainedByExempt).toBe(false);
	});

	it("does not let a nested data table make its layout table exempt", () => {
		const measure = measureWide(
			`<table id="t"><tr><td><table><tr><th>Region</th></tr></table></td></tr></table>`,
			"t",
		);

		expect(reasons(measure)).toEqual({ "#t": "element-overflow" });
	});

	it.each(["presentation", "none"])("does not exempt a table with role=%s", (role) => {
		const measure = measureWide(`<table id="t" role="${role}"><tr><th>Menu</th></tr></table>`, "t");

		expect(reasons(measure)).toEqual({ "#t": "element-overflow" });
	});

	it.each([
		["an ARIA table", `<div id="x" role="table"></div>`],
		["a grid", `<div id="x" role="grid"></div>`],
		["a treegrid", `<div id="x" role="treegrid"></div>`],
		["a toolbar", `<div id="x" role="toolbar"></div>`],
		["a slide", `<div id="x" aria-roledescription="slide"></div>`],
		["an svg", `<svg id="x"></svg>`],
		["a canvas", `<canvas id="x"></canvas>`],
		["an embed", `<embed id="x">`],
	])("exempts %s", (_label, markup) => {
		const measure = measureWide(markup, "x");

		expect(measure.offenders).toEqual([]);
		expect(measure.explainedByExempt).toBe(true);
	});

	it.each([
		["an img", `<img id="x" alt="">`],
		["a video", `<video id="x"></video>`],
		["an iframe", `<iframe id="x"></iframe>`],
	])("reports %s wider than the viewport for review instead of exempting it", (_label, markup) => {
		const measure = measureWide(markup, "x");

		expect(reasons(measure)).toEqual({ "#x": "media-overflow" });
		expect(measure.explainedByExempt).toBe(false);
	});
});

describe("readLayoutFingerprintScript", () => {
	it("includes body scroll and client width so body-only overflow can settle", () => {
		mockBox(document.documentElement, { scrollWidth: 320, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 900, clientWidth: 320 });

		expect(readLayoutFingerprintScript()).toMatchObject({
			scrollWidth: 320,
			clientWidth: 320,
			bodyScrollWidth: 900,
			bodyClientWidth: 320,
		});
	});
});

describe("measureReflowScript offenders", () => {
	it("collects a visible element that extends past the viewport", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 500, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 500, clientWidth: 320 });
		document.body.innerHTML = `<div id="wide">wide</div>`;
		mockRect(document.getElementById("wide") as Element, {
			width: 500,
			height: 40,
		});

		const measure = measureReflowScript();

		expect(measure.documentOverflowPx).toBe(180);
		expect(measure.offenders).toHaveLength(1);
		expect(measure.offenders[0]?.selector).toContain("wide");
		expect(measure.offenders[0]?.reason).toBe("element-overflow");
		expect(measure.offenders[0]?.overflowPx).toBeGreaterThan(ROUNDING_TOLERANCE);
		expect(measure.explainedByExempt).toBe(false);
	});

	it("excludes an overflowing cell inside a data table", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 800, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 800, clientWidth: 320 });
		document.body.innerHTML = `
			<table id="data">
				<tr><th>Columns</th></tr>
				<tr><td id="cell">lots of columns</td></tr>
			</table>
		`;
		mockRect(document.getElementById("data") as Element, {
			width: 800,
			height: 40,
		});
		mockRect(document.getElementById("cell") as Element, {
			width: 800,
			height: 40,
		});

		const measure = measureReflowScript();

		expect(measure.offenders).toEqual([]);
		expect(measure.explainedByExempt).toBe(true);
	});

	it("does not treat a small exempt overflow as explaining a much larger document overflow", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 800, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 800, clientWidth: 320 });
		document.body.innerHTML = `
			<table id="data">
				<tr><th>Column</th></tr>
				<tr><td id="cell">narrow table</td></tr>
			</table>
		`;
		mockRect(document.getElementById("data") as Element, {
			width: 360,
			height: 40,
		});
		mockRect(document.getElementById("cell") as Element, {
			width: 360,
			height: 40,
		});

		const measure = measureReflowScript();

		expect(measure.documentOverflowPx).toBe(480);
		expect(measure.offenders).toEqual([]);
		expect(measure.explainedByExempt).toBe(false);
	});

	it("still records a layout table with role=presentation", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 800, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 800, clientWidth: 320 });
		document.body.innerHTML = `
			<table id="layout" role="presentation">
				<tr><td>wide layout</td></tr>
			</table>
		`;
		mockRect(document.getElementById("layout") as Element, {
			width: 800,
			height: 40,
		});

		const measure = measureReflowScript();

		expect(measure.offenders.some((o) => o.selector.includes("layout"))).toBe(true);
		expect(measure.explainedByExempt).toBe(false);
	});

	it("skips off-screen, aria-hidden and zero-area elements", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 320, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 320, clientWidth: 320 });
		document.body.innerHTML = `
			<div id="off-left">menu</div>
			<div id="hidden" aria-hidden="true">hidden</div>
			<div id="empty">empty</div>
		`;
		mockRect(document.getElementById("off-left") as Element, {
			left: -400,
			width: 300,
			height: 40,
		});
		mockRect(document.getElementById("hidden") as Element, {
			width: 500,
			height: 40,
		});
		mockRect(document.getElementById("empty") as Element, {
			width: 500,
			height: 0,
		});

		const measure = measureReflowScript();

		expect(measure.offenders).toEqual([]);
	});

	it("skips an element fully contained in a viewport-fitting overflow-x scroller", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 320, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 320, clientWidth: 320 });
		document.body.innerHTML = `
			<h1>Featured products for the autumn season</h1>
			<div id="rail" style="overflow-x: auto; width: 320px">
				<div id="slide">slide</div>
			</div>
		`;
		mockRect(document.getElementById("rail") as Element, {
			width: 320,
			height: 80,
		});
		mockRect(document.getElementById("slide") as Element, {
			width: 900,
			height: 80,
		});

		const measure = measureReflowScript();

		expect(measure.offenders).toEqual([]);
	});

	it("still records a child when the document body itself is the scroller", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 320, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 1200, clientWidth: 320 });
		document.body.style.overflowX = "auto";
		document.body.innerHTML = `<div id="wide">wide</div>`;
		mockRect(document.getElementById("wide") as Element, {
			width: 1200,
			height: 40,
		});

		const measure = measureReflowScript();

		expect(measure.offenders.some((o) => o.selector.includes("wide"))).toBe(true);
	});

	it("reports only the outermost offender in a nested chain", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 600, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 600, clientWidth: 320 });
		document.body.innerHTML = `
			<div id="outer">
				<div id="inner">inner</div>
			</div>
		`;
		mockRect(document.getElementById("outer") as Element, {
			width: 600,
			height: 80,
		});
		mockRect(document.getElementById("inner") as Element, {
			width: 580,
			height: 40,
		});

		const measure = measureReflowScript();
		const selectors = measure.offenders.map((o) => o.selector);

		expect(selectors.some((s) => s.includes("outer"))).toBe(true);
		expect(selectors.some((s) => s.includes("inner"))).toBe(false);
	});

	it("records a fixed-width container as a heuristic offender", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 400, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 400, clientWidth: 320 });
		document.body.innerHTML = `<div id="pinned">pinned</div>`;
		const pinned = document.getElementById("pinned") as HTMLElement;
		pinned.style.width = "1000px";
		mockRect(pinned, { width: 320, height: 40 });

		const measure = measureReflowScript();

		expect(measure.offenders.some((o) => o.reason === "fixed-width-container")).toBe(true);
	});
});

describe("measureReflowScript containment", () => {
	it.each(["hidden", "clip"])(
		"does not report content cut off by a viewport-fitting overflow-x: %s ancestor",
		(overflowX) => {
			mockDocument(800);
			document.body.innerHTML = `
			<table id="data"><tr><th>Region</th></tr></table>
			<div id="slider" style="overflow-x: ${overflowX}"><div id="track">slides</div></div>
		`;
			mockRect(el("data"), { width: 800, height: 40 });
			mockRect(el("slider"), { width: 320, height: 80 });
			mockRect(el("track"), { width: 1500, height: 80 });

			const measure = measureReflowScript();

			expect(measure.offenders).toEqual([]);
			expect(measure.explainedByExempt).toBe(true);
		},
	);

	it("reports the clipping ancestor itself when it is wider than the viewport", () => {
		mockDocument(1500);
		document.body.innerHTML = `<div id="slider" style="overflow-x: hidden"><div id="track">slides</div></div>`;
		mockRect(el("slider"), { width: 1500, height: 80 });
		mockRect(el("track"), { width: 1500, height: 80 });

		expect(reasons(measureReflowScript())).toEqual({ "#slider": "element-overflow" });
	});

	it("does not let a clipping ancestor contain an absolutely positioned box it is not the containing block of", () => {
		mockDocument(900);
		document.body.innerHTML = `
			<div id="card" style="overflow-x: hidden"><div id="badge" style="position: absolute">sale</div></div>
		`;
		mockRect(el("card"), { width: 320, height: 80 });
		mockRect(el("badge"), { left: 600, width: 300, height: 40 });

		expect(reasons(measureReflowScript())).toEqual({ "#badge": "element-overflow" });
	});

	it("lets a positioned clipping ancestor contain an absolutely positioned box", () => {
		mockDocument(320);
		document.body.innerHTML = `
			<div id="hero" style="overflow-x: hidden; position: relative"><div id="glow" style="position: absolute">glow</div></div>
		`;
		mockRect(el("hero"), { width: 320, height: 80 });
		mockRect(el("glow"), { left: 200, width: 400, height: 40 });

		expect(measureReflowScript().offenders).toEqual([]);
	});

	it("reports cut-off content for review when the page itself clips its overflow", () => {
		mockDocument(1200);
		document.body.style.overflowX = "hidden";
		document.body.innerHTML = `<div id="wide">cut off</div>`;
		mockRect(el("wide"), { width: 1200, height: 40 });

		const measure = measureReflowScript();

		expect(measure.documentOverflowPx).toBe(0);
		expect(reasons(measure)).toEqual({ "#wide": "clipped-content" });
		expect(measure.offenders[0]?.overflowPx).toBe(880);
	});

	it("ignores off-canvas content parked wholly beyond the edge of a page that does not scroll", () => {
		mockDocument(320);
		document.body.innerHTML = `<div id="drawer">menu</div>`;
		mockRect(el("drawer"), { left: 320, width: 280, height: 400 });

		expect(measureReflowScript().offenders).toEqual([]);
	});

	it("reports a fixed box that extends past the viewport, and not its descendants", () => {
		mockDocument(320);
		document.body.innerHTML = `<header id="bar" style="position: fixed"><nav id="links">links</nav></header>`;
		mockRect(el("bar"), { width: 1000, height: 56 });
		mockRect(el("links"), { width: 1000, height: 56 });

		expect(reasons(measureReflowScript())).toEqual({ "#bar": "clipped-content" });
	});

	it("does not report what a fixed box scrolls sideways within itself", () => {
		mockDocument(320);
		document.body.innerHTML = `
			<p>The page has plenty of text of its own, much more than the tab bar at the bottom holds.</p>
			<nav id="tabs" style="position: fixed; overflow-x: auto"><a id="last" href="/f">Settings</a></nav>
		`;
		mockRect(el("tabs"), { width: 320, height: 56 });
		mockRect(el("last"), { left: 540, width: 120, height: 56 });

		expect(measureReflowScript().offenders).toEqual([]);
	});

	it("still reports a fixed box that scrolls its overflow but is itself wider than the viewport", () => {
		mockDocument(320);
		document.body.innerHTML = `<nav id="tabs" style="position: fixed; overflow-x: auto"><a id="last" href="/f">Settings</a></nav>`;
		mockRect(el("tabs"), { width: 700, height: 56 });
		mockRect(el("last"), { left: 540, width: 120, height: 56 });

		expect(reasons(measureReflowScript())).toEqual({ "#tabs": "clipped-content" });
	});

	it("ignores a fixed off-canvas drawer and what is in it", () => {
		mockDocument(320);
		document.body.innerHTML = `<aside id="drawer" style="position: fixed"><a id="link" href="/">Home</a></aside>`;
		mockRect(el("drawer"), { left: 320, width: 280, height: 600 });
		mockRect(el("link"), { left: 336, width: 100, height: 20 });

		expect(measureReflowScript().offenders).toEqual([]);
	});

	it("reports a horizontal scroller that holds most of the page's text", () => {
		mockDocument(320);
		document.body.innerHTML = `
			<div id="app" style="overflow-x: auto"><div id="layout">All of the page's content sits in here.</div></div>
			<p>Footer</p>
		`;
		mockRect(el("app"), { width: 320, height: 600 });
		mockBox(el("app"), { scrollWidth: 1200, clientWidth: 320 });
		mockRect(el("layout"), { width: 1200, height: 600 });

		const measure = measureReflowScript();

		expect(reasons(measure)).toEqual({ "#app": "scrolling-container" });
		expect(measure.offenders[0]?.overflowPx).toBe(880);
		expect(measure.offenders[0]?.overflowing).toEqual([
			{
				selector: "#layout",
				html: '<div id="layout"></div>',
				overflowPx: 880,
				rect: { x: 0, y: 0, width: 1200, height: 600 },
			},
		]);
	});

	it("names only the outermost overflowing content of a scroller, and at most five", () => {
		mockDocument(320);
		const blocks = Array.from(
			{ length: 7 },
			(_, i) =>
				`<div id="block-${i}"><p id="inner-${i}">Most of the page's text is in here.</p></div>`,
		).join("");
		document.body.innerHTML = `<div id="app" style="overflow-x: auto">${blocks}</div>`;
		mockRect(el("app"), { width: 320, height: 600 });
		mockBox(el("app"), { scrollWidth: 600, clientWidth: 320 });

		for (let i = 0; i < 7; i++) {
			mockRect(el(`block-${i}`), { top: i * 40, width: 600, height: 40 });
			mockRect(el(`inner-${i}`), { top: i * 40, width: 600, height: 40 });
		}

		const measure = measureReflowScript();

		expect(reasons(measure)).toEqual({ "#app": "scrolling-container" });
		expect(measure.offenders[0]?.overflowing?.map((content) => content.selector)).toEqual([
			"#block-0",
			"#block-1",
			"#block-2",
			"#block-3",
			"#block-4",
		]);
	});

	it("does not report a scroller whose overflowing content is a data table", () => {
		mockDocument(320);
		document.body.innerHTML = `
			<div id="wrap" style="overflow-x: auto"><table id="data"><tr><th>Most of the text on this page is in this table</th></tr></table></div>
		`;
		mockRect(el("wrap"), { width: 320, height: 200 });
		mockRect(el("data"), { width: 900, height: 200 });

		expect(measureReflowScript().offenders).toEqual([]);
	});
});

describe("measureReflowScript coordinates", () => {
	it("measures against the document, not the scroll position", () => {
		mockDocument(800);
		mockScroll(0, 3000);
		document.body.innerHTML = `<div id="banner">banner</div>`;
		// 3000px down the page, the banner at the top has a negative viewport top.
		mockRect(el("banner"), { top: -3000, width: 800, height: 60 });

		const measure = measureReflowScript();

		expect(reasons(measure)).toEqual({ "#banner": "element-overflow" });
		expect(measure.offenders[0]?.rect).toEqual({ x: 0, y: 0, width: 800, height: 60 });
	});

	it("does not count horizontal scroll position as less overflow", () => {
		mockDocument(800);
		mockScroll(480, 0);
		document.body.innerHTML = `<div id="banner">banner</div>`;
		mockRect(el("banner"), { left: -480, width: 800, height: 60 });

		const measure = measureReflowScript();

		expect(measure.offenders[0]?.overflowPx).toBe(480);
		expect(measure.offenders[0]?.rect.x).toBe(0);
	});

	it("measures overflow past the left edge of a right-to-left page", () => {
		mockDocument(1000);
		document.body.style.direction = "rtl";
		document.body.innerHTML = `<div id="app">app</div>`;
		mockRect(el("app"), { left: -680, width: 1000, height: 80 });

		const measure = measureReflowScript();

		expect(reasons(measure)).toEqual({ "#app": "element-overflow" });
		expect(measure.offenders[0]?.overflowPx).toBe(680);
	});

	it("does not report a right-to-left page's content for reaching the right edge", () => {
		mockDocument(320);
		document.body.style.direction = "rtl";
		document.body.innerHTML = `<div id="app">app</div>`;
		mockRect(el("app"), { left: 0, width: 320, height: 80 });

		expect(measureReflowScript().offenders).toEqual([]);
	});
});

describe("measureReflowScript text overflow", () => {
	function mockTextRects(rect: { left: number; top: number; width: number; height: number }) {
		const original = Range.prototype.getBoundingClientRect;

		Range.prototype.getBoundingClientRect = () =>
			({
				...rect,
				x: rect.left,
				y: rect.top,
				right: rect.left + rect.width,
				bottom: rect.top + rect.height,
				toJSON: () => ({}),
			}) as DOMRect;

		return () => {
			Range.prototype.getBoundingClientRect = original;
		};
	}

	it("attributes text that spills out of a box which itself fits", () => {
		mockDocument(838);
		document.body.innerHTML = `<h1 id="headline" style="white-space: nowrap">A heading that will not wrap</h1>`;
		mockRect(el("headline"), { left: 16, top: 20, width: 288, height: 37 });
		mockBox(el("headline"), { scrollWidth: 822, clientWidth: 288 });
		const restore = mockTextRects({ left: 16, top: 20, width: 822, height: 37 });

		try {
			const measure = measureReflowScript();

			expect(measure.offenders).toEqual([
				{
					selector: "#headline",
					html: '<h1 id="headline" style="white-space: nowrap"></h1>',
					overflowPx: 518,
					reason: "text-overflow",
					rect: { x: 16, y: 20, width: 822, height: 37 },
				},
			]);
		} finally {
			restore();
		}
	});

	it("ignores text inside a box that scrolls its own overflow", () => {
		mockDocument(320);
		document.body.innerHTML = `<pre id="code" style="overflow-x: auto">a very long line of code</pre><p>Plenty of other text on the page so the code sample is not most of it.</p>`;
		mockRect(el("code"), { left: 16, width: 288, height: 20 });
		mockBox(el("code"), { scrollWidth: 900, clientWidth: 288 });
		const restore = mockTextRects({ left: 16, top: 0, width: 900, height: 20 });

		try {
			expect(measureReflowScript().offenders).toEqual([]);
		} finally {
			restore();
		}
	});

	it("does not blame a box whose scroll width comes from a child element", () => {
		mockDocument(800);
		document.body.innerHTML = `<main id="main"><div id="wide">wide</div></main>`;
		mockRect(el("main"), { width: 320, height: 40 });
		mockBox(el("main"), { scrollWidth: 800, clientWidth: 320 });
		mockRect(el("wide"), { width: 800, height: 40 });

		expect(reasons(measureReflowScript())).toEqual({ "#wide": "element-overflow" });
	});
});
