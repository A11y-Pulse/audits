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

describe("focus not obscured (integration)", () => {
	it("flags an element fully covered by a sticky footer", async () => {
		const result = await runFixture("sticky-footer-obscures.html", {
			obscuringRecheckDelay: 50,
		});
		expect(result.summary.obscured.violations).toBeGreaterThanOrEqual(1);

		const obscured = result.elements.find(
			(e) => e.obscured?.fullyObscured && e.obscured.opacity === "opaque",
		);
		expect(obscured?.obscured?.obscuredBy?.html).toMatch(/sticky-footer/);
	});

	it("passes a clean page with no overlays", async () => {
		const result = await runFixture("obscuring-clean.html");
		expect(result.summary.obscured.violations).toBe(0);
		expect(result.summary.obscured.incomplete).toBe(0);
		expect(result.summary.obscured.checked).toBeGreaterThanOrEqual(2);
	});

	it("does not violate for a semi-transparent full cover", async () => {
		const result = await runFixture("semi-transparent-overlay.html", {
			obscuringRecheckDelay: 50,
		});
		expect(result.summary.obscured.violations).toBe(0);

		const covered = result.elements.find((e) => e.obscured?.fullyObscured);
		expect(covered?.obscured?.opacity).toBe("semi-transparent");
	});
});

describe("context change on focus (integration)", () => {
	it("flags window.open on focus without opening a real window", async () => {
		const page = await browser.newPage();
		const popupPromise = new Promise<boolean>((resolve) => {
			page.once("popup", () => resolve(true));
			setTimeout(() => resolve(false), 500);
		});

		try {
			await page.goto(`${server.url}/new-window-on-focus.html`, {
				waitUntil: "load",
			});
			const result = await runFocusAppearanceAudit(new PuppeteerAdaptor(page));
			const popupOpened = await popupPromise;

			expect(popupOpened).toBe(false);
			expect(result.summary.contextChange.violations).toBeGreaterThanOrEqual(1);
			expect(
				result.elements.some((e) =>
					e.contextChange?.some((f) => f.kind === "new-window"),
				),
			).toBe(true);
		} finally {
			await page.close();
		}
	});

	it("flags auto-submit on focus and keeps the page on the fixture", async () => {
		const page = await browser.newPage();

		try {
			await page.goto(`${server.url}/auto-submit-on-focus.html`, {
				waitUntil: "load",
			});
			const result = await runFocusAppearanceAudit(new PuppeteerAdaptor(page));

			expect(
				result.elements.some((e) =>
					e.contextChange?.some((f) => f.kind === "auto-submit"),
				),
			).toBe(true);
			expect(page.url()).toContain("auto-submit-on-focus.html");
		} finally {
			await page.close();
		}
	});

	it("flags F55 focus removal", async () => {
		const result = await runFixture("focus-removal.html");
		expect(
			result.elements.some((e) =>
				e.contextChange?.some((f) => f.kind === "focus-removed"),
			),
		).toBe(true);
	});

	it("flags focus theft to an unrelated element", async () => {
		const result = await runFixture("focus-theft.html");
		expect(
			result.elements.some((e) =>
				e.contextChange?.some((f) => f.kind === "focus-redirected-outside"),
			),
		).toBe(true);
	});

	it("does not flag same-subtree focus delegation as a violation", async () => {
		const result = await runFixture("focus-delegation.html");
		expect(result.summary.contextChange.violations).toBe(0);
		expect(
			result.elements.some((e) =>
				e.contextChange?.some((f) => f.kind === "focus-redirected-outside"),
			),
		).toBe(false);
	});

	it("aborts when focus triggers navigation", async () => {
		const result = await runFixture("navigation-on-focus.html");
		expect(result.summary.abortedForNavigation).toBe(true);
		expect(
			result.elements.some((e) =>
				e.contextChange?.some((f) => f.kind === "navigation"),
			),
		).toBe(true);
	});
});
