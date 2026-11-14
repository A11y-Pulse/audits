// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { collectCandidatesScript, type RawCandidate } from "./browser-scripts";

const STASH_KEY = "__testStash";

function stash(): Element[] {
	return (window as unknown as Record<string, Element[]>)[STASH_KEY] ?? [];
}

/**
 * Give every element under `root` a handler property for each event named in its `data-on`.
 * happy-dom does not compile `onclick="…"` attributes into handlers the way a browser does.
 */
function wire(root: ParentNode): void {
	for (const element of Array.from(root.querySelectorAll<HTMLElement>("[data-on]"))) {
		for (const type of (element.dataset.on ?? "").split(" ")) {
			(element as unknown as Record<string, unknown>)[`on${type}`] = () => {};
		}
	}
}

function collect(html: string, focused: string[] = [], limit = 100, includeUnsignalled = false) {
	document.body.innerHTML = html;
	wire(document);

	return collectCandidatesScript(focused, STASH_KEY, limit, includeUnsignalled);
}

/** The ids of the candidates the scan returned, in order. */
function ids(candidates: RawCandidate[]): string[] {
	return candidates.map((candidate) => stash()[candidate.index]?.id ?? "");
}

beforeEach(() => {
	// happy-dom lays nothing out, so every element would otherwise count as not rendered.
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
		const wide = this.hasAttribute("data-wide");

		return {
			x: 0,
			y: 0,
			left: 0,
			top: 0,
			right: wide ? window.innerWidth : 100,
			bottom: wide ? window.innerHeight : 20,
			width: wide ? window.innerWidth : 100,
			height: wide ? window.innerHeight : 20,
			toJSON: () => ({}),
		};
	});
});

afterEach(() => {
	vi.restoreAllMocks();
	delete (window as unknown as Record<string, unknown>)[STASH_KEY];
	document.body.innerHTML = "";
});

describe("collectCandidatesScript: what counts as a candidate", () => {
	it("returns an element with an onclick handler and describes it", () => {
		const { candidates, truncated } = collect(
			'<div id="buy" class="cta" data-on="click" style="cursor: pointer">Buy   now</div><button id="real">Add</button>',
		);

		expect(ids(candidates)).toEqual(["buy"]);
		expect(candidates[0]).toMatchObject({
			index: 0,
			kind: "unreached",
			tag: "div",
			role: null,
			widgetRole: false,
			handlers: ["onclick"],
			cursorPointer: true,
			cursorSetHere: true,
			tabindex: null,
			roving: false,
			backdrop: false,
			containerLike: false,
			parent: null,
			text: "Buy now",
		});
		expect(candidates[0]?.html).toBe(
			'<div id="buy" class="cta" data-on="click" style="cursor: pointer"></div>',
		);
		expect(truncated).toBe(false);
	});

	it("sees a handler assigned as a property", () => {
		document.body.innerHTML = '<div id="buy">Buy</div>';
		(document.getElementById("buy") as HTMLElement).onmousedown = () => {};

		const { candidates } = collectCandidatesScript([], STASH_KEY, 100, false);

		expect(candidates[0]?.handlers).toEqual(["onmousedown"]);
	});

	it("returns a widget role with no tab stop, and reads only the first role token", () => {
		const { candidates } = collect('<span id="swatch" role=" Button  link">Blue</span>');

		expect(candidates[0]).toMatchObject({ role: "button", widgetRole: true });
	});

	it("notes where a pointer cursor was set, not where it was inherited", () => {
		const { candidates } = collect(
			'<div id="promo" style="cursor: pointer"><strong id="inner" style="cursor: pointer">Sale</strong></div>',
		);

		expect(ids(candidates)).toEqual(["promo"]);
	});

	it("leaves elements with no sign of being a control out unless asked for them", () => {
		const html = '<p id="copy">Free delivery</p><div id="buy" data-on="click">Buy</div>';

		expect(ids(collect(html).candidates)).toEqual(["buy"]);
		// Signalled candidates come first, whatever the document order.
		expect(ids(collect(html, [], 100, true).candidates)).toEqual(["buy", "copy"]);
	});

	it("cuts the list at the limit, dropping unsignalled elements first", () => {
		const { candidates, truncated } = collect(
			'<p id="a">A</p><p id="b">B</p><div id="buy" data-on="click">Buy</div>',
			[],
			2,
			true,
		);

		expect(ids(candidates)).toEqual(["buy", "a"]);
		expect(truncated).toBe(true);
		expect(stash()).toHaveLength(2);
	});
});

describe("collectCandidatesScript: what is left alone", () => {
	it("skips anything in the tab order and everything inside it", () => {
		const { candidates } = collect(
			'<a id="link" href="#x"><span id="inner" data-on="click">Inside</span></a>' +
				'<div id="custom" tabindex="0" data-on="click"><i id="icon" data-on="click">i</i></div>' +
				'<button id="native" data-on="click">Go</button>',
		);

		expect(candidates).toEqual([]);
	});

	it("skips a click target around something focusable", () => {
		const { candidates } = collect(
			'<li id="card" data-on="click"><h2><a id="card-link" href="#x">Summit 3</a></h2><p id="price" data-on="click">$529</p></li>',
		);

		// The card is a convenience around its link; the price inside it is still its own target.
		expect(ids(candidates)).toEqual(["price"]);
	});

	it("skips hidden, inert, disabled and removed content", () => {
		const { candidates } = collect(
			'<div id="aria" aria-hidden="true"><span id="star" data-on="click">★</span></div>' +
				'<div id="inert" inert><span id="in" data-on="click">In</span></div>' +
				'<div id="none" style="display: none" data-on="click">None</div>' +
				'<div id="off" role="button" aria-disabled="true" data-on="click">Off</div>' +
				'<button id="parked" tabindex="-1" data-on="click">Parked</button>' +
				'<button id="disabled" disabled data-on="click">Disabled</button>',
		);

		expect(candidates).toEqual([]);
	});

	it("skips children of a composite widget that manages focus itself", () => {
		const { candidates } = collect(
			'<div role="tablist"><div id="t1" role="tab" tabindex="0">One</div><div id="t2" role="tab" tabindex="-1">Two</div></div>' +
				'<div id="menu" role="menu" tabindex="0" aria-activedescendant="m1"><div id="m1" role="menuitem">Cut</div></div>' +
				'<input id="city" role="combobox" aria-controls="cities"><ul id="cities" role="listbox"><li id="akl" role="option">Auckland</li></ul>',
		);

		expect(candidates).toEqual([]);
	});

	it("returns children of a composite widget nothing can focus", () => {
		const { candidates } = collect(
			'<div id="colours" role="listbox"><div id="red" role="option">Red</div><div id="green" role="option">Green</div></div>',
		);

		expect(ids(candidates)).toEqual(["red", "green"]);
	});

	it("marks a tabindex=-1 control beside a tabbable sibling of its kind as roving", () => {
		const { candidates } = collect(
			'<ul><li id="one" tabindex="0" data-on="click">One</li><li id="two" tabindex="-1" data-on="click">Two</li></ul>' +
				'<div id="alone" tabindex="-1" data-on="click">Alone</div>',
		);

		expect(candidates.map((candidate) => [ids([candidate])[0], candidate.roving])).toEqual([
			["two", true],
			["alone", false],
		]);
	});

	it("marks an empty element covering the viewport as a backdrop", () => {
		const { candidates } = collect(
			'<div id="backdrop" data-wide data-on="click"></div><div id="hero" data-wide data-on="click">Summer sale</div>',
		);

		expect(candidates.map((candidate) => [candidate.backdrop, candidate.containerLike])).toEqual([
			[true, true],
			[false, true],
		]);
	});

	it("marks an element with many descendants as container-like", () => {
		const { candidates } = collect(
			`<div id="list" data-on="click">${"<p><span>Row</span></p>".repeat(6)}</div>`,
		);

		expect(candidates[0]).toMatchObject({ containerLike: true, text: "RowRowRowRowRowRow" });
	});
});

describe("collectCandidatesScript: labels", () => {
	it("returns a label whose control is display: none", () => {
		const { candidates } = collect(
			'<input id="gift" type="checkbox" style="display: none"><label id="gift-label" for="gift">Gift wrap</label>',
		);

		expect(ids(candidates)).toEqual(["gift-label"]);
		expect(candidates[0]?.hiddenControlLabel).toBe(true);
	});

	it("skips labels of focusable, disabled and hidden-type controls", () => {
		const { candidates } = collect(
			'<input id="news" type="checkbox"><label id="news-label" for="news" style="cursor: pointer">News</label>' +
				'<label id="wrap" data-on="click"><input id="terms" type="checkbox"> Terms</label>' +
				'<input id="old" type="checkbox" style="display: none" disabled><label id="old-label" for="old">Old</label>',
		);

		expect(candidates).toEqual([]);
	});

	it("returns a label whose control sits inside a display: none wrapper", () => {
		const { candidates } = collect(
			'<span style="display: none"><input id="gift" type="checkbox"></span><label id="gift-label" for="gift">Gift wrap</label>',
		);

		expect(ids(candidates)).toEqual(["gift-label"]);
	});

	it("skips the label of a hidden select replaced by a focusable widget beside it", () => {
		const { candidates } = collect(
			'<label id="country-label" for="country">Country</label>' +
				'<select id="country" style="display: none"><option>NZ</option></select>' +
				'<div class="chosen"><span role="combobox" tabindex="0">NZ</span></div>',
		);

		expect(candidates).toEqual([]);
	});

	it("skips the label of a hidden checkbox when a focusable checkbox uses the label as its name", () => {
		const { candidates } = collect(
			'<input id="news" type="checkbox" style="display: none">' +
				'<p><span role="checkbox" tabindex="0" aria-checked="false" aria-labelledby="other news-label"></span></p>' +
				'<label id="news-label" for="news">News</label>',
		);

		expect(candidates).toEqual([]);
	});

	it("does not take any focusable neighbour of a hidden checkbox for its stand-in", () => {
		const { candidates } = collect(
			'<button id="help" type="button">Help</button>' +
				'<input id="gift" type="checkbox" style="display: none">' +
				'<label id="gift-label" for="gift">Gift wrap</label>',
		);

		expect(ids(candidates)).toEqual(["gift-label"]);
	});

	it("takes a neighbouring custom checkbox for the stand-in of a hidden one", () => {
		const { candidates } = collect(
			'<input id="gift" type="checkbox" style="display: none">' +
				'<span id="box" role="checkbox" tabindex="0" aria-checked="false"></span>' +
				'<label id="gift-label" for="gift">Gift wrap</label>',
		);

		expect(candidates).toEqual([]);
	});
});

describe("collectCandidatesScript: focused elements", () => {
	it("says whether a focused element holds other tab stops", () => {
		const { candidates } = collect(
			'<div id="region" tabindex="0"><button id="view" type="button">View</button></div>' +
				'<div id="save" tabindex="0" data-on="click">Save</div>',
			["#region", "#view", "#save"],
		);

		expect(candidates.map((candidate) => [ids([candidate])[0], candidate.holdsTabbable])).toEqual([
			["region", true],
			["save", false],
		]);
	});

	it("returns focused elements that are not native controls, with their tab position", () => {
		const { candidates, focusedResolved } = collect(
			'<a id="link" href="#x">Link</a><div id="save" tabindex="0" data-on="click keydown">Save</div>',
			["#link", "#save", "#gone"],
		);

		expect(focusedResolved).toBe(2);
		expect(ids(candidates)).toEqual(["save"]);
		expect(candidates[0]).toMatchObject({
			kind: "focused",
			focusedAt: 1,
			handlers: ["onclick", "onkeydown"],
			tabindex: 0,
		});
	});

	it("counts an element that took focus as reachable even if it no longer looks tabbable", () => {
		const { candidates } = collect(
			'<div id="menu" data-on="click"><span id="item" data-on="click">Item</span></div>',
			["#item"],
		);

		// The item is reported as focused, and its parent holds something reachable.
		expect(candidates.map((candidate) => [ids([candidate])[0], candidate.kind])).toEqual([
			["item", "focused"],
		]);
	});

	it("resolves a selector into a shadow root", () => {
		document.body.innerHTML = '<x-card id="card"></x-card>';

		const root = (document.getElementById("card") as HTMLElement).attachShadow({ mode: "open" });
		root.innerHTML =
			'<div class="zoom" data-on="click">Zoom</div><div class="save" tabindex="0" data-on="click">Save</div>';
		wire(root);

		const { candidates } = collectCandidatesScript(["#card >>> .save"], STASH_KEY, 100, false);

		expect(
			candidates.map((candidate) => [candidate.kind, candidate.text, candidate.focusedAt]),
		).toEqual([
			["unreached", "Zoom", null],
			["focused", "Save", 0],
		]);
	});
});

describe("collectCandidatesScript: nesting", () => {
	it("points each candidate at its nearest candidate ancestor", () => {
		const { candidates } = collect(
			'<div id="outer" data-on="click"><div id="plain"><span id="inner" data-on="click">Inner</span></div></div>',
		);

		expect(ids(candidates)).toEqual(["outer", "inner"]);
		expect(candidates.map((candidate) => candidate.parent)).toEqual([null, 0]);
	});
});
