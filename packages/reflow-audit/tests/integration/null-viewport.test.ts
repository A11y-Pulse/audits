import {
	type FixtureServer,
	selectedEngines,
	startFixtureServer,
} from "@a11y-pulse/integration-harness";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PuppeteerAdaptor } from "../../src/adaptors/puppeteer";
import { runReflowAudit } from "../../src/index";

// The shared harness always gives a page an emulated viewport, so a browser launched with
// `defaultViewport: null` (the page fills the window) has to be driven with Puppeteer directly.
// Like the harness, this takes Puppeteer's browser to be installed whenever that engine is selected.
const available = selectedEngines().includes("puppeteer");

describe.skipIf(!available)("reflow audit with no emulated viewport (puppeteer)", () => {
	let server: FixtureServer;
	let browser: Browser;

	beforeAll(async () => {
		server = await startFixtureServer(new URL("fixtures", import.meta.url));
		browser = await puppeteer.launch({
			defaultViewport: null,
			args: ["--window-size=1400,1000"],
		});
	});

	afterAll(async () => {
		await browser?.close();
		await server?.close();
	});

	it("measures from the window's real size and leaves the page unemulated", async () => {
		const page = await browser.newPage();

		try {
			await page.goto(`${server.url}/overflowing-element.html`);

			const windowSize = () =>
				page.evaluate(() => ({ width: window.innerWidth, height: window.innerHeight }));
			const before = await windowSize();
			const adaptor = new PuppeteerAdaptor(page);

			expect(page.viewport()).toBeNull();
			expect(before.width).toBe(1400);
			expect(await adaptor.getViewport()).toEqual(before);

			const result = await runReflowAudit(adaptor, { settleDelayMs: 20 });

			expect(result.viewport).toEqual({ width: 320, height: Math.max(before.height, 1024) });
			expect(result.restored).toBe(true);
			expect(result.bucket).toBe("violation");
			// Not left emulated at a made-up size: the page fills its window again.
			expect(page.viewport()).toBeNull();
			expect(await windowSize()).toEqual(before);
		} finally {
			await page.close();
		}
	});
});
