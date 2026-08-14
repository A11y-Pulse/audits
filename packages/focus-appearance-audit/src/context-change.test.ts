import { describe, expect, it } from "vitest";
import {
	type ContextChangeSignals,
	classifyContextSignals,
	isSameFocusSubtree,
} from "./context-change";

function signals(
	partial: Partial<ContextChangeSignals> = {},
): ContextChangeSignals {
	return {
		openedWindow: false,
		submittedForm: false,
		focusRemoved: false,
		redirect: null,
		softUrlChange: false,
		navigation: false,
		...partial,
	};
}

describe("classifyContextSignals", () => {
	it("flags new-window as a violation", () => {
		expect(classifyContextSignals(signals({ openedWindow: true }))).toEqual([
			{ kind: "new-window", bucket: "violation" },
		]);
	});

	it("flags auto-submit as a violation", () => {
		expect(classifyContextSignals(signals({ submittedForm: true }))).toEqual([
			{ kind: "auto-submit", bucket: "violation" },
		]);
	});

	it("flags focus-removed as a violation", () => {
		expect(classifyContextSignals(signals({ focusRemoved: true }))).toEqual([
			{ kind: "focus-removed", bucket: "violation" },
		]);
	});

	it("flags redirect outside the subtree as a violation", () => {
		expect(classifyContextSignals(signals({ redirect: "outside" }))).toEqual([
			{ kind: "focus-redirected-outside", bucket: "violation" },
		]);
	});

	it("flags same-subtree redirect as incomplete", () => {
		expect(
			classifyContextSignals(signals({ redirect: "same-subtree" })),
		).toEqual([
			{ kind: "focus-redirected-same-subtree", bucket: "incomplete" },
		]);
	});

	it("flags soft URL change as incomplete", () => {
		expect(classifyContextSignals(signals({ softUrlChange: true }))).toEqual([
			{ kind: "url-changed", bucket: "incomplete" },
		]);
	});

	it("flags full navigation as a violation", () => {
		expect(classifyContextSignals(signals({ navigation: true }))).toEqual([
			{ kind: "navigation", bucket: "violation" },
		]);
	});

	it("returns nothing for a clean tab stop", () => {
		expect(classifyContextSignals(signals())).toEqual([]);
	});

	it("prefers navigation over soft URL change when both are set", () => {
		expect(
			classifyContextSignals(
				signals({ navigation: true, softUrlChange: true }),
			),
		).toEqual([{ kind: "navigation", bucket: "violation" }]);
	});
});

describe("isSameFocusSubtree", () => {
	it("treats an element as inside its own subtree", () => {
		const el = { parentNode: null } as unknown as Element;
		expect(isSameFocusSubtree(el, el)).toBe(true);
	});

	it("treats a descendant as same-subtree", () => {
		const parent = { parentNode: null } as unknown as Element;
		const child = { parentNode: parent } as unknown as Element;
		expect(isSameFocusSubtree(parent, child)).toBe(true);
	});

	it("treats an ancestor as same-subtree", () => {
		const parent = { parentNode: null } as unknown as Element;
		const child = { parentNode: parent } as unknown as Element;
		expect(isSameFocusSubtree(child, parent)).toBe(true);
	});

	it("treats an unrelated element as outside", () => {
		const a = { parentNode: null } as unknown as Element;
		const b = { parentNode: null } as unknown as Element;
		expect(isSameFocusSubtree(a, b)).toBe(false);
	});

	it("treats a shadow child as same-subtree of its host", () => {
		const host = { parentNode: null } as unknown as Element;
		const shadowRoot = {
			host,
			parentNode: null,
		} as unknown as ShadowRoot;
		const child = { parentNode: shadowRoot } as unknown as Element;

		expect(isSameFocusSubtree(host, child)).toBe(true);
	});
});
