import { describe, expect, it } from "vitest";
import { isSameFocusSubtree } from "./context-signals";

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
