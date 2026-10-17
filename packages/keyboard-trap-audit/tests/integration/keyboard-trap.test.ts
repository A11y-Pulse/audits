import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	describeEachEngine,
	type FixtureServer,
	startFixtureServer,
	WEBKIT_NO_LINK_FOCUS,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runKeyboardTrapAudit } from "../../src/audit";
import type { KeyboardTrapResult } from "../../src/result";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

describeEachEngine<BrowserAdaptor>(
	"keyboard trap audit (integration)",
	{
		adaptor: {
			puppeteer: (page) => new PuppeteerAdaptor(page),
			playwright: (page) => new PlaywrightAdaptor(page),
		},
		unsupported: {
			"playwright-webkit": WEBKIT_NO_LINK_FOCUS,
		},
	},
	(engine) => {
		async function runFixture(name: string): Promise<KeyboardTrapResult> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);

				return await runKeyboardTrapAudit(page.adaptor);
			} finally {
				await page.close();
			}
		}

		it("passes a page whose tab order runs off the end", async () => {
			const result = await runFixture("no-trap.html");

			expect(result.outcome).toBe("no-cycle");
			expect(result.summary.checked).toBe(3);
		});

		it("reports a widget that cycles Tab and Shift+Tab and ignores Escape", async () => {
			const result = await runFixture("hard-trap.html");

			expect(result.outcome).toBe("trapped");
			expect(result.container?.selector).toBe("#widget");
			expect(result.ring.map((element) => element.selector)).toEqual(["#w1", "#w2"]);
			expect(result.excludedCount).toBe(2);
			expect(result.roundsAttempted).toBe(2);
		});

		it("passes a forward-only cycle that Shift+Tab leaves", async () => {
			const result = await runFixture("shift-tab-exit.html");

			expect(result.outcome).toBe("escaped");
			expect(result.escapedVia).toBe("shift-tab");
		});

		it("passes a load-time modal that Escape closes", async () => {
			const result = await runFixture("modal-escape.html");

			expect(result.outcome).toBe("escaped");
			expect(result.escapedVia).toBe("escape-key");
			expect(result.container?.selector).toBe("#dialog");
		});

		it("waits for a modal that Escape closes only after an exit animation", async () => {
			const result = await runFixture("modal-escape-animated.html");

			expect(result.outcome).toBe("escaped");
			expect(result.escapedVia).toBe("escape-key");
		});

		it("resolves a trap whose elements have no ids", async () => {
			const result = await runFixture("hard-trap-no-ids.html");

			expect(result.outcome).toBe("trapped");
			expect(result.ring).toHaveLength(3);
			expect(result.container?.html).toBe('<div class="toolbar">');
		});

		it("passes a trap that pulls focus back when Shift+Tab can still reach the browser's own UI", async () => {
			const result = await runFixture("focusin-trap.html");

			expect(result.outcome).toBe("escaped");
			expect(result.escapedVia).toBe("shift-tab");
		});

		it("reports a trap that pulls focus back from both directions", async () => {
			const result = await runFixture("focusin-trap-both-ways.html");

			expect(result.outcome).toBe("trapped");
			expect(result.container?.selector).toBe("#chat");
		});

		it("reports a load-time modal whose only exit is its close button", async () => {
			const result = await runFixture("modal-close-button-only.html");

			expect(result.outcome).toBe("trapped");
			expect(result.container?.selector).toBe("#dialog");
		});

		it("reports a modal at the end of the page that only cancels Tab at its own edges", async () => {
			const result = await runFixture("edge-cancel-modal.html");

			expect(result.outcome).toBe("trapped");
			expect(result.container?.selector).toBe("#dialog");
		});

		it("never reports a native modal dialog, which Escape closes", async () => {
			const result = await runFixture("native-modal-dialog.html");

			expect(result.outcome).not.toBe("trapped");
		});

		it("reports a native modal dialog that cancels Escape and has no exit", async () => {
			const result = await runFixture("native-modal-no-exit.html");

			expect(result.outcome).toBe("trapped");
			expect(result.container?.selector).toBe("#dialog");
			expect(result.excludedCount).toBe(2);
		});

		it("reports a modal that shuts out the rest of the page with inert and has no exit", async () => {
			const result = await runFixture("inert-modal-no-exit.html");

			expect(result.outcome).toBe("trapped");
			expect(result.container?.selector).toBe("#dialog");
			expect(result.excludedCount).toBe(2);
		});

		it("passes a page whose whole tab order is one small cycle", async () => {
			const result = await runFixture("small-ring.html");

			expect(result.outcome).toBe("small-ring");
			expect(result.ringSize).toBe(3);
		});

		it("never forms a cycle from the stops inside an iframe", async () => {
			const result = await runFixture("iframe-page.html");

			expect(result.outcome).toBe("no-cycle");
		});

		it("treats a widget that re-creates its elements on every Tab as inconclusive", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/dom-churn.html`);
				const result = await runKeyboardTrapAudit(page.adaptor, { elementLimit: 20 });

				expect(result.outcome).toBe("inconclusive");
				expect(result.summary.reachedLimit).toBe(true);
			} finally {
				await page.close();
			}
		});

		it("passes a widget that an arrow key lets focus out of", async () => {
			const result = await runFixture("arrow-exit.html");

			expect(result.outcome).toBe("escaped");
			expect(result.escapedVia).toBe("arrow-key");
		});

		it("treats a trap whose Escape loads another page as inconclusive", async () => {
			const result = await runFixture("escape-navigates.html");

			expect(result.outcome).toBe("inconclusive");
		});

		it("never presses Escape in a search field, which would clear it", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/search-escape.html`);
				const result = await runKeyboardTrapAudit(page.adaptor);
				const value = await page.adaptor.evaluate(
					() => document.querySelector<HTMLInputElement>("#search")?.value,
				);

				expect(result.outcome).toBe("trapped");
				expect(value).toBe("shoes");
			} finally {
				await page.close();
			}
		});

		it("never presses arrows on a splitter, leaving its value unchanged", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/arrow-guard.html`);
				const result = await runKeyboardTrapAudit(page.adaptor);
				const value = await page.adaptor.evaluate(() =>
					document.getElementById("splitter")?.getAttribute("aria-valuenow"),
				);

				expect(result.outcome).toBe("trapped");
				expect(value).toBe("50");
			} finally {
				await page.close();
			}
		});

		it("passes a roving-tabindex carousel, which presents one tab stop", async () => {
			const result = await runFixture("roving-carousel.html");

			expect(result.outcome).toBe("no-cycle");
		});

		it("never presses arrows on a radio, leaving the checked radio unchanged", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/radio-trap.html`);
				const result = await runKeyboardTrapAudit(page.adaptor);
				const checked = await page.adaptor.evaluate(
					() => document.querySelector<HTMLInputElement>("input:checked")?.id,
				);

				expect(result.outcome).toBe("trapped");
				expect(checked).toBe("small");
			} finally {
				await page.close();
			}
		});
	},
);
