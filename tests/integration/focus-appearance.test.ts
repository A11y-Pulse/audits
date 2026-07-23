import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PuppeteerAdaptor } from "../../src/adaptors/puppeteer";
import {
	type FocusAppearanceOptions,
	type FocusAppearanceResult,
	runFocusAppearanceAudit,
} from "../../src/index";
import {
	type FixtureServer,
	startFixtureServer,
} from "./helpers/serve-fixtures";

let server: FixtureServer;
let browser: Browser;

beforeAll(async () => {
	server = await startFixtureServer();
	browser = await puppeteer.launch();
});

afterAll(async () => {
	await browser.close();
	await server.close();
});

async function runFixture(
	name: string,
	options?: FocusAppearanceOptions,
): Promise<FocusAppearanceResult> {
	const page: Page = await browser.newPage();

	try {
		await page.goto(`${server.url}/${name}`, { waitUntil: "load" });

		return await runFocusAppearanceAudit(new PuppeteerAdaptor(page), options);
	} finally {
		await page.close();
	}
}

describe("focus appearance audit (integration)", () => {
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
		// `filter` is not in the computed-style allowlist, so this can only pass
		// via the screenshot/pixel-diff fallback.
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
		// The element lives in an open shadow root and has an outline focus style.
		// Passing via "style" (not "pixel-diff") proves baselineScript snapshotted
		// it, i.e. the style stage descends shadow roots.
		const result = await runFixture("shadow-dom-pass.html");
		const passed = result.elements.filter((e) => e.passed);
		expect(passed).toHaveLength(1);
		expect(passed[0]?.detectionMethod).toBe("style");
	});

	it("falls back to pixel diff for every element when skipStyleCheck is set", async () => {
		// box-shadow.html passes via "style" by default. With the style stage
		// skipped, the same visible indicator must instead be caught by the pixel
		// diff, proving skipStyleCheck routes detection through the fallback.
		const result = await runFixture("box-shadow.html", {
			skipStyleCheck: true,
		});
		const passed = result.elements.filter((e) => e.passed);
		expect(passed).toHaveLength(1);
		expect(passed[0]?.detectionMethod).toBe("pixel-diff");
	});

	it("detects a focus indicator inside a closed shadow root via the pixel diff", async () => {
		// document.activeElement resolves to the host (closed roots can't be
		// traversed), so the style stage can't see the inner button's outline. The
		// pixel diff captures the focused frame before blurring, so the indicator
		// is still caught even though the host can't be re-focused into the root.
		const result = await runFixture("closed-shadow.html");
		expect(result.summary.checked).toBe(1);
		expect(result.summary.passed).toBe(1);

		const [element] = result.elements;
		expect(element?.selector).toBe("#host");
		expect(element?.detectionMethod).toBe("pixel-diff");
	});

	it("keeps checking elements after a closed-shadow host", async () => {
		// The closed-shadow host is caught by the pixel diff, which disturbs focus
		// (blur, then a host re-focus that lands on <body>). This guards that the
		// audit still reaches the elements after it rather than aborting the page.
		const result = await runFixture("closed-shadow-then-buttons.html");
		expect(result.summary.checked).toBe(3);

		const bySelector = new Map(result.elements.map((e) => [e.selector, e]));
		expect(bySelector.get("#host")?.detectionMethod).toBe("pixel-diff");
		// The trailing buttons still match their baseline snapshot (captured before
		// the host's blur/refocus churn) and pass via the style stage.
		expect(bySelector.get("#after-1")?.detectionMethod).toBe("style");
		expect(bySelector.get("#after-2")?.detectionMethod).toBe("style");
	});

	it("runs on every navigation when one page is reused", async () => {
		// Mirrors production: one page, multiple navigations, no manual re-focus.
		// ensureFocusReporting must keep document.hasFocus() true across all of them.
		const page = await browser.newPage();

		try {
			const runOnce = async () => {
				await page.goto(`${server.url}/all-fail.html`, { waitUntil: "load" });

				return runFocusAppearanceAudit(new PuppeteerAdaptor(page));
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
});
