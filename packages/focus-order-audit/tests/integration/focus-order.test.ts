import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	describeEachEngine,
	type FixtureServer,
	startFixtureServer,
	WEBKIT_PARTIAL_TAB_LOOP,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runFocusOrderAudit } from "../../src/audit";
import type { FocusOrderResult } from "../../src/result";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

describeEachEngine<BrowserAdaptor>(
	"focus order audit (integration)",
	{
		adaptor: {
			puppeteer: (page) => new PuppeteerAdaptor(page),
			playwright: (page) => new PlaywrightAdaptor(page),
		},
		viewport: { width: 1280, height: 800 },
		unsupported: {
			"playwright-webkit": WEBKIT_PARTIAL_TAB_LOOP,
		},
	},
	(engine) => {
		async function runFixture(name: string): Promise<FocusOrderResult> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);

				return await runFocusOrderAudit(page.adaptor);
			} finally {
				await page.close();
			}
		}

		it("is silent on a conventional header, main and footer flow", async () => {
			const result = await runFixture("ordered.html");

			expect(result.outcome).toBe("unremarkable");
			expect(result.summary.checked).toBe(5);
		});

		it("reports sections whose source order inverts the layout", async () => {
			const result = await runFixture("dom-scramble.html");

			expect(result.outcome).toBe("disordered");
			expect(result.transitions.map((t) => [t.from.selector, t.to.selector])).toEqual([
				["#d1", "#d2"],
				["#d2", "#d3"],
				["#d3", "#d4"],
			]);
			expect(result.positiveTabindex).toBe(false);
		});

		it("reports the same scramble on a right-to-left page", async () => {
			expect((await runFixture("rtl.html")).outcome).toBe("disordered");
		});

		it("reports positive tabindex values that send focus up the page", async () => {
			const result = await runFixture("tabindex-scramble.html");

			expect(result.outcome).toBe("disordered");
			expect(result.positiveTabindex).toBe(true);
		});

		it("allows a two-column form filled in column by column", async () => {
			expect((await runFixture("two-column-form.html")).outcome).toBe("unremarkable");
		});

		it("allows a wide two-column product grid read row by row beside one long jump", async () => {
			const result = await runFixture("product-grid.html");

			expect(result.outcome).toBe("unremarkable");
			expect(result.summary.checked).toBe(9);
		});

		it("leaves out fixed buttons interleaved with content on the other side of the page", async () => {
			expect((await runFixture("pinned-interleaved.html")).outcome).toBe("unremarkable");
		});

		it("reports independent columns read across each other beside a long jump", async () => {
			const result = await runFixture("interleaved-columns.html");

			expect(result.outcome).toBe("disordered");
			expect(result.transitions.map((transition) => transition.kind)).toContain("column-thrash");
		});

		it("leaves CSS reordering within one screen alone", async () => {
			const result = await runFixture("css-order.html");

			expect(result.outcome).toBe("unremarkable");
			expect(result.summary.checked).toBe(8);
		});

		it("ignores sticky navigation focused midway down the page", async () => {
			expect((await runFixture("sticky-nav.html")).outcome).toBe("unremarkable");
		});
	},
);
