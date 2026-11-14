import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import axe from "axe-core";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runAxeCore } from "./axe-core";

type FakeWindow = {
	name: string;
	axe?: { run: (options: unknown) => Promise<unknown> };
	Function: new (source: string) => () => void;
	document: { querySelectorAll: (selector: string) => Array<{ contentWindow: unknown }> };
};

type Fake = {
	window: FakeWindow;
	/** The source evaluated in this window, once per evaluation. */
	evaluated: string[];
	/** The options each `axe.run` in this window was called with. */
	runs: unknown[];
};

/**
 * A stand-in for a window: evaluating a script in it installs an `axe` that records how it is run.
 * `frames` are what its `iframe, frame` elements lead to.
 */
function fakeWindow(name: string, frames: unknown[] = []): Fake {
	const fake: Fake = { evaluated: [], runs: [], window: undefined as unknown as FakeWindow };

	fake.window = {
		name,
		// Constructed with `new`, as the page script does: a constructor that returns a function
		// hands that function back.
		Function: function evaluate(source: string) {
			return () => {
				fake.evaluated.push(source);
				fake.window.axe = {
					run: async (options) => {
						fake.runs.push(options);

						return { ranIn: name };
					},
				};
			};
		} as unknown as FakeWindow["Function"],
		document: {
			querySelectorAll: (selector) => {
				expect(selector).toBe("iframe, frame");

				return frames.map((contentWindow) => ({ contentWindow }));
			},
		},
	};

	return fake;
}

/** An adaptor that runs each page script here, against whatever `window` is stubbed to. */
const inProcess = {
	evaluate: async (script: (...args: unknown[]) => unknown, ...args: unknown[]) => script(...args),
} as unknown as BrowserAdaptor;

function asPage(top: Fake): void {
	vi.stubGlobal("window", top.window);
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe("runAxeCore", () => {
	it("evaluates axe-core's own source in the page, then runs it with the caller's options", async () => {
		const top = fakeWindow("top");
		asPage(top);

		const options = { runOnly: ["wcag2a"] };
		const results = await runAxeCore(inProcess, options);

		expect(top.evaluated).toEqual([axe.source]);
		expect(top.runs).toEqual([options]);
		// What the page's axe-core returned is what the caller gets.
		expect(results).toEqual({ ranIn: "top" });
	});

	it("runs with no options when none are given", async () => {
		const top = fakeWindow("top");
		asPage(top);

		await runAxeCore(inProcess);

		expect(top.runs).toEqual([{}]);
	});

	it("injects into same-origin frames at every depth, and runs only in the top window", async () => {
		const grandchild = fakeWindow("grandchild");
		const child = fakeWindow("child", [grandchild.window]);
		const sibling = fakeWindow("sibling");
		const top = fakeWindow("top", [child.window, sibling.window]);
		asPage(top);

		await runAxeCore(inProcess);

		for (const frame of [top, child, grandchild, sibling]) {
			expect(frame.evaluated, frame.window.name).toEqual([axe.source]);
		}

		// axe-core reaches the frames itself, by messaging the copy inside each.
		expect(top.runs).toHaveLength(1);
		expect(child.runs).toEqual([]);
		expect(grandchild.runs).toEqual([]);
	});

	it("leaves a cross-origin frame alone and still reaches the frames after it", async () => {
		const crossOrigin = {
			get document(): never {
				throw new DOMException("Blocked a frame with origin", "SecurityError");
			},
		};
		const after = fakeWindow("after");
		const top = fakeWindow("top", [crossOrigin, null, after.window]);
		asPage(top);

		await expect(runAxeCore(inProcess)).resolves.toEqual({ ranIn: "top" });

		expect(after.evaluated).toEqual([axe.source]);
	});

	it("does not evaluate axe-core again in a window that already has it", async () => {
		const child = fakeWindow("child");
		const top = fakeWindow("top", [child.window]);
		const existing = { run: vi.fn(async () => ({ ranIn: "existing" })) };
		top.window.axe = existing;
		asPage(top);

		const results = await runAxeCore(inProcess);

		expect(top.evaluated).toEqual([]);
		expect(existing.run).toHaveBeenCalledOnce();
		expect(results).toEqual({ ranIn: "existing" });
		// Its frames are still looked at.
		expect(child.evaluated).toEqual([axe.source]);
	});
});
