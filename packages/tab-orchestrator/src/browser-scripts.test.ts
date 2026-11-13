// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	awaitOwnedTimersScript,
	baselineScript,
	blurredStopScript,
	clearMarkersScript,
	documentReplacedScript,
	drainContextObserverScript,
	elementStylesScript,
	heldFocusScript,
	installContextObserverScript,
	installTabObserverScript,
	isCenterObscuredScript,
	landedHrefScript,
	markActiveElementScript,
	measureObscuringScript,
	probeActiveElementScript,
	removeTabObserverScript,
	settleScript,
	submittedFormHandleScript,
	TABBABLE_SELECTOR,
	uninstallContextObserverScript,
} from "./browser-scripts";

const MARKER = "data-test-idx";

/** Run `action` the way a focus handler on `el` would: while its focus event is being dispatched. */
function onFocusOf(el: HTMLElement, action: () => void): void {
	el.addEventListener("focus", action, { once: true });
	el.focus();
	el.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
	// `focusin` follows `focus` and bubbles to the window, which is where the dispatch ends.
	el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
	el.removeEventListener("focus", action);
}

/** A focusable element to do things on behalf of. */
function focusable(id = "actor"): HTMLElement {
	const el = document.createElement("input");

	el.id = id;
	document.body.append(el);

	return el;
}

type CheckVisibilityCarrier = {
	checkVisibility?: (options?: { checkVisibilityCSS?: boolean }) => boolean;
};

describe("baselineScript", () => {
	it("snapshots and marks at most `limit` elements", () => {
		document.body.innerHTML = Array.from(
			{ length: 6 },
			(_, i) => `<button>button ${i}</button>`,
		).join("");

		const { entries } = baselineScript(["outline-width"], MARKER, 2);

		expect(entries).toHaveLength(2);
		expect(document.querySelectorAll(`[${MARKER}]`)).toHaveLength(2);
		expect(entries.map((e) => e.index)).toEqual([0, 1]);
	});

	it("skips elements that are not in the tab order (negative tabindex)", () => {
		document.body.innerHTML = `<button>ok</button><div tabindex="-1">skip</div><button tabindex="-1">skip</button>`;

		const { entries } = baselineScript(["outline-width"], MARKER, 10);

		expect(entries).toHaveLength(1);
		expect(document.querySelectorAll(`[${MARKER}]`)).toHaveLength(1);
	});

	it("captures a page-relative rect for each element", () => {
		document.body.innerHTML = "<button>only</button>";

		const [entry] = baselineScript(["outline-width"], MARKER, 10).entries;

		expect(entry?.rect).toEqual({
			x: expect.any(Number),
			y: expect.any(Number),
			width: expect.any(Number),
			height: expect.any(Number),
		});
	});

	it("marks every element when there are fewer than `limit`", () => {
		document.body.innerHTML = `<a href="#a">first</a><button>second</button>`;

		const { entries } = baselineScript(["outline-width"], MARKER, 10);

		expect(entries).toHaveLength(2);
	});

	it("descends open shadow roots", () => {
		document.body.innerHTML = `<div id="host"></div>`;
		const host = document.getElementById("host");
		const root = (host as HTMLElement).attachShadow({ mode: "open" });
		root.innerHTML = "<button>shadow button</button>";

		const { entries } = baselineScript(["outline-width"], MARKER, 10);

		expect(entries).toHaveLength(1);
		expect(root.querySelector(`[${MARKER}]`)).not.toBeNull();
	});

	it("skips elements hidden by their own display or visibility", () => {
		document.body.innerHTML = [
			`<button style="display: none">hidden</button>`,
			`<button style="visibility: hidden">hidden</button>`,
			"<button>visible</button>",
		].join("");

		const { entries } = baselineScript(["outline-width"], MARKER, 10);

		expect(entries).toHaveLength(1);
	});
});

describe("baselineScript visibility filtering (checkVisibility)", () => {
	afterEach(() => {
		delete (Element.prototype as CheckVisibilityCarrier).checkVisibility;
	});

	it("skips checkVisibility-hidden elements so they don't consume the marker budget", () => {
		// Mimic a closed mega-menu: its links are hidden via an ancestor, which per-element
		// display/visibility checks can't see. They must not eat into the marker budget, or every
		// element tabbed after them loses its baseline.
		(Element.prototype as CheckVisibilityCarrier).checkVisibility = function (this: Element) {
			return this.closest("[data-hidden-menu]") === null;
		};

		document.body.innerHTML = [
			"<button>before menu</button>",
			`<div data-hidden-menu>${Array.from(
				{ length: 5 },
				(_, i) => `<a href="#m${i}">menu ${i}</a>`,
			).join("")}</div>`,
			`<button id="after">after menu</button>`,
		].join("");

		const { entries } = baselineScript(["outline-width"], MARKER, 3);

		expect(entries).toHaveLength(2);
		expect(document.querySelector("#after")?.hasAttribute(MARKER)).toBe(true);
		expect(document.querySelectorAll(`[data-hidden-menu] [${MARKER}]`)).toHaveLength(0);
	});

	it("asks checkVisibility to include the CSS visibility property", () => {
		const checkVisibility = vi.fn().mockReturnValue(true);
		(Element.prototype as CheckVisibilityCarrier).checkVisibility = checkVisibility;

		document.body.innerHTML = "<button>visible</button>";

		baselineScript(["outline-width"], MARKER, 10);

		expect(checkVisibility).toHaveBeenCalledWith(
			expect.objectContaining({ checkVisibilityCSS: true }),
		);
	});
});

describe("baselineScript snapshot interning", () => {
	it("returns one shared snapshot for identically-styled elements", () => {
		document.body.innerHTML = Array.from(
			{ length: 6 },
			(_, i) => `<button>button ${i}</button>`,
		).join("");

		const payload = baselineScript(["outline-width"], MARKER, 10);

		expect(payload.entries).toHaveLength(6);
		expect(payload.styles).toHaveLength(1);
		expect(payload.entries.map((e) => e.styleIndex)).toEqual([0, 0, 0, 0, 0, 0]);
	});

	it("assigns distinct snapshots to differently-styled elements", () => {
		document.body.innerHTML = [
			`<button style="outline-width: 1px">a</button>`,
			`<button style="outline-width: 2px">b</button>`,
			`<button style="outline-width: 1px">c</button>`,
			`<button style="outline-width: 2px">d</button>`,
		].join("");

		const payload = baselineScript(["outline-width"], MARKER, 10);

		expect(payload.styles).toHaveLength(2);
		expect(payload.entries.map((e) => e.styleIndex)).toEqual([0, 1, 0, 1]);
	});
});

describe("baseline snapshot DOM state", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("snapshots styles with the marker attribute applied, matching the probe", () => {
		// The probe always reads styles while the marker is present, so the baseline must too.
		// Otherwise page CSS targeting the marker attribute would register as a style change on every
		// element.
		const markerSeenDuringReads: boolean[] = [];
		vi.stubGlobal("getComputedStyle", (el: Element) => ({
			display: "inline-block",
			visibility: "visible",
			getPropertyValue: () => {
				markerSeenDuringReads.push(el.hasAttribute(MARKER));

				return "none";
			},
		}));
		document.body.innerHTML = "<button>x</button>";

		baselineScript(["outline-width"], MARKER, 10);

		expect(markerSeenDuringReads.length).toBeGreaterThan(0);
		expect(markerSeenDuringReads.every(Boolean)).toBe(true);
	});
});

describe("snapshot value truncation", () => {
	afterEach(() => {
		vi.unstubAllGlobals();
	});

	function stubComputedStyle(valueFor: (el: Element, prop: string) => string): void {
		vi.stubGlobal("getComputedStyle", (el: Element) => ({
			display: "inline-block",
			visibility: "visible",
			getPropertyValue: (prop: string) => valueFor(el, prop),
		}));
	}

	it("bounds oversized property values", () => {
		const long = `url(data:image/png;base64,${"A".repeat(20000)})`;
		stubComputedStyle((_el, prop) => (prop === "background-image" ? long : "none"));
		document.body.innerHTML = "<button>x</button>";

		const payload = baselineScript(["background-image"], MARKER, 10);
		const value = payload.styles[0]?.element["background-image"];

		expect(value).toBeTruthy();
		expect((value as string).length).toBeLessThan(600);
	});

	it("preserves inequality between distinct oversized values", () => {
		// Same length, same first 512 characters, only the tail differs, so the truncated forms must
		// still differ (via the fingerprint).
		const head = "A".repeat(600);
		stubComputedStyle((el, prop) =>
			prop === "background-image" ? head + (el.textContent === "a" ? "X" : "Y") : "none",
		);
		document.body.innerHTML = "<button>a</button><button>b</button>";

		const payload = baselineScript(["background-image"], MARKER, 10);

		expect(payload.styles).toHaveLength(2);
		expect(payload.styles[0]?.element["background-image"]).not.toBe(
			payload.styles[1]?.element["background-image"],
		);
	});

	it("truncates identically in the baseline and the focus probe", () => {
		// Asymmetric truncation would make every oversized value "differ" on focus and produce false
		// style-check passes.
		const long = `url(data:image/png;base64,${"B".repeat(20000)})`;
		stubComputedStyle((_el, prop) => (prop === "background-image" ? long : "none"));
		document.body.innerHTML = "<button>x</button>";

		const payload = baselineScript(["background-image"], MARKER, 10);
		(document.querySelector("button") as HTMLElement).focus();
		const probed = probeActiveElementScript(["background-image"], MARKER);

		expect(probed.styles.element["background-image"]).toBe(
			payload.styles[0]?.element["background-image"],
		);
	});
});

describe("probeActiveElementScript", () => {
	it("flags the focused element as an iframe", () => {
		document.body.innerHTML = `<iframe title="embed"></iframe>`;
		(document.querySelector("iframe") as HTMLElement).focus();

		const probed = probeActiveElementScript(["outline-width"], MARKER);

		expect(probed.isIframe).toBe(true);
		expect(probed.isBody).toBe(false);
	});

	it("does not flag a non-iframe control as an iframe", () => {
		document.body.innerHTML = "<button>x</button>";
		(document.querySelector("button") as HTMLElement).focus();

		const probed = probeActiveElementScript(["outline-width"], MARKER);

		expect(probed.isIframe).toBe(false);
	});

	describe("backdrop", () => {
		const backdropOf = (html: string): string | null | undefined => {
			document.body.innerHTML = html;
			(document.querySelector("#a") as HTMLElement).focus();

			return probeActiveElementScript(["outline-width"], MARKER).backdrop;
		};

		it("is the first opaque background behind the element, or white when there is none", () => {
			expect(backdropOf('<p><a id="a" href="#">x</a></p>')).toBe("rgb(255, 255, 255)");
			expect(
				backdropOf(
					'<div style="background-color: rgb(20, 33, 61)"><p><a id="a" href="#">x</a></p></div>',
				),
			).toBe("rgb(20, 33, 61)");
		});

		it("does not take the element's own fill for what is behind it", () => {
			expect(
				backdropOf(
					'<div style="background-color: rgb(20, 33, 61)"><a id="a" href="#" style="background-color: rgb(255, 0, 0)">x</a></div>',
				),
			).toBe("rgb(20, 33, 61)");
		});

		it("is unknown behind a background image", () => {
			expect(
				backdropOf('<div style="background-image: url(hero.jpg)"><a id="a" href="#">x</a></div>'),
			).toBeNull();
		});

		it("is unknown for an element positioned over other content", () => {
			// The dark layer is the link's sibling: no ancestor says what the link is painted over.
			expect(
				backdropOf(`
					<section style="position: relative">
						<div style="position: absolute; inset: 0; background-color: rgb(20, 33, 61)"></div>
						<a id="a" href="#" style="position: absolute">x</a>
					</section>`),
			).toBeNull();
		});

		it("is unknown inside a see-through positioned ancestor, and known inside an opaque one", () => {
			expect(
				backdropOf('<header style="position: fixed"><a id="a" href="#">x</a></header>'),
			).toBeNull();
			expect(
				backdropOf(
					'<header style="position: sticky; background-color: rgb(250, 250, 250)"><a id="a" href="#">x</a></header>',
				),
			).toBe("rgb(250, 250, 250)");
		});

		it("is not read when no styles are wanted", () => {
			document.body.innerHTML = '<a id="a" href="#">x</a>';
			(document.querySelector("#a") as HTMLElement).focus();

			expect(probeActiveElementScript([], MARKER)).not.toHaveProperty("backdrop");
		});
	});
});

describe("isCenterObscuredScript", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("is false for a missing element", () => {
		expect(isCenterObscuredScript(null)).toBe(false);
	});

	it("is false when the hit test lands on the element itself", () => {
		document.body.innerHTML = "<button>target</button>";
		const el = document.querySelector("button") as HTMLElement;
		document.elementFromPoint = () => el;

		expect(isCenterObscuredScript(el)).toBe(false);
	});

	it("is false when the hit test lands on a descendant of the element", () => {
		document.body.innerHTML = "<button><span>label</span></button>";
		const el = document.querySelector("button") as HTMLElement;
		document.elementFromPoint = () => document.querySelector("span") as HTMLElement;

		expect(isCenterObscuredScript(el)).toBe(false);
	});

	it("is true when an unrelated element covers the element's centre", () => {
		document.body.innerHTML = `<button>target</button><div id="banner">cookie banner</div>`;
		const el = document.querySelector("button") as HTMLElement;
		document.elementFromPoint = () => document.querySelector("#banner") as HTMLElement;

		expect(isCenterObscuredScript(el)).toBe(true);
	});

	it("is false when the hit test finds nothing", () => {
		document.body.innerHTML = "<button>target</button>";
		const el = document.querySelector("button") as HTMLElement;
		document.elementFromPoint = () => null;

		expect(isCenterObscuredScript(el)).toBe(false);
	});
});

describe("elementStylesScript", () => {
	it("reads computed styles from a given element after blur", () => {
		document.body.innerHTML = `<button style="outline-width: 3px">x</button>`;
		const el = document.querySelector("button") as HTMLElement;
		el.focus();
		el.blur();

		const styles = elementStylesScript(el, ["outline-width"]);

		expect(styles.element["outline-width"]).toBe("3px");
		expect(styles.before).toEqual(expect.any(Object));
		expect(styles.after).toEqual(expect.any(Object));
	});
});

describe("measureObscuringScript", () => {
	const ATTR = "data-test-obscurer";

	afterEach(() => {
		vi.restoreAllMocks();
		document.body.innerHTML = "";
		// The scan for click-through covers is kept for a second, which outlives a test.
		delete (window as Window & { __a11yPulseInertCovers?: unknown }).__a11yPulseInertCovers;
		delete (window as Window & { __a11yPulseObscurer?: unknown }).__a11yPulseObscurer;
	});

	it("reports offscreen when the element has no viewport intersection", () => {
		document.body.innerHTML = "<button>target</button>";
		const el = document.querySelector("button") as HTMLElement;
		el.getBoundingClientRect = () =>
			({
				left: -200,
				top: -200,
				right: -100,
				bottom: -100,
				width: 100,
				height: 100,
			}) as DOMRect;

		const result = measureObscuringScript(el, ATTR);

		expect(result.offscreen).toBe(true);
		expect(result.fullyObscured).toBe(false);
	});

	it("reports not fully obscured when the element is the top hit", () => {
		document.body.innerHTML = "<button>target</button>";
		const el = document.querySelector("button") as HTMLElement;
		el.getBoundingClientRect = () =>
			({
				left: 10,
				top: 10,
				right: 110,
				bottom: 50,
				width: 100,
				height: 40,
			}) as DOMRect;
		document.elementsFromPoint = () => [el];

		const result = measureObscuringScript(el, ATTR);

		expect(result.fullyObscured).toBe(false);
		expect(result.coveredFraction).toBe(0);
	});

	it("confirms opaque full cover when a container contains the element", () => {
		document.body.innerHTML =
			'<button>target</button><div id="banner" style="opacity:1;background:#000">banner</div>';
		const el = document.querySelector("button") as HTMLElement;
		const banner = document.querySelector("#banner") as HTMLElement;
		el.getBoundingClientRect = () =>
			({
				left: 10,
				top: 10,
				right: 110,
				bottom: 50,
				width: 100,
				height: 40,
			}) as DOMRect;
		banner.getBoundingClientRect = () =>
			({
				left: 0,
				top: 0,
				right: 200,
				bottom: 100,
				width: 200,
				height: 100,
			}) as DOMRect;
		document.elementsFromPoint = () => [banner, el];
		vi.spyOn(window, "getComputedStyle").mockReturnValue({
			opacity: "1",
			backgroundColor: "rgb(0, 0, 0)",
			backgroundImage: "none",
		} as CSSStyleDeclaration);

		const result = measureObscuringScript(el, ATTR);

		expect(result.fullyObscured).toBe(true);
		expect(result.opacity).toBe("opaque");
		expect(result.hasObscurer).toBe(true);
		expect(banner.getAttribute(ATTR)).toBe("1");
	});

	const box = (left: number, top: number, right: number, bottom: number) => () =>
		({ left, top, right, bottom, width: right - left, height: bottom - top }) as DOMRect;

	const stubStyles = (styles: Map<Element, Partial<CSSStyleDeclaration>>) => {
		vi.spyOn(window, "getComputedStyle").mockImplementation(
			(node) =>
				({
					opacity: "1",
					backgroundColor: "rgba(0, 0, 0, 0)",
					backgroundImage: "none",
					...styles.get(node),
				}) as CSSStyleDeclaration,
		);
	};

	it("looks past a layer that paints nothing to the cover beneath it", () => {
		document.body.innerHTML =
			'<button>target</button><div id="banner">banner</div><div id="layer"></div>';
		const el = document.querySelector("button") as HTMLElement;
		const banner = document.querySelector("#banner") as HTMLElement;
		const layer = document.querySelector("#layer") as HTMLElement;
		el.getBoundingClientRect = box(10, 10, 110, 50);
		banner.getBoundingClientRect = box(0, 0, 200, 100);
		layer.getBoundingClientRect = box(0, 0, 800, 600);
		document.elementsFromPoint = () => [layer, banner, el];
		stubStyles(new Map([[banner, { backgroundColor: "rgb(0, 0, 0)" }]]));

		const result = measureObscuringScript(el, ATTR);

		expect(result.fullyObscured).toBe(true);
		expect(result.opacity).toBe("opaque");
		expect(banner.getAttribute(ATTR)).toBe("1");
		expect(layer.hasAttribute(ATTR)).toBe(false);
	});

	it("does not count a layer that paints nothing as covering the element", () => {
		document.body.innerHTML = '<button>target</button><div id="layer"></div>';
		const el = document.querySelector("button") as HTMLElement;
		const layer = document.querySelector("#layer") as HTMLElement;
		el.getBoundingClientRect = box(10, 10, 110, 50);
		layer.getBoundingClientRect = box(0, 0, 800, 600);
		document.elementsFromPoint = () => [layer, el];
		stubStyles(new Map());

		const result = measureObscuringScript(el, ATTR);

		expect(result.fullyObscured).toBe(false);
		expect(result.coveredFraction).toBe(0);
	});

	it("prefers what it cannot see into over a see-through layer above it", () => {
		document.body.innerHTML =
			'<button>target</button><iframe id="frame"></iframe><div id="veil"></div>';
		const el = document.querySelector("button") as HTMLElement;
		const frame = document.querySelector("#frame") as HTMLElement;
		const veil = document.querySelector("#veil") as HTMLElement;
		el.getBoundingClientRect = box(10, 10, 110, 50);
		frame.getBoundingClientRect = box(0, 0, 200, 100);
		veil.getBoundingClientRect = box(0, 0, 800, 600);
		document.elementsFromPoint = () => [veil, frame, el];
		stubStyles(new Map([[veil, { backgroundColor: "rgba(0, 0, 0, 0.5)" }]]));

		const result = measureObscuringScript(el, ATTR);

		expect(result.fullyObscured).toBe(true);
		expect(result.opacity).toBe("unknown");
		expect(frame.getAttribute(ATTR)).toBe("1");
	});

	it.each(["canvas", "iframe", "object", "embed", "img"])(
		"does not assume a <%s> is opaque",
		(tag) => {
			document.body.innerHTML = `<button>target</button><${tag} id="cover"></${tag}>`;
			const el = document.querySelector("button") as HTMLElement;
			const cover = document.querySelector("#cover") as HTMLElement;
			el.getBoundingClientRect = box(10, 10, 110, 50);
			cover.getBoundingClientRect = box(0, 0, 200, 100);
			document.elementsFromPoint = () => [cover, el];
			stubStyles(new Map());

			const result = measureObscuringScript(el, ATTR);

			expect(result.fullyObscured).toBe(true);
			expect(result.opacity).toBe("unknown");
		},
	);

	it("takes replaced content with an opaque background of its own as opaque", () => {
		document.body.innerHTML = '<button>target</button><iframe id="cover"></iframe>';
		const el = document.querySelector("button") as HTMLElement;
		const cover = document.querySelector("#cover") as HTMLElement;
		el.getBoundingClientRect = box(10, 10, 110, 50);
		cover.getBoundingClientRect = box(0, 0, 200, 100);
		document.elementsFromPoint = () => [cover, el];
		stubStyles(new Map([[cover, { backgroundColor: "rgb(255, 255, 255)" }]]));

		const result = measureObscuringScript(el, ATTR);

		expect(result.opacity).toBe("opaque");
	});

	it("classifies opacity below 1 as semi-transparent", () => {
		document.body.innerHTML = '<button>target</button><div id="veil">veil</div>';
		const el = document.querySelector("button") as HTMLElement;
		const veil = document.querySelector("#veil") as HTMLElement;
		el.getBoundingClientRect = () =>
			({
				left: 10,
				top: 10,
				right: 110,
				bottom: 50,
				width: 100,
				height: 40,
			}) as DOMRect;
		veil.getBoundingClientRect = () =>
			({
				left: 0,
				top: 0,
				right: 200,
				bottom: 100,
				width: 200,
				height: 100,
			}) as DOMRect;
		document.elementsFromPoint = () => [veil, el];
		vi.spyOn(window, "getComputedStyle").mockReturnValue({
			opacity: "0.5",
			backgroundColor: "rgb(0, 0, 0)",
			backgroundImage: "none",
		} as CSSStyleDeclaration);

		const result = measureObscuringScript(el, ATTR);

		expect(result.fullyObscured).toBe(true);
		expect(result.opacity).toBe("semi-transparent");
	});

	it("judges the banner a hit belongs to, not the bare paragraph that was hit", () => {
		document.body.innerHTML =
			'<button>target</button><div id="banner" style="position:fixed;background-color:rgb(0, 0, 0)"><p id="text">We use cookies</p></div>';
		const el = document.querySelector("button") as HTMLElement;
		const banner = document.querySelector("#banner") as HTMLElement;
		const text = document.querySelector("#text") as HTMLElement;
		el.getBoundingClientRect = box(10, 10, 110, 50);
		banner.getBoundingClientRect = box(0, 0, 200, 100);
		text.getBoundingClientRect = box(0, 0, 200, 100);
		document.elementsFromPoint = () => [text, banner, el];

		const result = measureObscuringScript(el, ATTR);

		expect(result.fullyObscured).toBe(true);
		expect(result.opacity).toBe("opaque");
		expect(result.coverPosition).toBe("fixed");
		expect(banner.getAttribute(ATTR)).toBe("1");
		expect(text.hasAttribute(ATTR)).toBe(false);
	});

	it("names what several covers share, and does not call a patchwork opaque", () => {
		document.body.innerHTML =
			'<button>target</button><div id="bar"><div id="left" style="background-color:rgb(0, 0, 0)"></div><div id="right" style="background-color:rgb(0, 0, 0)"></div></div>';
		const el = document.querySelector("button") as HTMLElement;
		const bar = document.querySelector("#bar") as HTMLElement;
		const left = document.querySelector("#left") as HTMLElement;
		const right = document.querySelector("#right") as HTMLElement;
		el.getBoundingClientRect = box(10, 10, 110, 50);
		// The bar's own box is too short to account for the element.
		bar.getBoundingClientRect = box(0, 0, 200, 30);
		left.getBoundingClientRect = box(0, 0, 60, 100);
		right.getBoundingClientRect = box(60, 0, 200, 100);
		document.elementsFromPoint = (x: number) => (x < 60 ? [left, bar, el] : [right, bar, el]);

		const result = measureObscuringScript(el, ATTR);

		expect(result.fullyObscured).toBe(true);
		expect(result.opacity).toBe("unknown");
		expect(bar.getAttribute(ATTR)).toBe("1");
	});

	it("measures the label of an input that is not painted, and ignores the label's own content", () => {
		document.body.innerHTML =
			'<label id="switch"><input type="checkbox" style="opacity:0"><span id="track" style="background-color:rgb(0, 0, 0)"></span></label>';
		const el = document.querySelector("input") as HTMLElement;
		const label = document.querySelector("#switch") as HTMLElement;
		const track = document.querySelector("#track") as HTMLElement;
		el.getBoundingClientRect = box(10, 10, 66, 40);
		label.getBoundingClientRect = box(10, 10, 66, 40);
		track.getBoundingClientRect = box(10, 10, 66, 40);
		document.elementsFromPoint = () => [track, el, label];

		const result = measureObscuringScript(el, ATTR);

		expect(result.measured).toBe("label");
		expect(result.fullyObscured).toBe(false);
		expect(result.coveredFraction).toBe(0);
	});

	it("reports an unpainted element with no label as not painted rather than off screen", () => {
		document.body.innerHTML = '<a href="#x" style="opacity:0">hidden</a>';
		const el = document.querySelector("a") as HTMLElement;
		el.getBoundingClientRect = box(-200, -200, -100, -100);

		const result = measureObscuringScript(el, ATTR);

		expect(result.notPainted).toBe(true);
		expect(result.offscreen).toBe(false);
	});

	it("does not call a gradient that fades to transparent opaque", () => {
		document.body.innerHTML =
			'<button>target</button><div id="fade" style="position:fixed;background-image:linear-gradient(to top, rgb(255, 255, 255), rgba(0, 0, 0, 0))"></div>';
		const el = document.querySelector("button") as HTMLElement;
		const fade = document.querySelector("#fade") as HTMLElement;
		el.getBoundingClientRect = box(10, 10, 110, 50);
		fade.getBoundingClientRect = box(0, 0, 200, 100);
		document.elementsFromPoint = () => [fade, el];

		const result = measureObscuringScript(el, ATTR);

		expect(result.fullyObscured).toBe(true);
		expect(result.opacity).toBe("unknown");
	});

	it("switches pointer events on for a click-through cover only while it measures", () => {
		document.body.innerHTML =
			'<button>target</button><div id="ghost" style="position:fixed;pointer-events:none;background-color:rgb(0, 0, 0)"></div>';
		const el = document.querySelector("button") as HTMLElement;
		const ghost = document.querySelector("#ghost") as HTMLElement;
		const style = ghost.style.cssText;
		el.getBoundingClientRect = box(10, 10, 110, 50);
		ghost.getBoundingClientRect = box(0, 0, 200, 100);
		// As a browser would: the cover is only hit while it takes pointer events.
		document.elementsFromPoint = () =>
			ghost.style.getPropertyValue("pointer-events") === "auto" ? [ghost, el] : [el];

		const result = measureObscuringScript(el, ATTR);

		expect(result.fullyObscured).toBe(true);
		expect(result.opacity).toBe("opaque");
		expect(result.coverIgnoresPointer).toBe(true);
		expect(ghost.style.getPropertyValue("pointer-events")).toBe("none");
		expect(ghost.style.cssText).toBe(style);
	});
});

describe("context observer scripts", () => {
	afterEach(() => {
		document.body.innerHTML = "";
		uninstallContextObserverScript();
	});

	it("records window.open and returns an inert stub", () => {
		installContextObserverScript();
		let stub: Window | null = null;

		onFocusOf(focusable(), () => {
			stub = window.open("https://example.com");
		});

		expect(stub).toBeTruthy();
		expect((stub as Window | null)?.closed).toBe(true);

		const drained = drainContextObserverScript("data-idx");
		expect(drained.openedWindow).toBe(true);
		expect(drained.unattributed).toBeNull();
	});

	it("records submit and prevents the default", () => {
		document.body.innerHTML = '<form id="f"><input id="i"></form>';
		installContextObserverScript();

		const form = document.querySelector("#f") as HTMLFormElement;
		const event = new Event("submit", { bubbles: true, cancelable: true });

		onFocusOf(document.querySelector("#i") as HTMLElement, () => {
			form.dispatchEvent(event);
		});

		expect(event.defaultPrevented).toBe(true);

		const drained = drainContextObserverScript("data-idx");
		expect(drained.submittedForm).toBe(true);
	});

	it("puts nothing the page does outside an element's focus handling down to the current stop", () => {
		document.body.innerHTML = '<form id="f"></form>';
		installContextObserverScript();

		const actor = focusable();

		onFocusOf(actor, () => {});

		// The page acting on its own account, with #actor merely focused at the time.
		const stub = window.open("/promotion");
		const event = new Event("submit", { bubbles: true, cancelable: true });

		(document.querySelector("#f") as HTMLFormElement).dispatchEvent(event);

		// Blocked all the same.
		expect(stub?.closed).toBe(true);
		expect(event.defaultPrevented).toBe(true);

		const drained = drainContextObserverScript("data-idx");

		expect(drained).toMatchObject({ openedWindow: false, submittedForm: false, late: [] });
		expect(drained.unattributed).toMatchObject({
			openedWindow: true,
			openedWindowUrl: "/promotion",
			submittedForm: true,
		});
		expect(drainContextObserverScript("data-idx").unattributed).toBeNull();
	});

	it("records a native dialog against the element whose focus handler raised it", () => {
		const alert = vi.fn();

		window.alert = alert;
		installContextObserverScript();

		onFocusOf(focusable(), () => window.alert("Card details are saved automatically"));

		expect(alert).toHaveBeenCalledWith("Card details are saved automatically");
		expect(drainContextObserverScript("data-idx")).toMatchObject({
			raisedDialog: true,
			unattributed: null,
		});

		window.alert("Your session is about to expire");
		expect(drainContextObserverScript("data-idx")).toMatchObject({
			raisedDialog: false,
			unattributed: { raisedDialog: true },
		});

		uninstallContextObserverScript();
		expect(window.alert).toBe(alert);
	});

	it("classifies focus removal when settle lands on body", () => {
		document.body.innerHTML = '<input id="a"><input id="b">';
		installContextObserverScript();
		const a = document.querySelector("#a") as HTMLInputElement;
		a.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
		a.blur();

		const drained = drainContextObserverScript("data-idx");
		expect(drained.focusRemoved).toBe(true);
		expect(drained.hasAttributed).toBe(true);
	});
});

describe("clearMarkersScript", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	it("removes the marker attribute from marked elements", () => {
		document.body.innerHTML = `<div ${MARKER}="1"></div>`;

		clearMarkersScript(MARKER);

		expect(document.querySelector(`[${MARKER}]`)).toBeNull();
	});

	it("blurs the active element", () => {
		document.body.innerHTML = `<button ${MARKER}="1"></button>`;
		const button = document.querySelector("button") as HTMLElement;
		button.focus();
		expect(document.activeElement).toBe(button);

		clearMarkersScript(MARKER);

		expect(document.activeElement).not.toBe(button);
	});

	it("scrolls the page back to the top", () => {
		const scrollTo = vi.fn();
		window.scrollTo = scrollTo;

		clearMarkersScript(MARKER);

		expect(scrollTo).toHaveBeenCalledWith(0, 0);
	});
});

describe("uninstallContextObserverScript", () => {
	afterEach(() => {
		uninstallContextObserverScript();
		document.body.innerHTML = "";
	});

	it("puts window.open and the History API back and stops cancelling submits", () => {
		const open = window.open;
		const pushState = history.pushState;
		const replaceState = history.replaceState;
		document.body.innerHTML = '<form id="f"><input id="i"></form>';

		installContextObserverScript();
		expect(window.open).not.toBe(open);
		expect(history.pushState).not.toBe(pushState);

		uninstallContextObserverScript();

		expect(window.open).toBe(open);
		expect(history.pushState).toBe(pushState);
		expect(history.replaceState).toBe(replaceState);
		expect(window.__a11yContextObserver).toBeUndefined();

		const event = new Event("submit", { bubbles: true, cancelable: true });
		(document.querySelector("#f") as HTMLFormElement).dispatchEvent(event);
		expect(event.defaultPrevented).toBe(false);
	});

	it("leaves a wrapper the page put over window.open in the meantime alone", () => {
		const open = window.open;
		installContextObserverScript();
		const pageWrapper = (() => null) as typeof window.open;
		window.open = pageWrapper;

		uninstallContextObserverScript();

		expect(window.open).toBe(pageWrapper);
		window.open = open;
	});

	it("removes the marker left on an attributed element", () => {
		document.body.innerHTML = '<input id="a">';
		installContextObserverScript();
		const a = document.querySelector("#a") as HTMLInputElement;
		a.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
		a.blur();
		expect(drainContextObserverScript(MARKER).hasAttributed).toBe(true);

		uninstallContextObserverScript();

		expect(document.querySelector("[data-a11y-ctx-attr]")).toBeNull();
	});

	it("can be installed again afterwards", () => {
		installContextObserverScript();
		uninstallContextObserverScript();
		installContextObserverScript();
		onFocusOf(focusable(), () => {
			window.open("https://example.com");
		});

		expect(drainContextObserverScript(MARKER).openedWindow).toBe(true);
	});
});

describe("context observer soft URL changes", () => {
	afterEach(() => {
		uninstallContextObserverScript();
		history.replaceState(null, "", location.pathname);
		document.body.innerHTML = "";
	});

	it("reports a History API change once, and not again when the same URL is re-asserted", () => {
		installContextObserverScript();

		const actor = focusable();

		onFocusOf(actor, () => history.replaceState(null, "", "#section"));
		expect(drainContextObserverScript(MARKER).softUrlChange).toBe(true);

		// Scroll restoration and routers call replaceState with the URL the page already has.
		onFocusOf(actor, () => history.replaceState({ y: 120 }, "", location.href));
		expect(drainContextObserverScript(MARKER)).toMatchObject({
			softUrlChange: false,
			unattributed: null,
		});

		onFocusOf(actor, () => history.pushState(null, "", "#other"));
		expect(drainContextObserverScript(MARKER).softUrlChange).toBe(true);
	});

	it("does not put a URL change the page makes on its own down to the current stop", () => {
		installContextObserverScript();
		onFocusOf(focusable(), () => {});

		const from = location.href;

		// A scroll-spy or router updating the address for reasons of its own.
		history.replaceState(null, "", "#pricing");

		const drained = drainContextObserverScript(MARKER);

		expect(drained.softUrlChange).toBe(false);
		expect(drained.unattributed).toMatchObject({
			softUrlChange: true,
			urlFrom: from,
			urlTo: `${from.split("#")[0]}#pricing`,
		});
	});
});

describe("context observer evidence and attribution", () => {
	afterEach(() => {
		uninstallContextObserverScript();
		removeTabObserverScript();
		document.body.innerHTML = "";
	});

	const pressTab = (): void => {
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
	};

	/** What a real Tab press does to `el`, as far as the two observers can see. */
	const tabTo = (el: HTMLElement): void => {
		pressTab();
		el.focus();
		el.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
		el.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
	};

	it("keeps the URL a window was opened on and the form that was submitted", () => {
		document.body.innerHTML = '<form id="signup" action="/subscribe"><input></form>';
		installContextObserverScript();

		onFocusOf(document.querySelector("#signup input") as HTMLElement, () => {
			window.open("/offer");
			(document.querySelector("#signup") as HTMLFormElement).dispatchEvent(
				new Event("submit", { bubbles: true, cancelable: true }),
			);
		});

		const drained = drainContextObserverScript(MARKER);

		expect(drained).toMatchObject({
			openedWindow: true,
			openedWindowUrl: "/offer",
			submittedForm: true,
			submittedFormHtml: '<form id="signup" action="/subscribe"></form>',
			submittedFormAction: new URL("/subscribe", document.baseURI).href,
			hasSubmittedForm: true,
		});
		expect(submittedFormHandleScript()).toBe(document.querySelector("#signup"));

		// The next drain starts clean and lets go of the form.
		expect(drainContextObserverScript(MARKER)).toMatchObject({
			openedWindow: false,
			submittedForm: false,
			hasSubmittedForm: false,
		});
		expect(submittedFormHandleScript()).toBeNull();
	});

	it("records form.submit(), which fires no submit event, and puts the method back", () => {
		document.body.innerHTML = '<form id="f" action="/go"></form>';

		const original = HTMLFormElement.prototype.submit;
		const form = document.querySelector("#f") as HTMLFormElement;

		installContextObserverScript();
		onFocusOf(focusable(), () => form.submit());

		expect(drainContextObserverScript(MARKER)).toMatchObject({
			submittedForm: true,
			submittedFormHtml: '<form id="f" action="/go"></form>',
		});

		uninstallContextObserverScript();
		expect(HTMLFormElement.prototype.submit).toBe(original);
	});

	it("reports where a soft URL change came from and went to", () => {
		installContextObserverScript();

		const from = location.href;

		onFocusOf(focusable(), () => {
			history.pushState(null, "", "#one");
			history.pushState(null, "", "#two");
		});

		expect(drainContextObserverScript(MARKER)).toMatchObject({
			softUrlChange: true,
			urlFrom: from,
			urlTo: `${from.split("#")[0]}#two`,
		});

		history.replaceState(null, "", location.pathname);
	});

	it("does not call a focus guard passing focus on a redirect", () => {
		document.body.innerHTML =
			'<div id="guard" tabindex="0" data-focus-guard="true"></div><button id="save">Save</button>';
		installContextObserverScript();

		const guard = document.querySelector("#guard") as HTMLElement;
		const save = document.querySelector("#save") as HTMLElement;

		guard.dispatchEvent(new FocusEvent("focus", { bubbles: false }));
		save.focus();

		expect(drainContextObserverScript(MARKER)).toMatchObject({
			focusGuard: true,
			redirect: null,
			hasAttributed: false,
		});
	});

	it.each([
		["a native control", '<input id="from">'],
		["an element with a name", '<div id="from" tabindex="0" aria-label="Menu"></div>'],
		["an element with a role", '<div id="from" tabindex="0" role="button"></div>'],
		["an element with content", '<div id="from" tabindex="0">Open</div>'],
		["an element holding an image", '<div id="from" tabindex="0"><img alt=""></div>'],
		// Empty and unnamed like a focus guard, but there is no dialog for it to be guarding.
		["an empty element with no dialog to guard", '<div id="from" tabindex="0"></div>'],
	])("still reports a redirect by %s", (_label, markup) => {
		document.body.innerHTML = `${markup}<button id="to">To</button>`;
		installContextObserverScript();

		(document.querySelector("#from") as HTMLElement).dispatchEvent(
			new FocusEvent("focus", { bubbles: false }),
		);
		(document.querySelector("#to") as HTMLElement).focus();

		expect(drainContextObserverScript(MARKER)).toMatchObject({
			focusGuard: false,
			redirect: "outside",
			hasAttributed: true,
		});
	});

	it.each([
		[
			"an unmarked empty element inside the dialog it sends focus into",
			'<div role="dialog"><div id="guard" tabindex="0"></div><button id="to">Save</button></div>',
		],
		[
			"an unmarked empty element beside the dialog, in the wrapper they share",
			'<div class="modal"><div id="guard" tabindex="0"></div><div aria-modal="true"><button id="to">Save</button></div></div>',
		],
		[
			"an element hidden from assistive technology",
			'<span id="guard" tabindex="0" aria-hidden="true">.</span><button id="to">Save</button>',
		],
		[
			"a button a library marks as its guard",
			'<button id="guard" data-headlessui-focus-guard="true"></button><button id="to">Save</button>',
		],
		[
			"a sentinel with MUI's test id",
			'<div id="guard" tabindex="0" data-testid="sentinelStart"></div><button id="to">Save</button>',
		],
	])("treats %s as a focus guard", (_label, markup) => {
		document.body.innerHTML = markup;
		installContextObserverScript();

		(document.querySelector("#guard") as HTMLElement).dispatchEvent(
			new FocusEvent("focus", { bubbles: false }),
		);
		(document.querySelector("#to") as HTMLElement).focus();

		expect(drainContextObserverScript(MARKER)).toMatchObject({
			focusGuard: true,
			redirect: null,
			hasAttributed: false,
		});
	});

	it("reports an empty element in a dialog that sends focus out of it", () => {
		document.body.innerHTML =
			'<input id="search"><div role="dialog"><div id="from" tabindex="0"></div><button>Save</button></div>';
		installContextObserverScript();

		(document.querySelector("#from") as HTMLElement).dispatchEvent(
			new FocusEvent("focus", { bubbles: false }),
		);
		(document.querySelector("#search") as HTMLElement).focus();

		expect(drainContextObserverScript(MARKER)).toMatchObject({
			focusGuard: false,
			redirect: "outside",
			hasAttributed: true,
		});
	});

	it("gives a timer set outside any element's focus handling no owner", async () => {
		document.body.innerHTML = `<input id="field" ${MARKER}="1">`;
		installTabObserverScript();
		installContextObserverScript();

		tabTo(document.querySelector("#field") as HTMLElement);

		// The page, not #field's focus handler, sets this while #field happens to be focused.
		setTimeout(() => window.open("/survey"), 5);
		await new Promise((resolve) => setTimeout(resolve, 40));

		const drained = drainContextObserverScript(MARKER);

		expect(drained).toMatchObject({ openedWindow: false, late: [] });
		expect(drained.unattributed).toMatchObject({ openedWindow: true, openedWindowUrl: "/survey" });
	});

	it("never gives a poll loop that was running before the session an owner", async () => {
		document.body.innerHTML = `<input id="field" ${MARKER}="1"><input id="next" ${MARKER}="2">`;

		let ticks = 0;
		const tick = (): void => {
			if (++ticks === 4) {
				window.open("/promotion");
			}

			if (ticks < 6) {
				setTimeout(tick, 5);
			}
		};

		// Started before the observers exist, and re-armed from inside itself from then on.
		setTimeout(tick, 5);
		installTabObserverScript();
		installContextObserverScript();

		tabTo(document.querySelector("#field") as HTMLElement);
		await new Promise((resolve) => setTimeout(resolve, 15));
		tabTo(document.querySelector("#next") as HTMLElement);
		await new Promise((resolve) => setTimeout(resolve, 80));

		const drained = drainContextObserverScript(MARKER);

		expect(ticks).toBe(6);
		expect(drained).toMatchObject({ openedWindow: false, late: [] });
		expect(drained.unattributed).toMatchObject({
			openedWindow: true,
			openedWindowUrl: "/promotion",
		});
	});

	it("waits for the timers an element set, and those they set in turn, before a final drain", async () => {
		document.body.innerHTML = `<input id="last" ${MARKER}="5">`;
		installTabObserverScript();
		installContextObserverScript();

		const last = document.querySelector("#last") as HTMLElement;

		last.addEventListener("focus", () => {
			setTimeout(() => setTimeout(() => window.open("/late-offer"), 30), 30);
		});

		tabTo(last);
		// What the stop itself is told: nothing yet.
		expect(drainContextObserverScript(MARKER).openedWindow).toBe(false);

		const startedAt = performance.now();

		await awaitOwnedTimersScript(1000);

		expect(performance.now() - startedAt).toBeLessThan(500);

		// A final drain has no current stop: #last still has focus, and its change is reported as
		// one made after its stop.
		const drained = drainContextObserverScript(MARKER, true);

		expect(drained).toMatchObject({ openedWindow: false, focusRemoved: false, redirect: null });
		expect(drained.late).toEqual([
			expect.objectContaining({ index: 5, openedWindow: true, openedWindowUrl: "/late-offer" }),
		]);
	});

	it("waits for an element's timer to run, not just come due, before a final drain", async () => {
		// A browser under load runs a timer some way past its due time, while animation frames keep
		// coming: the frames must not be taken to mean the timer has had its turn.
		const realSetTimeout = window.setTimeout;

		window.setTimeout = ((handler: TimerHandler, ms?: number, ...rest: unknown[]) =>
			realSetTimeout(handler, (Number(ms) || 0) + 150, ...rest)) as typeof window.setTimeout;

		try {
			document.body.innerHTML = `<input id="last" ${MARKER}="5">`;
			installTabObserverScript();
			installContextObserverScript();

			const last = document.querySelector("#last") as HTMLElement;

			last.addEventListener("focus", () => {
				setTimeout(() => window.open("/late-offer"), 30);
			});

			tabTo(last);
			await awaitOwnedTimersScript(1000);

			expect(drainContextObserverScript(MARKER, true).late).toEqual([
				expect.objectContaining({ index: 5, openedWindow: true, openedWindowUrl: "/late-offer" }),
			]);
		} finally {
			removeTabObserverScript();
			window.setTimeout = realSetTimeout;
		}
	});

	it("does not wait when no element has a timer pending, and gives up at its limit", async () => {
		document.body.innerHTML = '<input id="last">';
		installTabObserverScript();
		installContextObserverScript();

		// A timer of the page's own is not waited for.
		setTimeout(() => {}, 400);

		let startedAt = performance.now();

		await awaitOwnedTimersScript(1000);
		expect(performance.now() - startedAt).toBeLessThan(100);

		const last = document.querySelector("#last") as HTMLElement;

		last.addEventListener("focus", () => {
			setTimeout(() => {}, 800);
		});
		tabTo(last);
		startedAt = performance.now();

		await awaitOwnedTimersScript(60);
		expect(performance.now() - startedAt).toBeLessThan(400);
	});

	it("puts what a timer does down to the element that set it, even after focus has moved on", async () => {
		document.body.innerHTML = `<input id="slow" ${MARKER}="3"><input id="next">`;
		installTabObserverScript();
		installContextObserverScript();

		const slow = document.querySelector("#slow") as HTMLElement;
		const next = document.querySelector("#next") as HTMLElement;

		slow.addEventListener("focus", () => {
			// The second timer is set from inside the first and still belongs to #slow.
			setTimeout(() => setTimeout(() => window.open("/late"), 5), 5);
		});

		tabTo(slow);
		expect(drainContextObserverScript(MARKER).openedWindow).toBe(false);

		tabTo(next);
		await new Promise((resolve) => setTimeout(resolve, 60));

		const drained = drainContextObserverScript(MARKER);

		// Nothing is put down to #next, which is merely where focus is by then.
		expect(drained.openedWindow).toBe(false);
		expect(drained.late).toEqual([
			expect.objectContaining({
				index: 3,
				html: '<input id="slow">',
				openedWindow: true,
				openedWindowUrl: "/late",
				submittedForm: false,
			}),
		]);
		expect(drainContextObserverScript(MARKER).late).toEqual([]);
	});

	it("keeps a timer's change with the current stop while its element still has focus", async () => {
		document.body.innerHTML = '<input id="quick">';
		installTabObserverScript();
		installContextObserverScript();

		const quick = document.querySelector("#quick") as HTMLElement;

		quick.addEventListener("focus", () => {
			setTimeout(() => window.open("/soon"), 5);
		});

		tabTo(quick);
		await new Promise((resolve) => setTimeout(resolve, 40));

		expect(drainContextObserverScript(MARKER)).toMatchObject({
			openedWindow: true,
			openedWindowUrl: "/soon",
			late: [],
		});
	});

	it("runs the page's timer callbacks with their own arguments and return path", async () => {
		installTabObserverScript();
		installContextObserverScript();

		const received = await new Promise<unknown[]>((resolve) => {
			setTimeout((...values: unknown[]) => resolve(values), 1, "a", 2);
		});

		expect(received).toEqual(["a", 2]);
	});
});

describe("tab observer", () => {
	afterEach(() => {
		removeTabObserverScript();
		document.body.innerHTML = "";
	});

	const pressTab = (): void => {
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
	};

	it("leaves a wrapper the page put over setTimeout working, and nothing of its own behind", async () => {
		const native = window.setTimeout;

		installTabObserverScript();

		// The page wraps `setTimeout` again while the observer's wrapper is in place, so the
		// observer's stays in the chain after the session.
		const observers = window.setTimeout;
		let seen = 0;
		const pageWrapper = ((...args: Parameters<typeof window.setTimeout>) => {
			seen++;

			return observers(...args);
		}) as typeof window.setTimeout;

		window.setTimeout = pageWrapper;
		removeTabObserverScript();

		try {
			expect(window.setTimeout).toBe(pageWrapper);

			await new Promise((resolve) => setTimeout(resolve, 1));

			expect(seen).toBe(1);
			expect(Object.keys(window).filter((key) => key.startsWith("__a11yPulse"))).toEqual([]);
		} finally {
			window.setTimeout = native;
		}
	});

	it("is how a replaced document is recognised", () => {
		expect(documentReplacedScript()).toBe(true);

		installTabObserverScript();
		expect(documentReplacedScript()).toBe(false);

		removeTabObserverScript();
		expect(documentReplacedScript()).toBe(true);
	});

	it("counts a document that has started to leave as replaced, before the next one arrives", () => {
		installTabObserverScript();
		expect(landedHrefScript()).toEqual({ href: location.href, leaving: false });

		// What a navigation to another document fires as it starts, while the old one stays alive.
		window.dispatchEvent(new Event("beforeunload"));

		expect(documentReplacedScript()).toBe(true);
		expect(landedHrefScript()).toEqual({ href: location.href, leaving: true });

		removeTabObserverScript();
		expect(landedHrefScript().leaving).toBe(false);
		expect(Object.keys(window).filter((key) => key.startsWith("__a11yPulse"))).toEqual([]);
	});

	it("reports an element that took focus on the last Tab and then blurred itself", () => {
		document.body.innerHTML = '<a id="a" href="#a">a</a><a id="b" href="#b">b</a>';
		installTabObserverScript();
		const b = document.querySelector("#b") as HTMLElement;

		pressTab();
		b.focus();
		b.blur();

		expect(blurredStopScript(MARKER, 7)).toEqual({ blurred: true, index: 7 });
		expect(b.getAttribute(MARKER)).toBe("7");
		// Read once: the next Tab press starts a new record.
		expect(blurredStopScript(MARKER, 8)).toEqual({ blurred: false, index: null });
	});

	it("keeps the marker a blurred element already has", () => {
		document.body.innerHTML = `<a id="b" href="#b" ${MARKER}="3">b</a>`;
		installTabObserverScript();
		const b = document.querySelector("#b") as HTMLElement;

		pressTab();
		b.focus();
		b.blur();

		expect(blurredStopScript(MARKER, 9)).toEqual({ blurred: true, index: 3 });
	});

	it("reports an element that was removed after taking focus, with no marker", () => {
		document.body.innerHTML = '<a id="b" href="#b">b</a>';
		installTabObserverScript();
		const b = document.querySelector("#b") as HTMLElement;

		pressTab();
		b.focus();
		b.remove();

		expect(blurredStopScript(MARKER, 9)).toEqual({ blurred: true, index: null });
	});

	it("does not report a Tab press that focused nothing: the tab order ran out", () => {
		document.body.innerHTML = '<a id="a" href="#a">a</a>';
		installTabObserverScript();
		const a = document.querySelector("#a") as HTMLElement;

		pressTab();
		a.focus();
		expect(blurredStopScript(MARKER, 1)).toEqual({ blurred: false, index: null });

		a.blur();
		pressTab();

		expect(blurredStopScript(MARKER, 1)).toEqual({ blurred: false, index: null });
	});

	it("does not report focus that moved on to another element", () => {
		document.body.innerHTML = '<input id="thief"><input id="victim">';
		installTabObserverScript();

		pressTab();
		(document.querySelector("#thief") as HTMLElement).focus();
		(document.querySelector("#victim") as HTMLElement).focus();

		expect(blurredStopScript(MARKER, 1)).toEqual({ blurred: false, index: null });
	});
});

describe("heldFocusScript", () => {
	afterEach(() => {
		document.body.innerHTML = "";
	});

	function footer(inner: string): ShadowRoot {
		const host = document.createElement("site-footer");
		document.body.append(host);
		const shadow = host.attachShadow({ mode: "open" });
		shadow.innerHTML = inner;

		return shadow;
	}

	it("sees tabbable content in a shadow root after the focused element", () => {
		document.body.innerHTML = '<input id="d" type="date">';
		footer('<a href="#terms">Terms</a>');
		(document.querySelector("#d") as HTMLElement).focus();

		expect(heldFocusScript(TABBABLE_SELECTOR).followed).toBe(true);
	});

	it("sees a later link in the same shadow root as the focused one", () => {
		const shadow = footer('<a id="one" href="#1">One</a><a id="two" href="#2">Two</a>');
		(shadow.querySelector("#one") as HTMLElement).focus();

		expect(heldFocusScript(TABBABLE_SELECTOR).followed).toBe(true);
	});

	it("reports nothing after the last link of a trailing shadow root", () => {
		document.body.innerHTML = '<a href="#before">Before</a>';
		const shadow = footer('<a id="one" href="#1">One</a><a id="two" href="#2">Two</a>');
		(shadow.querySelector("#two") as HTMLElement).focus();

		expect(heldFocusScript(TABBABLE_SELECTOR).followed).toBe(false);
	});

	it("ignores shadow content that cannot be tabbed to", () => {
		document.body.innerHTML = '<input id="d" type="date">';
		footer('<a href="#terms" tabindex="-1">Terms</a><button disabled>Go</button>');
		(document.querySelector("#d") as HTMLElement).focus();

		expect(heldFocusScript(TABBABLE_SELECTOR).followed).toBe(false);
	});
});

describe("markActiveElementScript", () => {
	afterEach(() => {
		clearMarkersScript(MARKER);
		document.body.innerHTML = "";
	});

	const visit = (el: HTMLElement, index: number): number => {
		el.focus();
		const marker = markActiveElementScript(MARKER, index);
		// The probe is what records a marked element as visited.
		probeActiveElementScript([], MARKER);

		return marker;
	};

	it("gives an unmarked element the next marker and keeps one it already has", () => {
		document.body.innerHTML = `<button id="a">a</button><button id="b" ${MARKER}="4">b</button>`;

		expect(visit(document.querySelector("#a") as HTMLElement, 10)).toBe(10);
		expect(visit(document.querySelector("#b") as HTMLElement, 11)).toBe(4);
	});

	it("gives back the old marker when the page stripped the attribute from a visited element", () => {
		document.body.innerHTML = '<button id="a">a</button>';
		const a = document.querySelector("#a") as HTMLElement;
		expect(visit(a, 10)).toBe(10);

		a.removeAttribute(MARKER);

		expect(visit(a, 11)).toBe(10);
	});

	it("gives a re-rendered node the marker of the visited node it replaced", () => {
		document.body.innerHTML = '<div id="modal"><button class="ok">OK</button></div>';
		const modal = document.querySelector("#modal") as HTMLElement;
		expect(visit(modal.querySelector(".ok") as HTMLElement, 10)).toBe(10);

		modal.innerHTML = '<button class="ok">OK</button>';

		expect(visit(modal.querySelector(".ok") as HTMLElement, 11)).toBe(10);
	});

	it("does not confuse a new sibling with a visited element that is still on the page", () => {
		document.body.innerHTML = '<div id="list"><a href="#1">one</a></div>';
		const list = document.querySelector("#list") as HTMLElement;
		expect(visit(list.querySelector("a") as HTMLElement, 10)).toBe(10);

		list.insertAdjacentHTML("afterbegin", '<a href="#0">zero</a>');

		// The new link now sits where the visited one was, but that one is still connected.
		expect(visit(list.querySelector("a") as HTMLElement, 11)).toBe(11);
	});

	it("forgets what was visited once the markers are cleared", () => {
		document.body.innerHTML = '<div id="modal"><button class="ok">OK</button></div>';
		const modal = document.querySelector("#modal") as HTMLElement;
		expect(visit(modal.querySelector(".ok") as HTMLElement, 10)).toBe(10);

		clearMarkersScript(MARKER);
		modal.innerHTML = '<button class="ok">OK</button>';

		expect(visit(modal.querySelector(".ok") as HTMLElement, 11)).toBe(11);
	});
});

describe("settleScript", () => {
	afterEach(() => {
		removeTabObserverScript();
		vi.useRealTimers();
		vi.unstubAllGlobals();
		document.body.innerHTML = "";
	});

	/**
	 * Fake the clock and the browser's frame scheduling, with the tab observer watching the page's
	 * timers as it does in a session. Returns a way to run the pending frame: every callback asked
	 * for since the last one, as a browser does, with any they ask for in turn left for the next.
	 */
	function observedPage(): () => void {
		vi.useFakeTimers();
		installTabObserverScript();

		let pending: FrameRequestCallback[] = [];
		vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
			pending.push(callback);

			return pending.length;
		});

		return () => {
			const frame = pending;
			pending = [];

			for (const callback of frame) {
				callback(0);
			}
		};
	}

	function pressTab(): void {
		window.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
	}

	function settling(maxMs: number): { done: boolean } {
		const state = { done: false };

		void settleScript(maxMs).then(() => {
			state.done = true;
		});

		return state;
	}

	it("gives up after the limit on a page that is not rendering frames", async () => {
		// A background tab never runs animation-frame callbacks.
		observedPage();
		pressTab();
		const state = settling(33);

		await vi.advanceTimersByTimeAsync(32);
		expect(state.done).toBe(false);

		await vi.advanceTimersByTimeAsync(1);
		expect(state.done).toBe(true);
	});

	it("settles straight after the first frame when the page deferred nothing", async () => {
		const runFrame = observedPage();
		pressTab();
		const state = settling(1000);

		runFrame();
		await vi.advanceTimersByTimeAsync(0);
		expect(state.done).toBe(true);
	});

	it("waits for a timer a focus handler set, and for the one that timer sets in turn", async () => {
		const runFrame = observedPage();
		const ran: string[] = [];
		pressTab();
		// What a focus handler defers: a short timer whose callback defers again.
		window.setTimeout(() => {
			ran.push("first");
			window.setTimeout(() => ran.push("second"), 10);
		}, 20);
		const state = settling(1000);

		runFrame();
		await vi.advanceTimersByTimeAsync(20);
		expect(ran).toEqual(["first"]);
		expect(state.done).toBe(false);

		await vi.advanceTimersByTimeAsync(12);
		expect(ran).toEqual(["first", "second"]);
		expect(state.done).toBe(true);
	});

	it("waits for a timer that has come due but not yet run", async () => {
		const runFrame = observedPage();
		let now = 0;
		vi.spyOn(performance, "now").mockImplementation(() => now);
		let ran = false;
		pressTab();
		window.setTimeout(() => {
			ran = true;
		}, 20);
		const state = settling(1000);

		runFrame();
		await vi.advanceTimersByTimeAsync(0);
		// A frame arrives after the timer's due time, before the browser has run its callback.
		now = 25;
		runFrame();
		await Promise.resolve();
		expect(state.done).toBe(false);

		await vi.advanceTimersByTimeAsync(25);
		expect(ran).toBe(true);
		expect(state.done).toBe(true);
	});

	it("does not wait for a timer set before the press, or one due after the limit", async () => {
		const runFrame = observedPage();
		window.setTimeout(() => {}, 30);
		pressTab();
		window.setTimeout(() => {}, 500);
		const state = settling(33);

		runFrame();
		await vi.advanceTimersByTimeAsync(0);
		expect(state.done).toBe(true);
	});

	it("spends the whole limit when nothing is watching the page's timers", async () => {
		const runFrame = observedPage();
		removeTabObserverScript();
		const state = settling(200);

		runFrame();
		await vi.advanceTimersByTimeAsync(199);
		expect(state.done).toBe(false);

		await vi.advanceTimersByTimeAsync(1);
		expect(state.done).toBe(true);
	});

	it("settles on animation frames when the page's setTimeout never fires", async () => {
		vi.useFakeTimers();
		// What fake timers or a mocked clock leave a page with, in place before the session starts.
		const realSetTimeout = window.setTimeout;
		window.setTimeout = (() => 0) as unknown as typeof window.setTimeout;

		try {
			installTabObserverScript();

			let pending: FrameRequestCallback[] = [];
			vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
				pending.push(callback);

				return pending.length;
			});
			const runFrame = (): void => {
				const frame = pending;
				pending = [];

				for (const callback of frame) {
					callback(0);
				}
			};

			pressTab();
			const state = settling(33);

			// The first frame asks for the decision, which no timer will ever deliver.
			runFrame();
			await vi.advanceTimersByTimeAsync(16);
			expect(state.done).toBe(false);

			// The next frame takes it instead: nothing is pending, so the wait is over.
			runFrame();
			await vi.advanceTimersByTimeAsync(0);
			expect(state.done).toBe(true);
		} finally {
			removeTabObserverScript();
			window.setTimeout = realSetTimeout;
		}
	});

	it("leaves the page's setTimeout as it found it once the observer is removed", () => {
		const before = window.setTimeout;

		installTabObserverScript();
		expect(window.setTimeout).not.toBe(before);

		removeTabObserverScript();
		expect(window.setTimeout).toBe(before);
	});

	it("keeps a wrapper the page put around setTimeout during the session", () => {
		vi.useFakeTimers();
		installTabObserverScript();
		const observed = window.setTimeout;
		const pageWrapper = ((...args: Parameters<typeof window.setTimeout>) =>
			observed(...args)) as typeof window.setTimeout;
		window.setTimeout = pageWrapper;

		removeTabObserverScript();
		expect(window.setTimeout).toBe(pageWrapper);

		let ran = false;
		window.setTimeout(() => {
			ran = true;
		}, 1);
		vi.advanceTimersByTime(1);
		expect(ran).toBe(true);

		window.setTimeout = observed;
	});
});
