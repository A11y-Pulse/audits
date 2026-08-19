// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	baselineScript,
	elementRectScript,
	elementStylesScript,
	isCenterObscuredScript,
	probeActiveElementScript,
	scrollToCenterScript,
} from "./browser-scripts";

const MARKER = "data-test-idx";

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
		// Mimic a closed mega-menu: its links are hidden via an ancestor, which
		// per-element display/visibility checks can't see. They must not eat into
		// the marker budget, or every element tabbed after them loses its baseline.
		(Element.prototype as CheckVisibilityCarrier).checkVisibility = function (
			this: Element,
		) {
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
		expect(
			document.querySelectorAll(`[data-hidden-menu] [${MARKER}]`),
		).toHaveLength(0);
	});

	it("asks checkVisibility to include the CSS visibility property", () => {
		const checkVisibility = vi.fn().mockReturnValue(true);
		(Element.prototype as CheckVisibilityCarrier).checkVisibility =
			checkVisibility;

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
		expect(payload.entries.map((e) => e.styleIndex)).toEqual([
			0, 0, 0, 0, 0, 0,
		]);
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
		// The probe always reads styles while the marker is present, so the
		// baseline must too — otherwise page CSS targeting the marker attribute
		// would register as a style change on every element.
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

	function stubComputedStyle(
		valueFor: (el: Element, prop: string) => string,
	): void {
		vi.stubGlobal("getComputedStyle", (el: Element) => ({
			display: "inline-block",
			visibility: "visible",
			getPropertyValue: (prop: string) => valueFor(el, prop),
		}));
	}

	it("bounds oversized property values", () => {
		const long = `url(data:image/png;base64,${"A".repeat(20000)})`;
		stubComputedStyle((_el, prop) =>
			prop === "background-image" ? long : "none",
		);
		document.body.innerHTML = "<button>x</button>";

		const payload = baselineScript(["background-image"], MARKER, 10);
		const value = payload.styles[0]?.element["background-image"];

		expect(value).toBeTruthy();
		expect((value as string).length).toBeLessThan(600);
	});

	it("preserves inequality between distinct oversized values", () => {
		// Same length, same first 512 characters — only the tail differs, so
		// the truncated forms must still differ (via the fingerprint).
		const head = "A".repeat(600);
		stubComputedStyle((el, prop) =>
			prop === "background-image"
				? head + (el.textContent === "a" ? "X" : "Y")
				: "none",
		);
		document.body.innerHTML = "<button>a</button><button>b</button>";

		const payload = baselineScript(["background-image"], MARKER, 10);

		expect(payload.styles).toHaveLength(2);
		expect(payload.styles[0]?.element["background-image"]).not.toBe(
			payload.styles[1]?.element["background-image"],
		);
	});

	it("truncates identically in the baseline and the focus probe", () => {
		// Asymmetric truncation would make every oversized value "differ" on
		// focus and produce false style-check passes.
		const long = `url(data:image/png;base64,${"B".repeat(20000)})`;
		stubComputedStyle((_el, prop) =>
			prop === "background-image" ? long : "none",
		);
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
});

describe("elementRectScript", () => {
	it("returns a zero rect for a missing element", () => {
		expect(elementRectScript(null)).toEqual({
			x: 0,
			y: 0,
			width: 0,
			height: 0,
		});
	});

	it("returns the element's page-relative rect", () => {
		document.body.innerHTML = "<button>target</button>";
		const el = document.querySelector("button") as HTMLElement;
		el.getBoundingClientRect = () =>
			({ left: 10, top: 20, width: 30, height: 40 }) as DOMRect;
		Object.defineProperty(window, "scrollX", { value: 5, configurable: true });
		Object.defineProperty(window, "scrollY", { value: 7, configurable: true });

		expect(elementRectScript(el)).toEqual({
			x: 15,
			y: 27,
			width: 30,
			height: 40,
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
		document.elementFromPoint = () =>
			document.querySelector("span") as HTMLElement;

		expect(isCenterObscuredScript(el)).toBe(false);
	});

	it("is true when an unrelated element covers the element's centre", () => {
		document.body.innerHTML = `<button>target</button><div id="banner">cookie banner</div>`;
		const el = document.querySelector("button") as HTMLElement;
		document.elementFromPoint = () =>
			document.querySelector("#banner") as HTMLElement;

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

describe("scrollToCenterScript", () => {
	it("tolerates a missing element", () => {
		expect(() => scrollToCenterScript(null)).not.toThrow();
	});

	it("scrolls the element to the centre of the viewport without animating", () => {
		document.body.innerHTML = "<button>target</button>";
		const el = document.querySelector("button") as HTMLElement;
		const scrollIntoView = vi.fn();
		el.scrollIntoView = scrollIntoView;

		scrollToCenterScript(el);

		expect(scrollIntoView).toHaveBeenCalledWith(
			expect.objectContaining({ block: "center", behavior: "instant" }),
		);
	});
});
