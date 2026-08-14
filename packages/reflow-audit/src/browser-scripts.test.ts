// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
	computeDocumentOverflowPx,
	isExemptElement,
	measureReflowScript,
	ROUNDING_TOLERANCE,
	SCROLLBAR_TOLERANCE,
	scrollableDocumentOverflowPx,
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

function mockBox(
	target: Element,
	sizes: { scrollWidth: number; clientWidth: number },
): void {
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

afterEach(() => {
	document.body.innerHTML = "";
	document.body.removeAttribute("style");
	document.documentElement.removeAttribute("style");
});

describe("computeDocumentOverflowPx", () => {
	it("uses the larger of documentElement and body overflow", () => {
		expect(
			computeDocumentOverflowPx(
				{ scrollWidth: 330, clientWidth: 320 },
				{ scrollWidth: 900, clientWidth: 320 },
			),
		).toBe(580);
	});

	it("detects overflow on body when documentElement does not overflow", () => {
		expect(
			computeDocumentOverflowPx(
				{ scrollWidth: 320, clientWidth: 320 },
				{ scrollWidth: 800, clientWidth: 320 },
			),
		).toBe(480);
	});

	it("clamps negative overflow to zero", () => {
		expect(
			computeDocumentOverflowPx(
				{ scrollWidth: 300, clientWidth: 320 },
				{ scrollWidth: 310, clientWidth: 320 },
			),
		).toBe(0);
	});
});

describe("scrollableDocumentOverflowPx", () => {
	it("ignores overflow when the viewport clips with overflow-x hidden", () => {
		expect(
			scrollableDocumentOverflowPx(
				{ scrollWidth: 1200, clientWidth: 320, overflowX: "visible" },
				{ scrollWidth: 1200, clientWidth: 320, overflowX: "hidden" },
			),
		).toBe(0);
	});

	it("counts overflow on body when html is hidden and body is a scroller", () => {
		expect(
			scrollableDocumentOverflowPx(
				{ scrollWidth: 320, clientWidth: 320, overflowX: "hidden" },
				{ scrollWidth: 1200, clientWidth: 320, overflowX: "auto" },
			),
		).toBe(880);
	});
});

describe("isExemptElement", () => {
	it("exempts a data table", () => {
		document.body.innerHTML = `<table id="data"><tr><td>a</td></tr></table>`;
		expect(isExemptElement(document.getElementById("data") as Element)).toBe(
			true,
		);
	});

	it("does not exempt a layout table with role=presentation", () => {
		document.body.innerHTML = `<table id="layout" role="presentation"><tr><td>a</td></tr></table>`;
		expect(isExemptElement(document.getElementById("layout") as Element)).toBe(
			false,
		);
	});

	it("does not exempt a layout table with role=none", () => {
		document.body.innerHTML = `<table id="layout" role="none"><tr><td>a</td></tr></table>`;
		expect(isExemptElement(document.getElementById("layout") as Element)).toBe(
			false,
		);
	});

	it("exempts ARIA tables, grids, media, and toolbars", () => {
		document.body.innerHTML = `
			<div id="aria-table" role="table"></div>
			<div id="grid" role="grid"></div>
			<div id="treegrid" role="treegrid"></div>
			<svg id="chart"></svg>
			<canvas id="game"></canvas>
			<video id="clip"></video>
			<img id="map" alt="">
			<iframe id="frame"></iframe>
			<embed id="plugin">
			<div id="tools" role="toolbar"></div>
			<div id="slide" aria-roledescription="slide"></div>
		`;

		for (const id of [
			"aria-table",
			"grid",
			"treegrid",
			"chart",
			"game",
			"clip",
			"map",
			"frame",
			"plugin",
			"tools",
			"slide",
		]) {
			expect(isExemptElement(document.getElementById(id) as Element), id).toBe(
				true,
			);
		}
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
		expect(measure.offenders[0]?.overflowPx).toBeGreaterThan(
			ROUNDING_TOLERANCE,
		);
		expect(measure.explainedByExempt).toBe(false);
	});

	it("excludes an overflowing cell inside a data table", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 800, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 800, clientWidth: 320 });
		document.body.innerHTML = `
			<table id="data">
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

		expect(measure.offenders.some((o) => o.selector.includes("layout"))).toBe(
			true,
		);
		expect(measure.explainedByExempt).toBe(false);
	});

	it("skips off-screen, aria-hidden, zero-area, and position:fixed elements", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 320, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 320, clientWidth: 320 });
		document.body.innerHTML = `
			<div id="off-left">menu</div>
			<div id="hidden" aria-hidden="true">hidden</div>
			<div id="empty">empty</div>
			<div id="fixed">fixed</div>
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
		const fixed = document.getElementById("fixed") as HTMLElement;
		fixed.style.position = "fixed";
		mockRect(fixed, { width: 500, height: 40 });

		const measure = measureReflowScript();

		expect(measure.offenders).toEqual([]);
	});

	it("skips an element fully contained in a viewport-fitting overflow-x scroller", () => {
		mockInnerWidth(320);
		mockBox(document.documentElement, { scrollWidth: 320, clientWidth: 320 });
		mockBox(document.body, { scrollWidth: 320, clientWidth: 320 });
		document.body.innerHTML = `
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

		expect(measure.offenders.some((o) => o.selector.includes("wide"))).toBe(
			true,
		);
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

		expect(
			measure.offenders.some((o) => o.reason === "fixed-width-container"),
		).toBe(true);
	});
});

describe("tolerances", () => {
	it("exposes a 2px rounding tolerance and a 20px scrollbar band", () => {
		expect(ROUNDING_TOLERANCE).toBe(2);
		expect(SCROLLBAR_TOLERANCE).toBe(20);
	});
});
