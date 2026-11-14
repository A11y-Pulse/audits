import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	describeEachEngine,
	type FixtureServer,
	pngSize,
	startFixtureServer,
	WEBKIT_NO_LINK_FOCUS,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	createTabOrchestrator,
	OBSCURING_RECHECK_DELAY_MS,
	type TabSessionOptions,
} from "../../src/orchestrator";
import type {
	Capability,
	TabConsumer,
	TabSessionHandle,
	TabSessionStats,
	TabStopSnapshot,
} from "../../src/types";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

type Calls = {
	evaluate: number;
	evaluateHandle: number;
	disposeRef: number;
	screenshotClip: number;
};

/** Wrap an adaptor so every round trip it makes to the browser on the session's behalf is counted. */
function counting(inner: BrowserAdaptor): { adaptor: BrowserAdaptor; calls: Calls } {
	const calls: Calls = { evaluate: 0, evaluateHandle: 0, disposeRef: 0, screenshotClip: 0 };

	const adaptor: BrowserAdaptor = {
		evaluate: (fn, ...args) => {
			calls.evaluate++;

			return inner.evaluate(fn, ...args);
		},
		evaluateHandle: (fn) => {
			calls.evaluateHandle++;

			return inner.evaluateHandle(fn);
		},
		disposeRef: (ref) => {
			calls.disposeRef++;

			return inner.disposeRef(ref);
		},
		pressTab: () => inner.pressTab(),
		pressEnter: () => inner.pressEnter(),
		pressKey: (key) => inner.pressKey(key),
		screenshotClip: (clip, scale) => {
			calls.screenshotClip++;

			return inner.screenshotClip(clip, scale);
		},
		get screenshotClipScale() {
			return inner.screenshotClipScale;
		},
		ensureFocusReporting: () => inner.ensureFocusReporting(),
		takeDismissedDialogs: () => inner.takeDismissedDialogs?.() ?? 0,
	};

	return { adaptor, calls };
}

type Recorder = TabConsumer & { stops: TabStopSnapshot[] };

function recorder(
	capabilities: Capability[] = [],
	onStop?: (snapshot: TabStopSnapshot, session: TabSessionHandle) => void | Promise<void>,
): Recorder {
	const record: Recorder = {
		capabilities: new Set(capabilities),
		stops: [],
		async onTabStop(snapshot, session) {
			record.stops.push(snapshot);
			await onStop?.(snapshot, session);
		},
	};

	return record;
}

async function run(
	adaptor: BrowserAdaptor,
	consumers: TabConsumer[],
	options: TabSessionOptions = {},
): Promise<TabSessionStats> {
	const orchestrator = createTabOrchestrator(adaptor, options);

	for (const consumer of consumers) {
		orchestrator.attach(consumer);
	}

	return orchestrator.run();
}

// What a session costs however many stops it makes: opening and closing it, the checks around
// the press that finds the tab order has run out, and, for a consumer of context signals, one last
// reading of the context observer as the session ends.
const FIXED_EVALUATES = 6;

describeEachEngine<BrowserAdaptor>(
	"cost of the shared tab pass (integration)",
	{
		adaptor: {
			puppeteer: (page) => new PuppeteerAdaptor(page),
			playwright: (page) => new PlaywrightAdaptor(page),
		},
		screenshotClipScale: 2,
		unsupported: { "playwright-webkit": WEBKIT_NO_LINK_FOCUS },
	},
	(engine) => {
		it("spends two page calls on a stop nobody captures", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/many-controls.html`);
				const { adaptor, calls } = counting(page.adaptor);
				const all = recorder();
				const stats = await run(adaptor, [all]);

				expect(stats.endReason).toBe("completed");
				expect(all.stops).toHaveLength(40);
				// One to check the page still has focus before the press, one for everything after it.
				expect(calls.evaluate).toBeLessThanOrEqual(2 * 40 + FIXED_EVALUATES);
				expect(calls.evaluateHandle).toBe(0);
				expect(calls.disposeRef).toBe(0);
				expect(page.keyPresses.filter((key) => key === "Tab")).toHaveLength(41);
			} finally {
				await page.close();
			}
		});

		it("spends no more when context signals, obscuring and baseline styles are all read", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/many-controls.html`);
				const { adaptor, calls } = counting(page.adaptor);
				const all = recorder(["contextSignals", "obscuring", "baselineStyles"]);
				await run(adaptor, [all]);

				expect(all.stops).toHaveLength(40);
				expect(all.stops.every((stop) => stop.obscuring?.fullyObscured === false)).toBe(true);
				expect(all.stops.every((stop) => stop.contextSignals !== undefined)).toBe(true);
				expect(all.stops.every((stop) => stop.baselineStyles !== undefined)).toBe(true);
				expect(calls.evaluate).toBeLessThanOrEqual(2 * 40 + FIXED_EVALUATES);
				expect(calls.evaluateHandle).toBe(0);
			} finally {
				await page.close();
			}
		});

		it("spends three more page calls and one handle on a stop captured as a pair", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/many-controls.html`);
				const { adaptor, calls } = counting(page.adaptor);
				const limit = 8;
				const pairs = recorder(["unfocusedPair"], async (snapshot, session) => {
					const pair = await session.ensureUnfocusedPair();

					expect(pair.focusedScreenshot.length).toBeGreaterThan(0);
					expect(pair.unfocusedScreenshot.length).toBeGreaterThan(0);

					if (snapshot.tabIndex === limit) {
						session.disconnect();
					}
				});
				const stats = await run(adaptor, [pairs]);

				expect(stats.unfocusedPairs).toBe(limit);
				expect(calls.screenshotClip).toBe(2 * limit);
				expect(calls.evaluate).toBeLessThanOrEqual(5 * limit + FIXED_EVALUATES);
				expect(calls.evaluateHandle).toBe(limit);
				expect(calls.disposeRef).toBe(limit);
			} finally {
				await page.close();
			}
		});

		const stopsWith = async (path: string, options: TabSessionOptions) => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${path}`);
				const { adaptor, calls } = counting(page.adaptor);
				const all = recorder(["contextSignals", "obscuring", "baselineStyles"]);
				const stats = await run(adaptor, [all], options);

				return { stops: all.stops, endReason: stats.endReason, evaluates: calls.evaluate };
			} finally {
				await page.close();
			}
		};

		it("reports the same stops whether its scripts travel together or one by one", async () => {
			const together = await stopsWith("many-controls.html", { composeScripts: true });
			const oneByOne = await stopsWith("many-controls.html", { composeScripts: false });

			expect(together.stops).toHaveLength(40);
			expect(together.stops).toEqual(oneByOne.stops);
			expect(together.endReason).toBe(oneByOne.endReason);
			expect(together.evaluates).toBeLessThan(oneByOne.evaluates / 2);
		});

		// Pages that change under the session, where the two ways of running a stop are likeliest to
		// part company: content swapped in as focus arrives, and a control re-rendered on every lap.
		it.each([
			["load-more.html", 13],
			["rerender-trap.html", 3],
		])(
			"reports the same stops either way on a page that changes as it is tabbed: %s",
			async (path, count) => {
				const together = await stopsWith(path, { composeScripts: true });
				const oneByOne = await stopsWith(path, { composeScripts: false });

				expect(together.stops).toHaveLength(count);
				expect(together.stops).toEqual(oneByOne.stops);
				expect(together.endReason).toBe(oneByOne.endReason);
			},
		);

		it("finishes, with the same stops either way, on a page whose setTimeout never fires", async () => {
			const together = await stopsWith("fake-timers.html", { composeScripts: true });
			const oneByOne = await stopsWith("fake-timers.html", { composeScripts: false });

			expect(together.stops.map((stop) => stop.activeElement.selector)).toEqual([
				"#save",
				"#copy",
				"#docs",
				"#share",
				"#source",
			]);
			expect(together.stops).toEqual(oneByOne.stops);
			expect(together.endReason).toBe("completed");
			// Still one call per stop: the wait inside the page ended on an animation frame instead.
			expect(together.evaluates).toBeLessThanOrEqual(2 * 5 + FIXED_EVALUATES);
		});

		it("gives up on the page's clock and carries on when neither timers nor frames fire", async () => {
			const together = await stopsWith("fake-timers.html?frames=off", { composeScripts: true });
			const oneByOne = await stopsWith("fake-timers.html?frames=off", { composeScripts: false });

			// The first stop's script never came back, so the host stopped waiting for it and ran
			// that stop, and the rest, one script at a time.
			expect(together.stops.map((stop) => stop.activeElement.selector)).toEqual([
				"#save",
				"#copy",
				"#docs",
				"#share",
				"#source",
			]);
			expect(together.stops).toEqual(oneByOne.stops);
			expect(together.endReason).toBe("completed");
			expect(together.evaluates).toBeGreaterThan(2 * 5 + FIXED_EVALUATES);
		});

		it("captures the stop's own element after a focus handler has passed focus on", async () => {
			const captureWith = async (composeScripts: boolean) => {
				const page = await engine.newPage();

				try {
					await page.goto(`${server.url}/relay-focus.html`);
					const sizes: Record<string, { width: number; height: number }> = {};
					const focusedAtCapture: Record<string, string> = {};
					const shots = recorder(["screenshot"], async (snapshot, session) => {
						if (snapshot.activeElement.selector !== "#start") {
							return;
						}

						// Another consumer's work, or this one's own, before it gets to capturing:
						// long enough for the page to have moved focus to the field.
						await new Promise((resolve) => setTimeout(resolve, 150));
						focusedAtCapture.start = await page.adaptor.evaluate(
							() => document.activeElement?.id ?? "",
						);
						sizes.start = pngSize(await session.screenshotClip());
					});
					await run(page.adaptor, [shots], { composeScripts });

					return { sizes, focusedAtCapture };
				} finally {
					await page.close();
				}
			};

			// The 80x40 button with the default 10px buffer, at the adaptor's scale of 2. The field
			// focus moved to is 400x200.
			const button = { width: (80 + 20) * 2, height: (40 + 20) * 2 };
			const together = await captureWith(true);
			const oneByOne = await captureWith(false);

			expect(together.focusedAtCapture.start).toBe("details");
			expect(together.sizes.start).toEqual(button);
			expect(oneByOne.sizes.start).toEqual(button);
		});

		it("still sees what a focus handler does on the next frame or in a microtask", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/deferred-focus.html`);
				const all = recorder();
				await run(page.adaptor, [all]);

				const html = Object.fromEntries(
					all.stops.map((stop) => [stop.activeElement.selector, stop.activeElement.html]),
				);

				expect(Object.keys(html)).toEqual(["#plain", "#framed", "#queued", "#eased"]);
				expect(html["#framed"]).toContain('data-focus-state="framed"');
				expect(html["#queued"]).toContain('data-focus-state="queued"');
			} finally {
				await page.close();
			}
		});

		it("attributes what a focus handler does from a short timer to the stop that set it", async () => {
			const signalsWith = async (composeScripts: boolean) => {
				const page = await engine.newPage();

				try {
					await page.goto(`${server.url}/deferred-context.html`);
					const context = recorder(["contextSignals"]);
					await run(page.adaptor, [context], { composeScripts });

					return context.stops.map((stop) => ({
						selector: stop.activeElement.selector,
						openedWindow: stop.contextSignals?.signals.openedWindow,
						redirect: stop.contextSignals?.signals.redirect,
					}));
				} finally {
					await page.close();
				}
			};

			const expected = [
				{ selector: "#before", openedWindow: false, redirect: null },
				// The window opens 20ms after focus arrives: inside the settle delay, so it belongs here.
				{ selector: "#chat", openedWindow: true, redirect: null },
				// Focus was handed on from #relay before the stop was read.
				{ selector: "#after", openedWindow: false, redirect: "outside" },
			];

			expect(await signalsWith(true)).toEqual(expected);
			expect(await signalsWith(false)).toEqual(expected);
		});

		it("gives the page its own setTimeout back when the session ends", async () => {
			const page = await engine.newPage();
			const isNative = () =>
				page.adaptor.evaluate(() =>
					/\[native code\]/.test(Function.prototype.toString.call(window.setTimeout)),
				);

			try {
				await page.goto(`${server.url}/deferred-context.html`);
				let duringSession: boolean | undefined;
				const watcher = recorder([], async () => {
					duringSession ??= await isNative();
				});
				await run(page.adaptor, [watcher]);

				// Watched while the session runs, so it can tell which timers a focus handler set.
				expect(duringSession).toBe(false);
				expect(await isNative()).toBe(true);
			} finally {
				await page.close();
			}
		});

		it("waits for an indicator that eases in before reading its styles", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/deferred-focus.html`);
				const styled = recorder(["baselineStyles"]);
				await run(page.adaptor, [styled]);

				const eased = styled.stops.find((stop) => stop.activeElement.selector === "#eased");

				expect(eased?.baselineStyles?.element["outline-width"]).toBe("0px");
				// Read the instant focus arrives, the transition has not moved off its starting value.
				expect(eased?.activeElement.styles.element["outline-width"]).not.toBe("0px");
			} finally {
				await page.close();
			}
		});

		it("reads computed styles only for a consumer that compares them", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/deferred-focus.html`);
				const plain = recorder(["obscuring"]);
				await run(page.adaptor, [plain]);

				expect(plain.stops).toHaveLength(4);

				for (const stop of plain.stops) {
					expect(stop.activeElement.styles).toEqual({ element: {}, before: {}, after: {} });
					expect(stop.baselineStyles).toBeUndefined();
				}

				const styled = recorder(["baselineStyles"]);
				await run(page.adaptor, [styled]);

				for (const stop of styled.stops) {
					expect(Object.keys(stop.activeElement.styles.element)).toContain("outline-width");
					expect(stop.activeElement.styles.before).toHaveProperty("content");
				}
			} finally {
				await page.close();
			}
		});

		it("does not wait to look again at a cover that shows the page through", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/veiled.html`);
				// Every wait the session makes inside the page is a timer the page can see asked for.
				await page.adaptor.evaluate(() => {
					type Timer = (handler: () => void, ms?: number, ...rest: unknown[]) => number;

					const delays: number[] = [];
					const page = window as unknown as { __delays: number[]; setTimeout: Timer };
					const original = page.setTimeout;

					page.__delays = delays;
					page.setTimeout = (handler, ms, ...rest) => {
						delays.push(ms ?? 0);

						return original.call(window, handler, ms, ...rest);
					};
				});
				const { adaptor, calls } = counting(page.adaptor);
				const covered = recorder(["obscuring"]);
				await run(adaptor, [covered], { screenshotSettleDelay: 0 });

				expect(covered.stops.map((stop) => stop.obscuring)).toEqual(
					Array.from({ length: 4 }, () =>
						expect.objectContaining({
							coveredFraction: 1,
							fullyObscured: true,
							offscreen: false,
							opacity: "semi-transparent",
							obscuredBy: expect.objectContaining({ selector: "#veil", html: '<div id="veil">' }),
						}),
					),
				);
				// A second look at a stop is a wait of the recheck delay inside the page. None was asked
				// for, which says so whatever the machine's load: no wall-clock time is compared.
				const delays = await page.adaptor.evaluate(
					() => (window as unknown as { __delays: number[] }).__delays,
				);

				expect(delays.filter((ms) => ms >= OBSCURING_RECHECK_DELAY_MS)).toEqual([]);
				expect(calls.evaluate).toBeLessThanOrEqual(2 * 4 + FIXED_EVALUATES);

				// The same page with a cover that hides what is behind it does get its second look,
				// which shows the count above would have caught one.
				await page.adaptor.evaluate(() => {
					const veil = document.getElementById("veil") as HTMLElement;
					veil.style.background = "#fff";
					veil.style.opacity = "1";
					(window as unknown as { __delays: number[] }).__delays.length = 0;
				});
				await run(page.adaptor, [recorder(["obscuring"])], { screenshotSettleDelay: 0 });
				const opaqueDelays = await page.adaptor.evaluate(
					() => (window as unknown as { __delays: number[] }).__delays,
				);

				expect(opaqueDelays.filter((ms) => ms >= OBSCURING_RECHECK_DELAY_MS)).toHaveLength(4);

				const leftover = await page.adaptor.evaluate(
					() => document.querySelectorAll("[data-a11y-obscurer]").length,
				);

				expect(leftover).toBe(0);
			} finally {
				await page.close();
			}
		});
	},
);
