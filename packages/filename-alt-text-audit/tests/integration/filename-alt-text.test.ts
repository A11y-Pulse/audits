import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	type AdaptorFactories,
	describeEachEngine,
	type FixtureServer,
	startFixtureServer,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type FilenameAltTextResult, runFilenameAltTextAudit } from "../../src/index";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

const adaptors: AdaptorFactories<BrowserAdaptor> = {
	puppeteer: (page) => new PuppeteerAdaptor(page),
	playwright: (page) => new PlaywrightAdaptor(page),
};

describeEachEngine<BrowserAdaptor>(
	"filename alt text audit (integration)",
	{ adaptor: adaptors },
	(engine) => {
		async function runFixture(name: string): Promise<FilenameAltTextResult> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);

				return await runFilenameAltTextAudit(page.adaptor);
			} finally {
				await page.close();
			}
		}

		it("fails alt text that is the image's filename and reviews the filename stem", async () => {
			const result = await runFixture("filename-match.html");

			expect(result.failed).toMatchObject([
				{
					selector: "#filename",
					altText: "IMG_4032.svg",
					signal: "filename-match",
					matchedSource: `${server.url}/images/IMG_4032.svg`,
				},
			]);
			expect(result.needsReview).toMatchObject([
				{ selector: "#stem", signal: "filename-near-match" },
			]);
		});

		it("matches filenames from srcset and picture sources", async () => {
			const result = await runFixture("srcset-match.html");

			expect(result.failed.map((image) => image.selector)).toEqual(["#picture", "#srcset"]);
		});

		it("routes filename and placeholder patterns to review", async () => {
			const result = await runFixture("patterns.html");

			expect(result.failed).toEqual([]);
			expect(result.needsReview.map(({ selector, signal }) => ({ selector, signal }))).toEqual([
				{ selector: "#filename-like", signal: "filename-like" },
				{ selector: "#camera", signal: "camera-name" },
				{ selector: "#placeholder", signal: "placeholder" },
				{ selector: "#dimensions", signal: "placeholder" },
				{ selector: "#image-input", signal: "placeholder" },
			]);
		});

		it("applies the page language's placeholder words alongside English", async () => {
			const result = await runFixture("placeholder-swedish.html");

			expect(result.needsReview.map((image) => image.selector)).toEqual(["#swedish", "#english"]);
			expect(result.passed.map((image) => image.selector)).toEqual(["#descriptive"]);
		});

		it("passes descriptive alt text, domain names and images rescued by aria-label", async () => {
			const result = await runFixture("passes.html");

			expect(result.summary).toEqual({
				checked: 5,
				failed: 0,
				needsReview: 0,
				passed: 5,
				unchecked: 0,
			});
		});

		it("checks nothing on a page whose images have no exposed alt text", async () => {
			const result = await runFixture("inapplicable.html");

			expect(result.summary.checked).toBe(0);
		});

		it("checks images inside open shadow roots", async () => {
			const result = await runFixture("shadow-dom.html");

			expect(result.failed).toHaveLength(1);
			expect(result.failed[0]?.html).toContain('id="shadow-image"');
		});

		it("leaves nothing behind in the page", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/patterns.html`);
				await runFilenameAltTextAudit(page.adaptor);

				const leftover = await page.adaptor.evaluate(() =>
					Object.keys(window).filter((key) => key.startsWith("__a11yPulse")),
				);

				expect(leftover).toEqual([]);
			} finally {
				await page.close();
			}
		});
	},
);
