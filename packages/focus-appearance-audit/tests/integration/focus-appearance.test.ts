import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	type AdaptorFactories,
	describeEachEngine,
	WEBKIT_PARTIAL_TAB_LOOP,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	type FocusAppearanceOptions,
	type FocusAppearanceResult,
	runFocusAppearanceAudit,
} from "../../src/index";
import { type FixtureServer, startFixtureServer } from "./helpers/serve-fixtures";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer();
});

afterAll(async () => {
	await server.close();
});

const adaptors: AdaptorFactories<BrowserAdaptor> = {
	puppeteer: (page) => new PuppeteerAdaptor(page),
	playwright: (page) => new PlaywrightAdaptor(page),
};

describeEachEngine<BrowserAdaptor>(
	"focus appearance audit (integration)",
	{
		adaptor: adaptors,
		screenshotClipScale: 2,
		unsupported: {
			"playwright-webkit": WEBKIT_PARTIAL_TAB_LOOP,
		},
	},
	(engine) => {
		async function runFixture(
			name: string,
			options?: FocusAppearanceOptions,
		): Promise<FocusAppearanceResult> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);

				return await runFocusAppearanceAudit(page.adaptor, options);
			} finally {
				await page.close();
			}
		}

		it("passes a page where every element has a focus outline", async () => {
			const result = await runFixture("all-pass.html");
			expect(result.summary.failed).toBe(0);
			expect(result.summary.passed).toBeGreaterThanOrEqual(3);
		});

		it("flags every element when focus styles are suppressed", async () => {
			const result = await runFixture("all-fail.html");
			expect(result.summary.failed).toBeGreaterThanOrEqual(2);
		});

		it("flags only the failing element on a mixed page", async () => {
			const result = await runFixture("mixed.html");
			const failed = result.elements.filter((e) => !e.passed);
			expect(failed).toHaveLength(1);
			expect(failed[0]?.selector).toBe("#bad");
			expect(failed[0]?.html).toContain('id="bad"');
			expect(failed[0]?.html).not.toContain("data-a11y-focus-idx");
		});

		it("passes a box-shadow indicator via the computed-style path", async () => {
			const result = await runFixture("box-shadow.html");
			const passed = result.elements.filter((e) => e.passed);
			expect(passed).toHaveLength(1);
			expect(passed[0]?.detectionMethod).toBe("style");
		});

		it("passes a pseudo-element indicator via the computed-style path", async () => {
			const result = await runFixture("pseudo.html");
			const passed = result.elements.filter((e) => e.passed);
			expect(passed).toHaveLength(1);
			expect(passed[0]?.detectionMethod).toBe("style");
		});

		it("passes a filter-only indicator via the pixel-diff fallback", async () => {
			// `filter` is not in the computed-style allowlist, so this can only pass via the
			// screenshot/pixel-diff fallback.
			const result = await runFixture("filter.html");
			const passed = result.elements.filter((e) => e.passed);
			expect(passed).toHaveLength(1);
			expect(passed[0]?.detectionMethod).toBe("pixel-diff");
		});

		it("fails a focus rule that only changes margin", async () => {
			const result = await runFixture("margin-only.html");
			expect(result.summary.failed).toBe(1);
		});

		it("resolves focusable elements inside an open shadow root", async () => {
			const result = await runFixture("shadow-dom.html");
			const failed = result.elements.filter((e) => !e.passed);
			expect(failed).toHaveLength(2);

			const selectors = failed.map((e) => e.selector);
			expect(new Set(selectors).size).toBe(2);
			expect(selectors).not.toContain("#rnz-site-footer");
		});

		it("detects a shadow-DOM focus indicator via the style stage", async () => {
			// The element lives in an open shadow root and has an outline focus style. Passing via "style"
			// (not "pixel-diff") proves baselineScript snapshotted it, i.e. the style stage descends shadow
			// roots.
			const result = await runFixture("shadow-dom-pass.html");
			const passed = result.elements.filter((e) => e.passed);
			expect(passed).toHaveLength(1);
			expect(passed[0]?.detectionMethod).toBe("style");
		});

		it("falls back to pixel diff for every element when skipStyleCheck is set", async () => {
			// box-shadow.html passes via "style" by default. With the style stage skipped, the same visible
			// indicator must instead be caught by the pixel diff, proving skipStyleCheck routes detection
			// through the fallback.
			const result = await runFixture("box-shadow.html", {
				skipStyleCheck: true,
			});
			const passed = result.elements.filter((e) => e.passed);
			expect(passed).toHaveLength(1);
			expect(passed[0]?.detectionMethod).toBe("pixel-diff");
		});

		// Firefox reports no detection for an element inside a closed shadow root, where Chromium
		// reports a pixel diff.
		it.skipIf(engine.name === "playwright-firefox")(
			"detects a focus indicator inside a closed shadow root via the pixel diff",
			async () => {
				// document.activeElement resolves to the host (closed roots can't be traversed), so the style
				// stage can't see the inner button's outline. The pixel diff captures the focused frame before
				// blurring, so the indicator is still caught even though the host can't be re-focused into the
				// root.
				const result = await runFixture("closed-shadow.html");
				expect(result.summary.checked).toBe(1);
				expect(result.summary.passed).toBe(1);

				const [element] = result.elements;
				expect(element?.selector).toBe("#host");
				expect(element?.detectionMethod).toBe("pixel-diff");
			},
		);

		// Firefox reports no detection for the elements after a closed-shadow host, where Chromium
		// reports a pixel diff.
		it.skipIf(engine.name === "playwright-firefox")(
			"keeps checking elements after a closed-shadow host",
			async () => {
				// The closed-shadow host is caught by the pixel diff, which disturbs focus (blur, then a host
				// re-focus that lands on <body>). This guards that the audit still reaches the elements after
				// it rather than aborting the page.
				const result = await runFixture("closed-shadow-then-buttons.html");
				expect(result.summary.checked).toBe(3);

				const bySelector = new Map(result.elements.map((e) => [e.selector, e]));
				expect(bySelector.get("#host")?.detectionMethod).toBe("pixel-diff");
				// The trailing buttons still match their baseline snapshot (captured before the host's
				// blur/refocus churn) and pass via the style stage.
				expect(bySelector.get("#after-1")?.detectionMethod).toBe("style");
				expect(bySelector.get("#after-2")?.detectionMethod).toBe("style");
			},
		);

		it("ends as completed once the page has been tabbed to the end", async () => {
			// The tab press that leaves the last element takes focus out of the
			// document entirely, which reads identically to a stolen focus. Ending
			// such a session as `lostFocus` would demote every genuine failure on a
			// fully-walked page to `incomplete`.
			const result = await runFixture("all-pass.html");
			expect(result.summary.sessionEnd).toBe("completed");
		});

		it("never invents failures when the page is backgrounded mid-session", async () => {
			const page = await engine.newPage();
			const foreground = await engine.newPage();

			try {
				await page.goto(`${server.url}/all-pass.html`);
				// The loss under test is the one pressTab introduces below, not a page that never had focus
				// at all.
				await page.bringToFront();

				const adaptor = page.adaptor;
				adaptor.ensureFocusReporting = async () => {};
				const pressTab = adaptor.pressTab.bind(adaptor);
				adaptor.pressTab = async () => {
					await pressTab();
					await foreground.bringToFront();
				};

				const result = await runFocusAppearanceAudit(adaptor);

				// The point of the lostFocus handling, and true of every engine: an element the audit could
				// not fairly measure is never reported as failing.
				expect(result.elements.filter((e) => !e.passed)).toEqual([]);
				// A backgrounded Puppeteer page stays blurred, so the audit measures nothing and bails.
				// Playwright's pages still report focus at each measurement and only end up backgrounded
				// once the last Tab has been pressed, so the session reaches its natural end instead.
				expect(result.summary.sessionEnd).toBe(
					engine.driver === "puppeteer" ? "lostFocus" : "completed",
				);
			} finally {
				await foreground.close();
				await page.close();
			}
		});

		it("runs on every navigation when one page is reused", async () => {
			// Mirrors production: one page, multiple navigations, no manual re-focus. ensureFocusReporting
			// must keep document.hasFocus() true across all of them.
			const page = await engine.newPage();

			try {
				const runOnce = async () => {
					await page.goto(`${server.url}/all-fail.html`);

					return runFocusAppearanceAudit(page.adaptor);
				};

				const first = await runOnce();
				const second = await runOnce();
				const third = await runOnce();

				expect(first.summary.failed).toBeGreaterThanOrEqual(2);
				expect(second.summary.failed).toBeGreaterThanOrEqual(2);
				expect(third.summary.failed).toBeGreaterThanOrEqual(2);
			} finally {
				await page.close();
			}
		});
	},
);
