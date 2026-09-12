import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	type AdaptorFactories,
	describeEachEngine,
	WEBKIT_PARTIAL_TAB_LOOP,
} from "@a11y-pulse/integration-harness";
import { PlaywrightAdaptor as ReflowPlaywrightAdaptor } from "@a11y-pulse/reflow-audit/playwright";
import { PuppeteerAdaptor as ReflowAdaptor } from "@a11y-pulse/reflow-audit/puppeteer";
import { PlaywrightAdaptor as TextSpacingPlaywrightAdaptor } from "@a11y-pulse/text-spacing-audit/playwright";
import { PuppeteerAdaptor as TextSpacingAdaptor } from "@a11y-pulse/text-spacing-audit/puppeteer";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type AuditAdaptors, runAllAudits } from "../../src/run-audits";
import { toJson } from "../../src/serialise";
import { type FixtureServer, startFixtureServer } from "./helpers/serve-fixtures";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer();
});

afterAll(async () => {
	await server.close();
});

const adaptors: AdaptorFactories<AuditAdaptors> = {
	puppeteer: (page) => ({
		browser: new PuppeteerAdaptor(page),
		reflow: new ReflowAdaptor(page),
		textSpacing: new TextSpacingAdaptor(page),
	}),
	playwright: (page) => ({
		browser: new PlaywrightAdaptor(page),
		reflow: new ReflowPlaywrightAdaptor(page),
		textSpacing: new TextSpacingPlaywrightAdaptor(page),
	}),
};

describeEachEngine<AuditAdaptors>(
	"runAllAudits (integration)",
	{
		adaptor: adaptors,
		screenshotClipScale: 2,
		viewport: { width: 1280, height: 800 },
		unsupported: {
			"playwright-webkit": WEBKIT_PARTIAL_TAB_LOOP,
		},
	},
	(engine) => {
		it("reports a result for every audit and leaves the page restored", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/kitchen-sink.html`);

			const result = await runAllAudits(page.adaptor, {
				focusAppearance: { skipStyleCheck: true },
			});

			expect(result.url).toBe(`${server.url}/kitchen-sink.html`);
			expect(Object.keys(result.audits)).toEqual([
				"focusAppearance",
				"focusNotObscured",
				"contextChangeOnFocus",
				"skipLink",
				"textSpacing",
				"reflow",
			]);

			expect(result.audits.focusAppearance.elements.length).toBeGreaterThan(0);
			expect(result.audits.focusNotObscured.elements.length).toBeGreaterThan(0);
			expect(result.audits.contextChangeOnFocus.elements.length).toBeGreaterThan(0);
			expect(result.audits.skipLink.summary.found).toBe(1);
			expect(result.audits.reflow.restored).toBe(true);
			expect(result.audits.textSpacing.restored).toBe(true);

			expect(page.viewportSize()).toMatchObject({ width: 1280, height: 800 });
			await page.close();
		});

		it("tabs the page once for all three tab-driven audits", async () => {
			const page = await engine.newPage();

			await page.goto(`${server.url}/kitchen-sink.html`);

			const result = await runAllAudits(page.adaptor, {
				focusAppearance: { skipStyleCheck: true },
			});
			const stops = result.audits.focusNotObscured.elements.length;

			expect(result.audits.focusAppearance.elements).toHaveLength(stops);
			expect(result.audits.contextChangeOnFocus.elements).toHaveLength(stops);

			const tabs = page.keyPresses.filter((key) => key === "Tab").length;
			const skipLinkTabs = result.audits.skipLink.summary.found > 0 ? tabs - stops - 1 : 0;
			expect(skipLinkTabs).toBeLessThanOrEqual(3);

			await page.close();
		});

		it("serialises screenshot evidence as base64", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/kitchen-sink.html`);

			const result = await runAllAudits(page.adaptor, {
				focusAppearance: { skipStyleCheck: true },
			});
			const parsed = JSON.parse(toJson(result));

			const obscured = parsed.audits.focusNotObscured.elements.find(
				(element: { bucket: string }) => element.bucket === "violation",
			);

			expect(typeof obscured.screenshot).toBe("string");
			expect(Buffer.from(obscured.screenshot, "base64").subarray(0, 4)).toEqual(
				Buffer.from([0x89, 0x50, 0x4e, 0x47]),
			);

			await page.close();
		});
	},
);
