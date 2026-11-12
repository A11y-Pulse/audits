import { describe, expect, it } from "vitest";
import type { ElementInspection } from "./adaptor";
import type { RawCandidate } from "./browser-scripts";
import { classifyCandidates } from "./classify";

function candidate(overrides: Partial<RawCandidate> = {}): RawCandidate {
	return {
		index: 0,
		kind: "unreached",
		html: "<div></div>",
		tag: "div",
		role: null,
		widgetRole: false,
		handlers: [],
		cursorPointer: false,
		cursorSetHere: false,
		tabindex: null,
		roving: false,
		hiddenControlLabel: false,
		focusedAt: null,
		customElement: false,
		backdrop: false,
		containerLike: false,
		holdsTabbable: false,
		parent: null,
		text: "",
		...overrides,
	};
}

function focused(overrides: Partial<RawCandidate> = {}): RawCandidate {
	return candidate({ kind: "focused", tabindex: 0, focusedAt: 0, ...overrides });
}

function inspection(listeners: string[] = [], role: string | null = null): ElementInspection {
	return { listeners, role };
}

/** Classify one candidate and return its verdict and reason, or null when it is not reported. */
function verdict(
	one: RawCandidate,
	inspected?: ElementInspection,
): [verdict: string, reason: string] | null {
	const [result] = classifyCandidates([one], inspected ? [inspected] : null);

	return result ? [result.verdict, result.reason] : null;
}

describe("classifyCandidates: controls Tab never reaches", () => {
	it("fails an element with a click listener the browser reported", () => {
		expect(verdict(candidate(), inspection(["click"]))).toEqual(["failed", "click-handler"]);
	});

	it("fails an element with an onclick handler when the browser cannot be asked", () => {
		expect(verdict(candidate({ handlers: ["onclick"] }))).toEqual(["failed", "click-handler"]);
	});

	it("reports the handlers and listeners together as event types", () => {
		const [result] = classifyCandidates(
			[candidate({ handlers: ["onclick"], cursorPointer: true })],
			[inspection(["mousedown", "click", "scroll", "mouseover"])],
		);

		expect(result?.signals).toEqual({
			listeners: ["click", "mousedown"],
			role: null,
			cursorPointer: true,
			tabindex: null,
		});
	});

	it("fails a widget role with no tab stop, whatever else is known", () => {
		expect(verdict(candidate({ role: "button", widgetRole: true }))).toEqual([
			"failed",
			"widget-role",
		]);
	});

	it("fails a label whose control is not rendered", () => {
		expect(verdict(candidate({ tag: "label", hiddenControlLabel: true }))).toEqual([
			"failed",
			"hidden-control-label",
		]);
	});

	it("asks for review of a click listener on a container with no pointer cursor", () => {
		expect(verdict(candidate({ containerLike: true }), inspection(["click"]))).toEqual([
			"review",
			"container-handler",
		]);
	});

	it("still fails a container that shows a pointer cursor", () => {
		expect(
			verdict(candidate({ containerLike: true, cursorPointer: true }), inspection(["click"])),
		).toEqual(["failed", "click-handler"]);
	});

	it("asks for review of a control only a script can focus", () => {
		expect(verdict(candidate({ tabindex: -1, handlers: ["onclick"] }))).toEqual([
			"review",
			"script-focus-only",
		]);
		expect(verdict(candidate({ tabindex: -1, role: "button", widgetRole: true }))).toEqual([
			"review",
			"script-focus-only",
		]);
	});

	it("asks for review of press handlers without click", () => {
		expect(verdict(candidate(), inspection(["pointerdown", "touchstart"]))).toEqual([
			"review",
			"press-handler",
		]);
	});

	it("asks for review where the page set a pointer cursor and nothing else is known", () => {
		expect(verdict(candidate({ cursorPointer: true, cursorSetHere: true }))).toEqual([
			"review",
			"pointer-cursor",
		]);
	});

	it("ignores an inherited pointer cursor", () => {
		expect(verdict(candidate({ cursorPointer: true }))).toBeNull();
	});

	it("ignores listeners that do not activate anything", () => {
		expect(verdict(candidate(), inspection(["mouseover", "scroll", "keydown"]))).toBeNull();
	});

	it("ignores tabindex=-1 with no sign of being a control", () => {
		expect(verdict(candidate({ tabindex: -1 }))).toBeNull();
	});

	it("ignores a roving tab stop and a backdrop", () => {
		expect(verdict(candidate({ roving: true, tabindex: -1, handlers: ["onclick"] }))).toBeNull();
		expect(verdict(candidate({ backdrop: true, handlers: ["onclick"] }))).toBeNull();
	});
});

describe("classifyCandidates: focused controls without a role", () => {
	it("fails a focused element that handles clicks and has no role", () => {
		const [result] = classifyCandidates([focused()], [inspection(["click"], "generic")]);

		expect(result).toMatchObject({
			finding: "missing-role",
			verdict: "failed",
			reason: "handler-without-role",
			computedRole: "generic",
		});
	});

	it("fails one that only handles key presses", () => {
		expect(verdict(focused({ handlers: ["onkeydown"] }))).toEqual([
			"failed",
			"handler-without-role",
		]);
	});

	it("treats presentation, none and generic as no role", () => {
		for (const role of ["presentation", "none", "generic"]) {
			expect(verdict(focused({ role, handlers: ["onclick"] }))).toEqual([
				"failed",
				"handler-without-role",
			]);
		}
	});

	it("passes any other role attribute", () => {
		expect(verdict(focused({ role: "button", handlers: ["onclick"] }))).toBeNull();
		expect(verdict(focused({ role: "region", handlers: ["onclick"] }))).toBeNull();
	});

	it("passes an element the browser exposes with a control's role", () => {
		expect(
			verdict(
				focused({ customElement: true, tag: "fancy-button" }),
				inspection(["click"], "button"),
			),
		).toBeNull();
	});

	it("fails an element whose computed role is not a control's", () => {
		expect(verdict(focused({ tag: "li" }), inspection(["click"], "listitem"))).toEqual([
			"failed",
			"handler-without-role",
		]);
	});

	it("asks for review of a custom element whose internals could not be read", () => {
		expect(verdict(focused({ customElement: true, handlers: ["onclick"] }))).toEqual([
			"review",
			"custom-element",
		]);
	});

	it("fails a custom element the browser says is generic", () => {
		expect(verdict(focused({ customElement: true }), inspection(["click"], "generic"))).toEqual([
			"failed",
			"handler-without-role",
		]);
	});

	it("asks for review when only the pointer cursor suggests a control", () => {
		expect(verdict(focused({ cursorPointer: true }))).toEqual(["review", "pointer-cursor"]);
	});

	it("ignores a focusable element with no sign of being a control", () => {
		expect(verdict(focused(), inspection(["scroll"], "generic"))).toBeNull();
	});
});

describe("classifyCandidates: nested candidates", () => {
	it("drops a review of an element around a failed control", () => {
		const results = classifyCandidates(
			[
				candidate({ index: 0, cursorPointer: true, cursorSetHere: true }),
				candidate({ index: 1, parent: 0, handlers: ["onclick"] }),
			],
			null,
		);

		expect(results.map((result) => result.index)).toEqual([1]);
	});

	it("drops a review of an element inside a failed control, however deep", () => {
		const results = classifyCandidates(
			[
				candidate({ index: 0, handlers: ["onclick"] }),
				candidate({ index: 1, parent: 0 }),
				candidate({ index: 2, parent: 1 }),
			],
			[inspection(), inspection(), inspection(["mousedown"])],
		);

		expect(results.map((result) => result.index)).toEqual([0]);
	});

	it("keeps a failed control inside another failed control", () => {
		const results = classifyCandidates(
			[
				candidate({ index: 0, handlers: ["onclick"] }),
				candidate({ index: 1, parent: 0, handlers: ["onclick"] }),
			],
			null,
		);

		expect(results.map((result) => [result.index, result.verdict])).toEqual([
			[0, "failed"],
			[1, "failed"],
		]);
	});

	it("matches inspections to candidates by index", () => {
		const results = classifyCandidates(
			[candidate({ index: 0 }), candidate({ index: 1 })],
			[inspection(), inspection(["click"])],
		);

		expect(results.map((result) => result.index)).toEqual([1]);
	});
});

/** A sample of what React attaches to a root: every event it supports, used or not. */
const FRAMEWORK_EVENTS = [
	"click",
	"dblclick",
	"mousedown",
	"mouseup",
	"keydown",
	"keyup",
	"focusin",
	"focusout",
	"change",
	"input",
	"submit",
	"reset",
	"invalid",
	"scroll",
	"paste",
];

describe("classifyCandidates: delegated and page-wide listeners", () => {
	it("ignores an unreached element carrying a framework's whole event set", () => {
		expect(verdict(candidate(), inspection(FRAMEWORK_EVENTS))).toBeNull();
		expect(
			verdict(
				candidate({ containerLike: true, cursorPointer: true }),
				inspection(FRAMEWORK_EVENTS),
			),
		).toBeNull();
	});

	it("still fails a framework root that declares a widget role or has its own onclick", () => {
		expect(
			verdict(candidate({ role: "button", widgetRole: true }), inspection(FRAMEWORK_EVENTS)),
		).toEqual(["failed", "widget-role"]);
		expect(verdict(candidate({ handlers: ["onclick"] }), inspection(FRAMEWORK_EVENTS))).toEqual([
			"failed",
			"click-handler",
		]);
	});

	it("does not take a control with many pointer and key listeners for a framework root", () => {
		const rich = [
			"click",
			"dblclick",
			"mousedown",
			"mouseup",
			"mouseenter",
			"mouseleave",
			"keydown",
			"keyup",
			"focus",
			"blur",
			"touchstart",
			"touchend",
		];

		expect(verdict(candidate(), inspection(rich))).toEqual(["failed", "click-handler"]);
	});

	it("asks for review of a focused element carrying a framework's whole event set", () => {
		expect(verdict(focused(), inspection(FRAMEWORK_EVENTS, "generic"))).toEqual([
			"review",
			"container-handler",
		]);
	});

	it("asks for review of a focused element with listeners that holds other tab stops", () => {
		expect(
			verdict(focused({ holdsTabbable: true }), inspection(["click", "keydown"], "generic")),
		).toEqual(["review", "container-handler"]);
		expect(verdict(focused({ holdsTabbable: true, handlers: ["onclick"] }))).toEqual([
			"review",
			"container-handler",
		]);
		// With no listener at all it is a scrolling region, and not reported.
		expect(verdict(focused({ holdsTabbable: true }), inspection([], "generic"))).toBeNull();
	});

	/** `listening` unreached elements with a click listener among `total`, plus `extra`. */
	function page(total: number, listening: number, extra: RawCandidate[] = []) {
		const candidates = [
			...Array.from({ length: total }, (_, index) => candidate({ index })),
			...extra.map((one, offset) => ({ ...one, index: total + offset })),
		];
		const inspections = candidates.map((_, index) =>
			inspection(index < listening || index >= total ? ["click"] : []),
		);

		return classifyCandidates(candidates, inspections).map((result) => [
			result.index,
			result.verdict,
			result.reason,
		]);
	}

	it("asks for review of click listeners that sit on most elements of the page", () => {
		const results = page(30, 30);

		expect(results).toHaveLength(30);
		expect(new Set(results.map(([, ...rest]) => rest.join(" ")))).toEqual(
			new Set(["review blanket-listener"]),
		);
	});

	it("keeps failing the elements with more than the page-wide listener to show for it", () => {
		const results = page(30, 30, [
			candidate({ handlers: ["onclick"] }),
			candidate({ cursorPointer: true, cursorSetHere: true }),
			candidate({ role: "button", widgetRole: true }),
		]);

		expect(results.slice(30)).toEqual([
			[30, "failed", "click-handler"],
			[31, "failed", "click-handler"],
			[32, "failed", "widget-role"],
		]);
	});

	it("fails click listeners as usual when few elements have one or the page is small", () => {
		expect(page(30, 10).filter(([, verdict]) => verdict === "failed")).toHaveLength(10);
		expect(page(10, 10).filter(([, verdict]) => verdict === "failed")).toHaveLength(10);
	});

	it("asks for review of a focused element whose only sign is the page-wide click listener", () => {
		expect(page(30, 30, [focused()]).at(-1)).toEqual([30, "review", "blanket-listener"]);
		expect(page(30, 30, [focused({ handlers: ["onkeydown"] })]).at(-1)).toEqual([
			30,
			"failed",
			"handler-without-role",
		]);
	});
});
