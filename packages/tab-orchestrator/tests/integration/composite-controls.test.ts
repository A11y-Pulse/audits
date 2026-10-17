import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	describeEachEngine,
	type FixtureServer,
	startFixtureServer,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTabOrchestrator } from "../../src/orchestrator";
import type { TabConsumer } from "../../src/types";

// Each internal stop of the controls costs one Tab press; a stuck loop would run to the marker limit.
const TAB_PRESS_BUDGET = 60;

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

describeEachEngine<BrowserAdaptor>(
	"tab loop over controls with internal stops (integration)",
	{
		adaptor: {
			puppeteer: (page) => new PuppeteerAdaptor(page),
			playwright: (page) => new PlaywrightAdaptor(page),
		},
	},
	(engine) => {
		it("reports each media player, date input and summary once and reaches the last link", async () => {
			const page = await engine.newPage();
			const selectors: string[] = [];
			const consumer: TabConsumer = {
				capabilities: new Set(),
				onTabStop(snapshot) {
					selectors.push(snapshot.activeElement.selector);
				},
			};

			try {
				await page.goto(`${server.url}/composite-controls.html`);
				const orchestrator = createTabOrchestrator(page.adaptor, { screenshotSettleDelay: 0 });
				orchestrator.attach(consumer);
				await orchestrator.run();

				expect(selectors[0]).toBe("#first");
				expect(selectors.at(-1)).toBe("#last");
				expect(new Set(selectors).size).toBe(selectors.length);
				expect(page.keyPresses.filter((key) => key === "Tab").length).toBeLessThan(
					TAB_PRESS_BUDGET,
				);
			} finally {
				await page.close();
			}
		});

		it("keeps going past a date input when the only control after it was added late", async () => {
			const page = await engine.newPage();
			const selectors: string[] = [];
			const consumer: TabConsumer = {
				capabilities: new Set(),
				onTabStop(snapshot) {
					selectors.push(snapshot.activeElement.selector);
				},
			};

			try {
				await page.goto(`${server.url}/date-then-late-content.html`);
				const orchestrator = createTabOrchestrator(page.adaptor, { screenshotSettleDelay: 0 });
				orchestrator.attach(consumer);
				await orchestrator.run();

				expect(selectors).toEqual(["#first", "#departure", "#search"]);
			} finally {
				await page.close();
			}
		});
	},
);
