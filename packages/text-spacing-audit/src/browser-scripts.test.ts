// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
	collectCandidateElements,
	findNearestClippingAncestor,
	findOverlapPairs,
	injectFreezeStyles,
	injectOverrideStyles,
	isTruncationActive,
	isVisibleTextContainer,
	removeInjectedStyles,
} from "./browser-scripts";

function giveLayoutRect(el: Element, width = 200, height = 20): void {
	el.getBoundingClientRect = () =>
		({
			x: 0,
			y: 0,
			width,
			height,
			top: 0,
			left: 0,
			right: width,
			bottom: height,
			toJSON() {
				return {};
			},
		}) as DOMRect;
}

function layoutAll(root: ParentNode = document.body): void {
	for (const el of Array.from(root.querySelectorAll("*"))) {
		giveLayoutRect(el);
	}
}

afterEach(() => {
	document.body.innerHTML = "";
	removeInjectedStyles();
});

describe("collectCandidateElements", () => {
	it("includes elements with a non-whitespace direct text node", () => {
		document.body.innerHTML = `<p id="copy">Hello world</p>`;
		layoutAll();

		expect(collectCandidateElements(500).map((el) => el.id)).toEqual(["copy"]);
	});

	it("rejects whitespace-only text nodes", () => {
		document.body.innerHTML = `<p id="empty">   \n\t  </p>`;
		layoutAll();

		expect(collectCandidateElements(500)).toEqual([]);
	});

	it("rejects wrappers that only contain element children", () => {
		document.body.innerHTML = `<div id="wrap"><span id="inner">Hello</span></div>`;
		layoutAll();

		expect(collectCandidateElements(500).map((el) => el.id)).toEqual(["inner"]);
	});

	it("rejects display none and visibility hidden", () => {
		document.body.innerHTML = `
			<p id="gone" style="display:none">Hidden</p>
			<p id="invisible" style="visibility:hidden">Invisible</p>
			<p id="ok">Visible</p>
		`;
		layoutAll();

		expect(collectCandidateElements(500).map((el) => el.id)).toEqual(["ok"]);
	});

	it("rejects zero-size rects", () => {
		document.body.innerHTML = `<p id="flat">Text</p><p id="ok">Text</p>`;
		giveLayoutRect(document.getElementById("flat") as Element, 0, 0);
		giveLayoutRect(document.getElementById("ok") as Element);

		expect(collectCandidateElements(500).map((el) => el.id)).toEqual(["ok"]);
	});

	it("respects the candidate cap in document order", () => {
		document.body.innerHTML = `<p id="a">A</p><p id="b">B</p><p id="c">C</p>`;
		layoutAll();

		expect(collectCandidateElements(2).map((el) => el.id)).toEqual(["a", "b"]);
	});

	it("walks open shadow roots", () => {
		document.body.innerHTML = `<div id="host"></div>`;
		const host = document.getElementById("host") as HTMLElement;
		const shadow = host.attachShadow({ mode: "open" });
		shadow.innerHTML = `<p id="inside">Shadow text</p>`;
		giveLayoutRect(host);
		giveLayoutRect(shadow.getElementById("inside") as Element);

		expect(collectCandidateElements(500).map((el) => el.id)).toEqual([
			"inside",
		]);
	});
});

describe("isVisibleTextContainer", () => {
	it("is false for script and style elements even with text", () => {
		document.body.innerHTML = `<script id="js">var x = 1;</script><style id="css">p{}</style>`;
		layoutAll();

		expect(
			isVisibleTextContainer(document.getElementById("js") as Element),
		).toBe(false);
		expect(
			isVisibleTextContainer(document.getElementById("css") as Element),
		).toBe(false);
	});
});

describe("findNearestClippingAncestor", () => {
	it("returns the element itself when it clips", () => {
		document.body.innerHTML = `<div id="card" style="overflow:hidden">Text</div>`;
		const card = document.getElementById("card") as Element;

		expect(findNearestClippingAncestor(card)).toBe(card);
	});

	it("walks up to the nearest overflow hidden or clip ancestor", () => {
		document.body.innerHTML = `
			<div id="outer" style="overflow:hidden">
				<div id="mid">
					<p id="copy">Text</p>
				</div>
			</div>
		`;
		const copy = document.getElementById("copy") as Element;

		expect(findNearestClippingAncestor(copy)?.id).toBe("outer");
	});

	it("returns null when nothing clips", () => {
		document.body.innerHTML = `<p id="copy">Text</p>`;

		expect(
			findNearestClippingAncestor(document.getElementById("copy") as Element),
		).toBeNull();
	});
});

describe("isTruncationActive", () => {
	it("detects ellipsis truncation when content already overflows", () => {
		document.body.innerHTML = `<p id="title" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">Long title</p>`;
		const title = document.getElementById("title") as HTMLElement;
		Object.defineProperty(title, "scrollWidth", {
			configurable: true,
			value: 240,
		});
		Object.defineProperty(title, "clientWidth", {
			configurable: true,
			value: 100,
		});

		expect(isTruncationActive(title)).toBe(true);
	});

	it("is false when ellipsis is set but content fits", () => {
		document.body.innerHTML = `<p id="title" style="overflow:hidden;text-overflow:ellipsis">Short</p>`;
		const title = document.getElementById("title") as HTMLElement;
		Object.defineProperty(title, "scrollWidth", {
			configurable: true,
			value: 40,
		});
		Object.defineProperty(title, "clientWidth", {
			configurable: true,
			value: 100,
		});

		expect(isTruncationActive(title)).toBe(false);
	});
});

describe("overlap pairing", () => {
	it("pairs nearby rects that newly intersect", () => {
		const baseline = [
			{
				index: 0,
				selector: "#a",
				rect: { x: 0, y: 0, width: 80, height: 16 },
				fontSize: 16,
				position: "static",
				unstable: false,
			},
			{
				index: 1,
				selector: "#b",
				rect: { x: 0, y: 20, width: 80, height: 16 },
				fontSize: 16,
				position: "static",
				unstable: false,
			},
		];
		const after = [
			{ ...baseline[0]!, rect: { x: 0, y: 0, width: 80, height: 24 } },
			{ ...baseline[1]!, rect: { x: 0, y: 16, width: 80, height: 24 } },
		];

		expect(findOverlapPairs(baseline, after)).toEqual([
			{ selector: "#a", overlapsWith: "#b" },
		]);
	});

	it("skips pairs that already intersected at baseline", () => {
		const baseline = [
			{
				index: 0,
				selector: "#a",
				rect: { x: 0, y: 0, width: 80, height: 24 },
				fontSize: 16,
				position: "static",
				unstable: false,
			},
			{
				index: 1,
				selector: "#b",
				rect: { x: 0, y: 16, width: 80, height: 24 },
				fontSize: 16,
				position: "static",
				unstable: false,
			},
		];

		expect(findOverlapPairs(baseline, baseline)).toEqual([]);
	});
});

describe("freeze and override stylesheets", () => {
	it("injects freeze and override styles and removes them idempotently", () => {
		injectFreezeStyles();
		injectFreezeStyles();
		injectOverrideStyles();
		injectOverrideStyles();

		expect(
			document.querySelectorAll('[data-a11y-pulse="ts-freeze"]'),
		).toHaveLength(1);
		expect(
			document.querySelectorAll('[data-a11y-pulse="ts-override"]'),
		).toHaveLength(1);

		removeInjectedStyles();
		removeInjectedStyles();

		expect(document.querySelectorAll("[data-a11y-pulse]")).toHaveLength(0);
	});
});
