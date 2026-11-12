// @vitest-environment happy-dom
import type { BrowserAdaptor, ElementRef } from "@a11y-pulse/browser-adaptor";
import { afterEach, describe, expect, it } from "vitest";
import { ComposedTimeoutError, composeScript, runComposed } from "./compose-script";

function headingTextScript(el: Element | null): string {
	return el?.textContent ?? "";
}

function firstHeadingScript(): Element | null {
	return document.querySelector("h1");
}

function countScript(selector: string): number {
	return document.querySelectorAll(selector).length;
}

const outlineScript = composeScript(
	{ firstHeading: firstHeadingScript, headingText: headingTextScript, count: countScript },
	async (ctx, a: { selector: string }) => {
		const heading = await ctx.handle("firstHeading");

		try {
			return {
				title: (await ctx.call("headingText", heading)) as string,
				matches: (await ctx.call("count", a.selector)) as number,
				ranOnHost: ctx.host !== null,
			};
		} finally {
			await ctx.release(heading);
		}
	},
);

/**
 * An adaptor over the test's own document. `evaluate` runs a function from its source alone, as a
 * browser does, so anything the function closes over is missing.
 */
function documentAdaptor(): BrowserAdaptor & { calls: string[] } {
	const calls: string[] = [];
	const detached = (fn: unknown): ((...args: unknown[]) => unknown) =>
		new Function(`return (${String(fn)})`)();

	return {
		calls,
		evaluate: (async (fn: unknown, ...args: unknown[]) => {
			calls.push("evaluate");

			return detached(fn)(...args);
		}) as BrowserAdaptor["evaluate"],
		evaluateHandle: async (fn) => {
			calls.push("evaluateHandle");

			return detached(fn)() as ElementRef;
		},
		disposeRef: async () => {
			calls.push("disposeRef");
		},
		pressTab: async () => {},
		pressEnter: async () => {},
		pressKey: async () => {},
		screenshotClip: async () => new Uint8Array(),
		ensureFocusReporting: async () => {},
	};
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("composeScript", () => {
	it("runs every part in a single call when composed", async () => {
		document.body.innerHTML = "<h1>Orders</h1><p>One</p><p>Two</p>";
		const adaptor = documentAdaptor();

		const result = await runComposed(adaptor, outlineScript, { composed: true }, { selector: "p" });

		expect(result).toEqual({ title: "Orders", matches: 2, ranOnHost: false });
		expect(adaptor.calls).toEqual(["evaluate"]);
	});

	it("makes one call per part, with the same answer, when not composed", async () => {
		document.body.innerHTML = "<h1>Orders</h1><p>One</p><p>Two</p>";
		const adaptor = documentAdaptor();

		const result = await runComposed(
			adaptor,
			outlineScript,
			{ composed: false },
			{ selector: "p" },
		);

		expect(result).toEqual({ title: "Orders", matches: 2, ranOnHost: true });
		expect(adaptor.calls).toEqual(["evaluateHandle", "evaluate", "evaluate", "disposeRef"]);
	});

	it("passes element handles through to the body after its arguments", async () => {
		document.body.innerHTML = "<h1>Orders</h1><h2>Pending</h2>";
		const describe = composeScript(
			{ headingText: headingTextScript },
			async (ctx, a: { prefix: string }, el: ElementRef) =>
				`${a.prefix}${await ctx.call("headingText", el)}`,
		);
		const pending = document.querySelector("h2");

		for (const composed of [true, false]) {
			expect(
				await runComposed(documentAdaptor(), describe, { composed }, { prefix: "> " }, pending),
			).toBe("> Pending");
		}
	});

	it("offers host-only help to a body on the host and none in the page", async () => {
		const stamp = composeScript(
			{ count: countScript },
			async (ctx: { host: { stamp(): string } | null }) => ctx.host?.stamp() ?? "page",
		);
		const host = { stamp: () => "host" };

		expect(await runComposed(documentAdaptor(), stamp, { composed: true, host }, null)).toBe(
			"page",
		);
		expect(await runComposed(documentAdaptor(), stamp, { composed: false, host }, null)).toBe(
			"host",
		);
	});

	it("gives up on a composed call the page never answers, and leaves no rejection behind", async () => {
		const adaptor = documentAdaptor();
		let abandon: (error: Error) => void = () => {};
		adaptor.evaluate = (() =>
			new Promise((_, reject) => {
				abandon = reject;
			})) as BrowserAdaptor["evaluate"];

		await expect(
			runComposed(adaptor, outlineScript, { composed: true, timeoutMs: 20 }, { selector: "p" }),
		).rejects.toBeInstanceOf(ComposedTimeoutError);

		// The abandoned call settles later, as it does when the page finally goes away.
		abandon(new Error("Target closed"));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

	it("does not time a script that runs one part at a time", async () => {
		document.body.innerHTML = "<h1>Orders</h1>";
		const slow = composeScript({ count: countScript }, async (ctx) => {
			await ctx.sleep(40);

			return ctx.call("count", "h1");
		});

		expect(
			await runComposed(documentAdaptor(), slow, { composed: false, timeoutMs: 5 }, null),
		).toBe(1);
	});

	it("sleeps in the page even when the page's setTimeout never fires", async () => {
		const nap = composeScript({ count: countScript }, async (ctx) => {
			const before = performance.now();
			await ctx.sleep(30);

			return performance.now() - before;
		});
		const realSetTimeout = globalThis.setTimeout;

		// What fake timers or a mocked clock leave a page with.
		globalThis.setTimeout = (() => 0) as unknown as typeof setTimeout;

		try {
			const call = runComposed(documentAdaptor(), nap, { composed: true }, null);
			const waited = await Promise.race([
				call,
				new Promise<string>((resolve) => realSetTimeout(() => resolve("hung"), 2000)),
			]);

			expect(waited).not.toBe("hung");
			expect(waited as number).toBeGreaterThanOrEqual(29);
		} finally {
			globalThis.setTimeout = realSetTimeout;
		}
	});

	it("builds the page function only when a composed call first needs it", async () => {
		const realFunction = globalThis.Function;
		let builds = 0;

		// A host that forbids building code from strings refuses exactly this.
		globalThis.Function = function refuse() {
			builds++;

			throw new EvalError("Code generation from strings disallowed for this context");
		} as unknown as FunctionConstructor;

		try {
			const script = composeScript({ count: countScript }, async (ctx) => ctx.call("count", "p"));

			// Composing costs nothing, and neither does running the parts one at a time.
			expect(builds).toBe(0);

			await expect(
				runComposed(documentAdaptor(), script, { composed: true }, null),
			).rejects.toBeInstanceOf(EvalError);
			expect(builds).toBe(1);
		} finally {
			globalThis.Function = realFunction;
		}
	});

	it("tells a body on the host when a part failed because the page navigated", async () => {
		const guarded = composeScript({ count: countScript }, async (ctx) => {
			try {
				return await ctx.call("count", "p");
			} catch (error) {
				return ctx.isDestroyed(error) ? "navigated" : "failed";
			}
		});
		const adaptor = documentAdaptor();
		adaptor.evaluate = (async () => {
			throw new Error("Execution context was destroyed");
		}) as BrowserAdaptor["evaluate"];

		expect(
			await runComposed(
				adaptor,
				guarded,
				{ composed: false, isDestroyed: (error) => /destroyed/.test(String(error)) },
				null,
			),
		).toBe("navigated");
	});
});
