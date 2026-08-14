import { describe, expect, it } from "vitest";
import { getSelector } from "./get-selector";

type FakeNode = {
	nodeType: number;
	nodeName: string;
	id?: string;
	classList?: string[];
	parentNode: FakeNode | null;
};

function el(props: Partial<FakeNode> = {}): FakeNode {
	return {
		nodeType: 1,
		nodeName: "DIV",
		id: "",
		classList: [],
		parentNode: null,
		...props,
	};
}

function selectorOf(node: FakeNode | null): string {
	return getSelector(node as unknown as Node);
}

describe("getSelector", () => {
	it("returns an id selector for an element with an id", () => {
		expect(selectorOf(el({ nodeName: "BUTTON", id: "save" }))).toBe("#save");
	});

	it("uses the tag and a single class when there is no id", () => {
		// Without a queryable root there is no rarity information, so the first
		// class is used. Concatenating every class is what made selectors long.
		expect(selectorOf(el({ nodeName: "DIV", classList: ["b", "a"] }))).toBe(
			"div.b",
		);
	});

	it("walks up to and anchors on the nearest ancestor id", () => {
		const parent = el({ nodeName: "SECTION", id: "panel" });
		const child = el({ nodeName: "SPAN", parentNode: parent });
		expect(selectorOf(child)).toBe("#panel>span");
	});

	it("stops at the document node", () => {
		const doc: FakeNode = {
			nodeType: 9,
			nodeName: "#document",
			parentNode: null,
		};
		const body = el({ nodeName: "BODY", parentNode: doc });
		const anchor = el({ nodeName: "A", parentNode: body });
		expect(selectorOf(anchor)).toBe("body>a");
	});

	it("stops at a non-element parent such as a shadow root", () => {
		const shadowRoot: FakeNode = {
			nodeType: 11,
			nodeName: "#document-fragment",
			parentNode: null,
		};
		const button = el({ nodeName: "BUTTON", parentNode: shadowRoot });
		// The walk stops at the fragment instead of reading its (absent) classList.
		expect(selectorOf(button)).toBe("button");
	});

	it("returns an empty string for a null node", () => {
		expect(selectorOf(null)).toBe("");
	});

	it("escapes ids and class names via CSS.escape when available", () => {
		const original = globalThis.CSS;
		globalThis.CSS = {
			escape: (value: string) => value.replace(/[:.]/g, "\\$&"),
		} as unknown as typeof CSS;

		try {
			expect(selectorOf(el({ nodeName: "DIV", id: "col:1" }))).toBe("#col\\:1");
			expect(selectorOf(el({ nodeName: "DIV", classList: ["a:b"] }))).toBe(
				"div.a\\:b",
			);
			expect(selectorOf(el({ nodeName: "DIV", classList: ["c.d"] }))).toBe(
				"div.c\\.d",
			);
		} finally {
			globalThis.CSS = original;
		}
	});

	it("falls back to the bare tag when the element's own segment exceeds the budget", () => {
		// A single class longer than the whole selector budget must not produce
		// an empty selector.
		expect(
			selectorOf(el({ nodeName: "BUTTON", classList: ["x".repeat(200)] })),
		).toBe("button");
	});
});
