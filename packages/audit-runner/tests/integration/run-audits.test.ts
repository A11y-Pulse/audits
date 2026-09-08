import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runAllAudits } from "../../src/run-audits";
import { toJson } from "../../src/serialise";
import { type FixtureServer, startFixtureServer } from "./helpers/serve-fixtures";

let server: FixtureServer;
let browser: Browser;

beforeAll(async () => {
	server = await startFixtureServer();
	browser = await puppeteer.launch({ defaultViewport: { width: 1280, height: 800 } });
});

afterAll(async () => {
	await browser.close();
	await server.close();
});

describe("runAllAudits (integration)", () => {
	it("reports a result for every audit and leaves the page restored", async () => {
		const page = await browser.newPage();
		await page.goto(`${server.url}/kitchen-sink.html`);

		const result = await runAllAudits(page, { focusAppearance: { skipStyleCheck: true } });

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

		expect(page.viewport()).toMatchObject({ width: 1280, height: 800 });
		await page.close();
	});

	it("tabs the page once for all three tab-driven audits", async () => {
		const page = await browser.newPage();
		const press = page.keyboard.press.bind(page.keyboard);
		let tabs = 0;
		page.keyboard.press = async (key, opts) => {
			if (key === "Tab") {
				tabs++;
			}

			return press(key, opts);
		};

		await page.goto(`${server.url}/kitchen-sink.html`);

		const result = await runAllAudits(page, { focusAppearance: { skipStyleCheck: true } });
		const stops = result.audits.focusNotObscured.elements.length;

		expect(result.audits.focusAppearance.elements).toHaveLength(stops);
		expect(result.audits.contextChangeOnFocus.elements).toHaveLength(stops);

		const skipLinkTabs = result.audits.skipLink.summary.found > 0 ? tabs - stops - 1 : 0;
		expect(skipLinkTabs).toBeLessThanOrEqual(3);

		await page.close();
	});

	it("serialises screenshot evidence as base64", async () => {
		const page = await browser.newPage();
		await page.goto(`${server.url}/kitchen-sink.html`);

		const result = await runAllAudits(page, { focusAppearance: { skipStyleCheck: true } });
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
});
