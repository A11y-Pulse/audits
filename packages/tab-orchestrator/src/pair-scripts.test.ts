// @vitest-environment happy-dom
import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	endPairScript,
	hideCaretScript,
	type PairContextPayload,
	pairContextScript,
	pairRectScript,
	pairTargetHandleScript,
	pairTargetScript,
	transitionsSettledScript,
} from "./pair-scripts";
import type { StyleSnapshot } from "./types";
import { captureUnfocusedPair } from "./unfocused-pair";

type Box = { left: number; top: number; width: number; height: number };

/** happy-dom lays nothing out, so give each element the box a browser would. */
function place(el: Element, box: Box): void {
	vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
		...box,
		x: box.left,
		y: box.top,
		right: box.left + box.width,
		bottom: box.top + box.height,
		toJSON: () => ({}),
	} as DOMRect);
}

const VISIBLE: Box = { left: 20, top: 20, width: 120, height: 24 };
const PIXEL: Box = { left: 20, top: 20, width: 1, height: 1 };

afterEach(() => {
	endPairScript();
	document.body.innerHTML = "";
	vi.restoreAllMocks();
});

describe("pairTargetScript", () => {
	it("targets the element itself when it is painted", () => {
		document.body.innerHTML = '<button id="b">Save</button>';
		const button = document.querySelector("#b") as Element;
		place(button, VISIBLE);

		expect(pairTargetScript(button)).toEqual({
			unpainted: false,
			clipTarget: "element",
			caret: false,
		});
		expect(pairTargetHandleScript()).toBe(button);
	});

	it("targets the label of an input clipped to a pixel", () => {
		document.body.innerHTML =
			'<label id="l"><input id="i" type="checkbox"><span></span> Updates</label>';
		const input = document.querySelector("#i") as Element;
		const label = document.querySelector("#l") as Element;
		place(input, PIXEL);
		place(label, VISIBLE);

		expect(pairTargetScript(input)).toMatchObject({ unpainted: true, clipTarget: "label" });
		expect(pairTargetHandleScript()).toBe(label);
	});

	it("targets a label elsewhere in the page through its for attribute", () => {
		document.body.innerHTML =
			'<div id="row"><input id="i" type="checkbox" style="opacity: 0"><label id="l" for="i"></label></div>';
		const input = document.querySelector("#i") as Element;
		const label = document.querySelector("#l") as Element;
		place(input, VISIBLE);
		place(label, VISIBLE);
		place(document.querySelector("#row") as Element, VISIBLE);

		expect(pairTargetScript(input)).toMatchObject({ unpainted: true, clipTarget: "label" });
		expect(pairTargetHandleScript()).toBe(label);
	});

	it("counts an input inside a transparent ancestor as unpainted", () => {
		document.body.innerHTML =
			'<div id="outer"><span id="hidden" style="opacity: 0"><input id="i" type="checkbox"></span></div>';
		const input = document.querySelector("#i") as Element;
		place(input, VISIBLE);
		place(document.querySelector("#hidden") as Element, VISIBLE);
		place(document.querySelector("#outer") as Element, VISIBLE);

		// The transparent wrapper is skipped too: the first ancestor that draws anything is used.
		expect(pairTargetScript(input)).toMatchObject({ unpainted: true, clipTarget: "parent" });
		expect(pairTargetHandleScript()).toBe(document.querySelector("#outer"));
	});

	it("targets the nearest visible ancestor when there is no label", () => {
		document.body.innerHTML = '<span id="star"><input id="i" type="checkbox"><span></span></span>';
		const input = document.querySelector("#i") as Element;
		place(input, { left: -9999, top: 20, width: 20, height: 20 });
		place(document.querySelector("#star") as Element, VISIBLE);

		expect(pairTargetScript(input)).toMatchObject({ unpainted: true, clipTarget: "parent" });
		expect(pairTargetHandleScript()).toBe(document.querySelector("#star"));
	});

	it("takes in the input's surroundings as well as a label that sits elsewhere", () => {
		// The indicator is drawn on the box beside the hidden input; the label is further along the row.
		document.body.innerHTML = `
			<div class="row">
				<span id="control"><input id="i" type="checkbox"><span class="box"></span></span>
				<label id="l" for="i">Receipts</label>
			</div>`;
		const input = document.querySelector("#i") as Element;
		place(input, PIXEL);
		place(document.querySelector("#control") as Element, {
			left: 20,
			top: 20,
			width: 24,
			height: 24,
		});
		place(document.querySelector("#l") as Element, { left: 104, top: 22, width: 70, height: 20 });

		expect(pairTargetScript(input)).toMatchObject({ unpainted: true, clipTarget: "label" });
		expect(pairTargetHandleScript()).toBe(document.querySelector("#l"));
		expect(pairRectScript()).toEqual({ x: 20, y: 20, width: 154, height: 24 });
	});

	it("covers only the label when it wraps the input, or when the surroundings are a page region", () => {
		document.body.innerHTML = '<label id="wrap"><input id="i" type="checkbox"> Updates</label>';
		let input = document.querySelector("#i") as Element;
		place(input, PIXEL);
		place(document.querySelector("#wrap") as Element, VISIBLE);

		pairTargetScript(input);
		expect(pairRectScript()).toEqual({ x: 20, y: 20, width: 120, height: 24 });

		document.body.innerHTML =
			'<main id="main"><input id="i" type="checkbox"><label id="l" for="i">Updates</label></main>';
		input = document.querySelector("#i") as Element;
		place(input, PIXEL);
		place(document.querySelector("#main") as Element, {
			left: 0,
			top: 0,
			width: 1200,
			height: 900,
		});
		place(document.querySelector("#l") as Element, VISIBLE);

		pairTargetScript(input);
		expect(pairRectScript()).toEqual({ x: 20, y: 20, width: 120, height: 24 });
	});

	it("gives an empty box when no pair is under way", () => {
		expect(pairRectScript()).toEqual({ x: 0, y: 0, width: 0, height: 0 });
	});

	it("keeps an unpainted element as its own target when nothing around it is visible", () => {
		document.body.innerHTML = '<input id="i" type="checkbox">';
		const input = document.querySelector("#i") as Element;
		place(input, PIXEL);

		expect(pairTargetScript(input)).toMatchObject({ unpainted: true, clipTarget: "element" });
		expect(pairTargetHandleScript()).toBe(input);
	});

	it("reports a caret for editable text fields only", () => {
		document.body.innerHTML = `
			<input id="text">
			<input id="email" type="email">
			<textarea id="area"></textarea>
			<input id="check" type="checkbox">
			<input id="readonly" readonly>
			<input id="no-caret" style="caret-color: transparent">
			<button id="button">Go</button>`;

		const caret = (id: string): boolean => {
			const el = document.querySelector(`#${id}`) as Element;
			place(el, VISIBLE);

			return pairTargetScript(el).caret;
		};

		expect(caret("text")).toBe(true);
		expect(caret("email")).toBe(true);
		expect(caret("area")).toBe(true);
		expect(caret("check")).toBe(false);
		expect(caret("readonly")).toBe(false);
		expect(caret("no-caret")).toBe(false);
		expect(caret("button")).toBe(false);
	});
});

describe("hideCaretScript and endPairScript", () => {
	it("adds one stylesheet for the capture and removes it afterwards", () => {
		document.body.innerHTML = '<input id="text">';
		const input = document.querySelector("#text") as Element;
		place(input, VISIBLE);
		const before = document.adoptedStyleSheets.length;

		pairTargetScript(input);
		hideCaretScript(input);
		hideCaretScript(input);

		expect(document.adoptedStyleSheets.length).toBe(before + 1);

		endPairScript();

		expect(document.adoptedStyleSheets.length).toBe(before);
		expect(pairTargetHandleScript()).toBeNull();
	});
});

describe("pairContextScript", () => {
	it("reads the nearest ancestors, then labels not already among them", () => {
		document.body.innerHTML = `
			<section id="far"><div id="mid"><div id="near" class="search" style="box-shadow: 0 0 0 2px red">
				<input id="i">
			</div></div></section>
			<label id="l" for="i">Search</label>`;
		const input = document.querySelector("#i") as Element;

		const context = pairContextScript(input, ["box-shadow"], 2);

		expect(context.entries.map((entry) => [entry.kind, entry.html])).toEqual([
			["ancestor", '<div id="near" class="search" style="box-shadow: 0 0 0 2px red"></div>'],
			["ancestor", '<div id="mid"></div>'],
			["label", '<label id="l" for="i"></label>'],
		]);
		expect(context.entries[0]?.styles.element["box-shadow"]).toContain("2px");
	});

	it("does not list a wrapping label twice", () => {
		document.body.innerHTML = '<label id="l"><input id="i" type="checkbox"> Updates</label>';

		const context = pairContextScript(document.querySelector("#i"), ["color"], 3);

		expect(context.entries.map((entry) => entry.kind)).toEqual(["ancestor"]);
	});

	it("marks an ancestor that holds another tab stop, since its change is not this element's alone", () => {
		document.body.innerHTML = `
			<div id="group"><button id="a">Bold</button><button id="b">Italic</button></div>
			<div id="solo"><button id="c">Publish</button><button disabled>Off</button>
				<a>No href</a><span tabindex="-1">Scripted</span><input type="hidden"></div>`;

		const shared = (id: string) =>
			pairContextScript(document.querySelector(`#${id}`), ["box-shadow"], 1).entries[0]?.shared;

		expect(shared("a")).toBe(true);
		expect(shared("b")).toBe(true);
		// Nothing else in here takes the Tab key.
		expect(shared("c")).toBeUndefined();
	});

	it("does not count the other radio buttons of the focused one's group as other tab stops", () => {
		document.body.innerHTML = `
			<fieldset id="size">
				<input id="s" type="radio" name="size"><input id="m" type="radio" name="size">
			</fieldset>
			<fieldset id="mixed">
				<input id="x" type="radio" name="colour"><input id="y" type="radio" name="finish">
			</fieldset>`;

		const shared = (id: string) =>
			pairContextScript(document.querySelector(`#${id}`), ["box-shadow"], 1).entries[0]?.shared;

		expect(shared("s")).toBeUndefined();
		expect(shared("x")).toBe(true);
	});

	it("marks an ancestor with a running animation, but not one with a transition", () => {
		document.body.innerHTML =
			'<div id="pulse"><div id="fade"><button id="b">Like</button></div></div>';
		class FakeTransition {
			playState = "running";
		}
		vi.stubGlobal("CSSTransition", FakeTransition);
		(document.querySelector("#pulse") as Element).getAnimations = () =>
			[{ playState: "running" }] as unknown as Animation[];
		(document.querySelector("#fade") as Element).getAnimations = () =>
			[new FakeTransition()] as unknown as Animation[];

		const entries = pairContextScript(document.querySelector("#b"), ["box-shadow"], 2).entries;

		expect(entries.map((entry) => entry.animating)).toEqual([undefined, true]);
		vi.unstubAllGlobals();
	});

	it("reads no surroundings when no styles are wanted", () => {
		document.body.innerHTML = '<div><input id="i"></div>';

		expect(pairContextScript(document.querySelector("#i"), [], 3).entries).toEqual([]);
	});

	it("finds the first opaque background behind the element", () => {
		document.body.innerHTML =
			'<div style="background-color: rgb(10, 20, 30)"><p><a id="a" href="#">x</a></p></div>';

		expect(pairContextScript(document.querySelector("#a"), [], 3).background).toBe(
			"rgb(10, 20, 30)",
		);
	});

	it("gives no background when an image comes first", () => {
		document.body.innerHTML =
			'<div style="background-color: rgb(10, 20, 30)"><p style="background-image: url(x.png)"><a id="a" href="#">x</a></p></div>';

		expect(pairContextScript(document.querySelector("#a"), [], 3).background).toBeNull();
	});
});

describe("transitionsSettledScript", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
		vi.useRealTimers();
	});

	it("resolves at once when no transition is running", async () => {
		document.body.innerHTML = '<button id="b">Save</button>';

		await expect(
			transitionsSettledScript(document.querySelector("#b"), 500),
		).resolves.toBeUndefined();
		await expect(transitionsSettledScript(null, 500)).resolves.toBeUndefined();
	});

	it("waits for a running transition to finish", async () => {
		document.body.innerHTML = '<button id="b">Save</button>';
		let finish: () => void = () => {};

		class FakeTransition {
			playState = "running";
			finished = new Promise<void>((resolve) => {
				finish = resolve;
			});
		}
		vi.stubGlobal("CSSTransition", FakeTransition);
		const button = document.querySelector("#b") as Element;
		button.getAnimations = () => [new FakeTransition()] as unknown as Animation[];

		let settled = false;
		const wait = transitionsSettledScript(button, 10_000).then(() => {
			settled = true;
		});

		await Promise.resolve();
		expect(settled).toBe(false);

		finish();
		await wait;
		expect(settled).toBe(true);
	});

	it("gives up after the limit when a transition never finishes", async () => {
		vi.useFakeTimers();
		document.body.innerHTML = '<button id="b">Save</button>';

		class FakeTransition {
			playState = "running";
			finished = new Promise<void>(() => {});
		}
		vi.stubGlobal("CSSTransition", FakeTransition);
		const button = document.querySelector("#b") as Element;
		button.getAnimations = () => [new FakeTransition()] as unknown as Animation[];

		let settled = false;
		const wait = transitionsSettledScript(button, 500).then(() => {
			settled = true;
		});

		await vi.advanceTimersByTimeAsync(499);
		expect(settled).toBe(false);
		await vi.advanceTimersByTimeAsync(1);
		await wait;
		expect(settled).toBe(true);
	});
});

describe("captureUnfocusedPair", () => {
	const styles = (shadow: string): StyleSnapshot => ({
		element: { "box-shadow": shadow },
		before: {},
		after: {},
	});

	/** An adaptor that answers each page script by identity, as one call per script. */
	function adaptorFor(focused: PairContextPayload, blurred: PairContextPayload): BrowserAdaptor {
		let contextCall = 0;

		return {
			// biome-ignore lint/suspicious/noExplicitAny: dispatching on script identity needs loose types
			async evaluate(fn: any): Promise<any> {
				if (fn === pairTargetScript) {
					return { unpainted: true, clipTarget: "label", caret: false };
				}

				if (fn === pairContextScript) {
					return contextCall++ === 0 ? focused : blurred;
				}

				if (fn.name === "pageDimensionsScript") {
					return { width: 800, height: 600 };
				}

				if (fn.name === "pairRectScript") {
					return { x: 100, y: 100, width: 40, height: 20 };
				}

				if (fn.name === "elementStylesScript") {
					return styles("none");
				}

				return false;
			},
			async evaluateHandle() {
				return {};
			},
			async disposeRef() {},
			async pressTab() {},
			async pressEnter() {},
			async pressKey() {},
			async screenshotClip() {
				return new Uint8Array([1]);
			},
			async ensureFocusReporting() {},
		} as unknown as BrowserAdaptor;
	}

	const options = {
		screenshotSettleDelay: 0,
		screenshotClipBuffer: 10,
		styleProps: ["box-shadow"],
	};

	it("pairs each surrounding element's focused and unfocused styles", async () => {
		const entry = (shadow: string): PairContextPayload => ({
			entries: [{ kind: "ancestor", html: '<div class="search"></div>', styles: styles(shadow) }],
			background: "rgb(255, 255, 255)",
		});

		const pair = await captureUnfocusedPair(adaptorFor(entry("blue"), entry("none")), options, {});

		expect(pair).toMatchObject({
			clipTarget: "label",
			unpainted: true,
			obstructed: false,
			caretHidden: false,
			background: "rgb(255, 255, 255)",
		});
		expect(pair.context).toEqual([
			{
				kind: "ancestor",
				html: '<div class="search">',
				focusedStyles: styles("blue"),
				unfocusedStyles: styles("none"),
			},
		]);
	});

	it("carries over whether a surrounding element is shared or animating", async () => {
		const entry = (flags: { shared?: boolean; animating?: boolean }): PairContextPayload => ({
			entries: [{ kind: "ancestor", html: "<div></div>", styles: styles("none"), ...flags }],
			background: null,
		});

		const pair = await captureUnfocusedPair(
			adaptorFor(entry({ shared: true }), entry({ animating: true })),
			options,
			{},
		);

		expect(pair.context).toEqual([
			{
				kind: "ancestor",
				html: "<div>",
				focusedStyles: styles("none"),
				unfocusedStyles: styles("none"),
				shared: true,
				animating: true,
			},
		]);
	});

	it("puts the page back and returns focus when a screenshot fails part-way", async () => {
		const empty: PairContextPayload = { entries: [], background: null };

		for (const failOn of [1, 2]) {
			const adaptor = adaptorFor(empty, empty);
			const ran: string[] = [];
			const evaluate = adaptor.evaluate.bind(adaptor);
			let shots = 0;

			// biome-ignore lint/suspicious/noExplicitAny: recording which page scripts ran
			adaptor.evaluate = (async (fn: any, ...args: any[]) => {
				ran.push(fn.name);

				return evaluate(fn, ...args);
			}) as BrowserAdaptor["evaluate"];
			adaptor.screenshotClip = async () => {
				if (++shots === failOn) {
					throw new Error("Target closed");
				}

				return new Uint8Array([1]);
			};

			await expect(captureUnfocusedPair(adaptor, options, {})).rejects.toThrow("Target closed");

			// The caret-hiding stylesheet and the pair's state come off the page, and focus goes back.
			expect(ran).toContain("endPairScript");
			expect(ran.indexOf("focusScript")).toBeGreaterThan(ran.indexOf("endPairScript"));
		}
	});

	it("still reports the screenshot failure when the page cannot be put back either", async () => {
		const empty: PairContextPayload = { entries: [], background: null };
		const adaptor = adaptorFor(empty, empty);
		const evaluate = adaptor.evaluate.bind(adaptor);

		// biome-ignore lint/suspicious/noExplicitAny: failing one page script by name
		adaptor.evaluate = (async (fn: any, ...args: any[]) => {
			if (fn.name === "endPairScript") {
				throw new Error("Execution context was destroyed");
			}

			return evaluate(fn, ...args);
		}) as BrowserAdaptor["evaluate"];
		adaptor.screenshotClip = async () => {
			throw new Error("Target closed");
		};

		await expect(captureUnfocusedPair(adaptor, options, {})).rejects.toThrow("Target closed");
	});

	it("drops surroundings that are no longer the same after blur", async () => {
		const focused: PairContextPayload = {
			entries: [
				{ kind: "ancestor", html: "<div></div>", styles: styles("blue") },
				{ kind: "label", html: "<label></label>", styles: styles("blue") },
			],
			background: null,
		};
		const blurred: PairContextPayload = {
			entries: [{ kind: "label", html: "<label></label>", styles: styles("none") }],
			background: null,
		};

		const pair = await captureUnfocusedPair(adaptorFor(focused, blurred), options, {});

		expect(pair.context).toEqual([]);
	});
});
