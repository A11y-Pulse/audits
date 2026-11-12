import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	describeEachEngine,
	type EnginePage,
	type FixtureServer,
	startFixtureServer,
	WEBKIT_NO_LINK_FOCUS,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTabOrchestrator, type TabSessionOptions } from "../../src/orchestrator";
import type {
	Capability,
	SessionEndDetail,
	SessionEndReason,
	TabConsumer,
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

type Recorder = TabConsumer & {
	stops: TabStopSnapshot[];
	selectors: string[];
	ends: Array<{ reason: SessionEndReason; detail: SessionEndDetail }>;
};

function recorder(
	capabilities: Capability[] = [],
	onStop?: (snapshot: TabStopSnapshot, disconnect: () => void) => void,
): Recorder {
	const record: Recorder = {
		capabilities: new Set(capabilities),
		stops: [],
		selectors: [],
		ends: [],
		onTabStop(snapshot, session) {
			record.stops.push(snapshot);
			record.selectors.push(snapshot.activeElement.selector);
			onStop?.(snapshot, () => session.disconnect());
		},
		onSessionEnd(reason, detail) {
			record.ends.push({ reason, detail });
		},
	};

	return record;
}

const OPTIONS: TabSessionOptions = { screenshotSettleDelay: 0 };

async function session(
	page: EnginePage<BrowserAdaptor>,
	consumers: TabConsumer[],
	options: TabSessionOptions = OPTIONS,
): Promise<TabSessionStats> {
	const orchestrator = createTabOrchestrator(page.adaptor, options);

	for (const consumer of consumers) {
		orchestrator.attach(consumer);
	}

	return orchestrator.run();
}

describeEachEngine<BrowserAdaptor>(
	"tab loop on pages that used to cut it short (integration)",
	{
		adaptor: {
			puppeteer: (page) => new PuppeteerAdaptor(page),
			playwright: (page) => new PlaywrightAdaptor(page),
		},
		unsupported: { "playwright-webkit": WEBKIT_NO_LINK_FOCUS },
	},
	(engine) => {
		it("starts at the top of a page that autofocuses a field part-way down", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/autofocus.html`);
				const all = recorder();
				const stats = await session(page, [all]);

				expect(all.selectors).toEqual(["#home", "#help", "#email", "#password", "#submit"]);
				expect(stats.endReason).toBe("completed");
			} finally {
				await page.close();
			}
		});

		it("starts a second session at the top after the first one stopped early", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/autofocus.html`);
				const early = recorder([], (snapshot, disconnect) => {
					if (snapshot.tabIndex === 3) {
						disconnect();
					}
				});
				await session(page, [early]);
				expect(early.selectors).toEqual(["#home", "#help", "#email"]);

				const second = recorder();
				await session(page, [second]);

				expect(second.selectors).toEqual(["#home", "#help", "#email", "#password", "#submit"]);
			} finally {
				await page.close();
			}
		});

		it("follows positive tabindex from its lowest value, as a fresh page load would", async () => {
			const page = await engine.newPage();
			const expected = ["#pay", "#promo", "#logo", "#name", "#terms"];

			try {
				await page.goto(`${server.url}/positive-tabindex.html`);
				const first = recorder();
				await session(page, [first]);
				expect(first.selectors).toEqual(expected);

				// And again, from wherever the first session left focus.
				const second = recorder();
				await session(page, [second]);
				expect(second.selectors).toEqual(expected);
			} finally {
				await page.close();
			}
		});

		it("carries on past an element that blurs itself", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/self-blur.html`);
				const all = recorder();
				const stats = await session(page, [all]);

				expect(all.selectors).toEqual(["#first", "#third", "#last"]);
				expect(stats.endReason).toBe("completed");
				expect(all.ends).toEqual([{ reason: "completed", detail: { revisitedIndex: null } }]);
			} finally {
				await page.close();
			}
		});

		it("reports the self-blurring element to context consumers and still reaches the rest", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/self-blur.html`);
				const context = recorder(["contextSignals"]);
				const plain = recorder();
				await session(page, [context, plain]);

				expect(context.selectors).toEqual(["#first", "#blurs", "#third", "#last"]);
				expect(context.stops[1]?.contextSignals?.signals.focusRemoved).toBe(true);
				expect(plain.selectors).toEqual(["#first", "#third", "#last"]);
			} finally {
				await page.close();
			}
		});

		it("reaches links in a shadow root that follow a date input", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/date-then-shadow.html`);
				const all = recorder();
				const stats = await session(page, [all]);

				expect(all.selectors).toEqual([
					"#first",
					"#departure",
					'site-footer >>> a[href="#terms"]',
					'site-footer >>> a[href="#privacy"]',
				]);
				expect(stats.endReason).toBe("completed");
			} finally {
				await page.close();
			}
		});

		it("recognises a focus trap that re-renders its controls as a cycle", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/rerender-trap.html`);
				const all = recorder();
				const stats = await session(page, [all]);

				expect(all.selectors).toEqual(["#before", "button.ok", "button.no"]);
				expect(stats.endReason).toBe("completed");
				expect(all.ends).toHaveLength(1);
				// The second visit to "Subscribe" is a new node, but stands where the first one did.
				expect(all.ends[0]?.detail.revisitedIndex).toBe(all.stops[1]?.activeElement.index);
				expect(page.keyPresses.filter((key) => key === "Tab")).toHaveLength(4);
			} finally {
				await page.close();
			}
		});

		it("carries on through a list that swaps its next page in where the last one stood", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/load-more.html`);
				const all = recorder();
				const stats = await session(page, [all]);

				// Twelve different articles, three at a time in the same three places, then the button.
				expect(all.stops.map((stop) => stop.activeElement.html)).toEqual([
					...Array.from({ length: 12 }, (_, n) => `<a href="/articles/${n}">`),
					'<button id="end" type="button">',
				]);
				expect(new Set(all.stops.map((stop) => stop.activeElement.index)).size).toBe(13);
				expect(stats.endReason).toBe("completed");
				expect(all.ends[0]?.detail.revisitedIndex).toBeNull();
			} finally {
				await page.close();
			}
		});

		it("treats a focusable <body> as a tab stop, not as the end of the page", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/body-tabindex.html`);
				const all = recorder();
				const stats = await session(page, [all]);

				expect(all.selectors).toEqual(["body", "#first", "#last"]);
				expect(stats.endReason).toBe("completed");
			} finally {
				await page.close();
			}
		});

		it("dismisses an alert raised on focus instead of hanging, and reports it", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/alert-on-focus.html`);
				const context = recorder(["contextSignals"]);
				const stats = await session(page, [context]);

				expect(context.selectors).toEqual(["#first", "#alerts", "#last"]);
				expect(stats.dialogsDismissed).toBe(1);
				expect(context.stops.map((stop) => stop.contextSignals?.signals.openedDialog)).toEqual([
					false,
					true,
					false,
				]);
			} finally {
				await page.close();
			}
		});

		it("ends with reason limit on a page that never runs out of tab stops", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/endless.html`);
				const all = recorder();
				const stats = await session(page, [all], { ...OPTIONS, maxTabPresses: 12 });

				expect(stats.endReason).toBe("limit");
				expect(all.ends).toEqual([{ reason: "limit", detail: { revisitedIndex: null } }]);
				expect(all.stops).toHaveLength(12);
				expect(page.keyPresses.filter((key) => key === "Tab")).toHaveLength(12);
			} finally {
				await page.close();
			}
		});

		it("keeps the other consumers going when one throws", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/autofocus.html`);
				const broken = recorder([], (snapshot) => {
					if (snapshot.tabIndex === 2) {
						throw new Error("audit bug");
					}
				});
				const healthy = recorder();
				const orchestrator = createTabOrchestrator(page.adaptor, OPTIONS);
				orchestrator.attach(broken);
				orchestrator.attach(healthy);

				await expect(orchestrator.run()).rejects.toThrow("audit bug");

				expect(healthy.selectors).toEqual(["#home", "#help", "#email", "#password", "#submit"]);
				expect(healthy.ends.map((end) => end.reason)).toEqual(["completed"]);
				expect(broken.selectors).toEqual(["#home", "#help"]);
				expect(broken.ends.map((end) => end.reason)).toEqual(["failed"]);
				expect(orchestrator.failures.map((failure) => failure.consumer)).toEqual([broken]);
			} finally {
				await page.close();
			}
		});

		it("ends with reason navigation when focus navigates, without auditing the next page", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/navigates-on-focus.html`);
				const all = recorder();
				const stats = await session(page, [all]);

				expect(stats.endReason).toBe("navigation");
				expect(all.selectors.filter((selector) => selector.startsWith("#other"))).toEqual([]);
				expect(all.selectors[0]).toBe("#first");
			} finally {
				await page.close();
			}
		});

		it("carries on when a page that started to leave stays", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/stays-after-prompt.html`);
				const all = recorder();
				const stats = await session(page, [all]);

				expect(stats.endReason).toBe("completed");
				expect(all.selectors).toEqual(["#first", "#jump", "#last"]);
			} finally {
				await page.close();
			}
		});

		it("reports a soft URL change once, not again when the page re-asserts the same URL", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/soft-url.html`);
				const context = recorder(["contextSignals"]);
				const stats = await session(page, [context]);

				expect(stats.endReason).toBe("completed");
				expect(context.selectors).toEqual(["#hashes", "#restates", "#plain"]);
				expect(context.stops.map((stop) => stop.contextSignals?.signals.softUrlChange)).toEqual([
					true,
					false,
					false,
				]);
			} finally {
				await page.close();
			}
		});

		it("gives the page back its window.open and form submission once the session ends", async () => {
			const page = await engine.newPage();
			let popups = 0;

			try {
				await page.goto(`${server.url}/context-teardown.html`);
				page.onPopup(() => {
					popups++;
				});
				const context = recorder(["contextSignals"]);
				await session(page, [context]);

				expect(context.stops[0]?.contextSignals?.signals.openedWindow).toBe(true);
				expect(popups).toBe(0);

				const after = await page.adaptor.evaluate(() => {
					const form = document.getElementById("search") as HTMLFormElement;
					let reachedPage = false;
					let prevented = true;

					form.addEventListener("submit", (event) => {
						reachedPage = true;
						prevented = event.defaultPrevented;
						// Keep the test on this page; whether anything else cancelled it is already read.
						event.preventDefault();
					});
					form.requestSubmit();

					return {
						reachedPage,
						prevented,
						nativeOpen: /\[native code\]/.test(Function.prototype.toString.call(window.open)),
						nativePushState: /\[native code\]/.test(
							Function.prototype.toString.call(history.pushState),
						),
						observer: "__a11yContextObserver" in window,
						markers: document.querySelectorAll(
							"[data-a11y-focus-idx], [data-a11y-ctx-attr], [data-a11y-pulse-focus-start]",
						).length,
					};
				});

				expect(after).toEqual({
					reachedPage: true,
					prevented: false,
					nativeOpen: true,
					nativePushState: true,
					observer: false,
					markers: 0,
				});
			} finally {
				await page.close();
			}
		});
	},
);
