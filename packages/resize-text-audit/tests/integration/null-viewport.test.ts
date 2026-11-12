import {
	type FixtureServer,
	selectedEngines,
	startFixtureServer,
} from "@a11y-pulse/integration-harness";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PuppeteerAdaptor } from "../../src/adaptors/puppeteer";
import { runResizeTextAudit } from "../../src/index";

function windowSizeScript(): { width: number; height: number } {
	return { width: window.innerWidth, height: window.innerHeight };
}

// A page with no emulated viewport fills its window, which is how Puppeteer runs when it is
// launched with `defaultViewport: null`. The shared harness always emulates one, so this suite
// launches its own browser.
describe.skipIf(!selectedEngines().includes("puppeteer"))(
	"resize text audit with no emulated viewport (puppeteer)",
	() => {
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

		it("halves the window's own size, and leaves the page filling its window again", async () => {
			const page = await browser.newPage();

			try {
				await page.goto(`${server.url}/fixed-height-card.html`);

				const before = await page.evaluate(windowSizeScript);

				// Not the 800x600 an adaptor might assume.
				expect(before.width).toBeGreaterThan(1000);

				const result = await runResizeTextAudit(new PuppeteerAdaptor(page));

				expect(result.originalViewport).toEqual(before);
				expect(result.viewport).toEqual({
					width: Math.round(before.width / 2),
					height: Math.round(before.height / 2),
				});
				expect(result.findings.map((finding) => `${finding.kind} ${finding.selector}`)).toEqual([
					"clipped #t5",
				]);
				expect(result.restored).toBe(true);

				// No emulation is left behind: the page is back to the size of its window.
				expect(page.viewport()).toBeNull();
				expect(await page.evaluate(windowSizeScript)).toEqual(before);
			} finally {
				await page.close();
			}
		});
	},
);
