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

		it("reports a form whose positive tabindex takes focus to the foot of the page first", async () => {
			const result = await runFixture("positive-tabindex-form.html");

			expect(result.outcome).toBe("disordered");
			expect(result.positiveTabindex).toBe(true);
			expect(result.summary.checked).toBe(10);
			// One jump: from the form's last field back up to the header.
			expect(result.transitions.map((t) => [t.kind, t.from.selector, t.to.selector])).toEqual([
				["backwards-jump", "#subscribe", "#home"],
			]);

			const [jump] = result.transitions;

			expect(jump?.from.positiveTabindex).toBe(3);
			expect(jump?.to).not.toHaveProperty("positiveTabindex");
			expect(jump?.direction).toBe("up");
			expect(jump?.steps).toBe(1);
			expect(jump?.distance.block).toBe(Math.round(jump!.to.rect.y - jump!.from.rect.y));
			expect(jump?.distance.block).toBeLessThan(-1800);
		});

		it("reports a long list stacked in reverse as one steady drift up the page", async () => {
			const result = await runFixture("column-reverse.html");

			expect(result.outcome).toBe("disordered");
			expect(result.summary.checked).toBe(32);
			expect(result.transitions.map((t) => [t.kind, t.from.selector, t.to.selector])).toEqual([
				["backwards-drift", "#v1", "#v30"],
			]);
			expect(result.transitions[0]?.steps).toBe(29);
			expect(result.transitions[0]?.direction).toBe("up");
			// 29 rows of 40px.
			expect(result.transitions[0]?.distance.block).toBe(-1160);
		});

		it("allows 200 links set in four tall CSS columns", async () => {
			const result = await runFixture("multi-column.html");

			expect(result.outcome).toBe("unremarkable");
			expect(result.transitions).toEqual([]);
			expect(result.summary.checked).toBe(202);
		});

		it("reports a sidebar whose positive tabindex puts it before the header beside it", async () => {
			const result = await runFixture("positive-tabindex-sidebar.html");

			expect(result.outcome).toBe("disordered");
			expect(result.summary.checked).toBe(24);
			// The header sits further along the line and about level with the sidebar's top: a column
			// wrap, were it not for the tabindex.
			expect(result.transitions.map((t) => [t.kind, t.from.selector, t.to.selector])).toEqual([
				["backwards-jump", "#side20", "#home"],
			]);
			expect(result.transitions[0]?.from.positiveTabindex).toBe(20);
			expect(result.transitions[0]?.distance.block).toBeLessThan(-800);
			expect(result.transitions[0]?.distance.inline).toBeGreaterThan(200);
		});

		it("allows running text in tall CSS columns with links part-way along its lines", async () => {
			const result = await runFixture("multi-column-article.html");

			expect(result.outcome).toBe("unremarkable");
			expect(result.transitions).toEqual([]);
			expect(result.summary.checked).toBe(146);
		});

		it("allows a grid filled column by column whose cards hold two controls side by side", async () => {
			const result = await runFixture("column-flow-cards.html");

			expect(result.outcome).toBe("unremarkable");
			expect(result.transitions).toEqual([]);
			expect(result.summary.checked).toBe(98);
		});

		it("reports a reversed feed whose posts each hold two stacked controls", async () => {
			const result = await runFixture("reverse-feed.html");

			expect(result.outcome).toBe("disordered");
			expect(result.summary.checked).toBe(42);
			// The run starts at the lowest control, the first post's reply button, and ends at the
			// highest, the last post's title.
			expect(result.transitions.map((t) => [t.kind, t.from.selector, t.to.selector])).toEqual([
				["backwards-drift", "#reply1", "#post20"],
			]);
			expect(result.transitions[0]?.steps).toBe(37);
			expect(result.transitions[0]?.direction).toBe("up");
			expect(result.transitions[0]?.distance.block).toBeLessThan(-2400);
		});

		it("is silent on a vertical page read from right to left", async () => {
			const result = await runFixture("vertical-rl.html");

			expect(result.outcome).toBe("unremarkable");
			expect(result.summary.checked).toBe(9);
		});

		it("reports a vertical page whose sections sit in the source in reverse", async () => {
			const result = await runFixture("vertical-rl-scramble.html");

			expect(result.outcome).toBe("disordered");
			expect(result.transitions.map((t) => [t.kind, t.from.selector, t.to.selector])).toEqual([
				["backwards-jump", "#stove", "#bag"],
				["backwards-jump", "#bag", "#tent"],
				["backwards-jump", "#tent", "#home"],
			]);
			// Backwards on this page is rightwards on screen.
			expect(result.transitions.map((t) => t.direction)).toEqual(["right", "right", "right"]);
			expect(result.transitions.map((t) => t.distance.block)).toEqual([-1500, -1500, -1500]);
		});

		it("is silent on an app shell whose content scrolls inside a pane", async () => {
			const result = await runFixture("app-shell.html");
			// Firefox makes a scroll container a tab stop even when it holds focusable content.
			const scrollerStops = engine.name === "playwright-firefox" ? 1 : 0;

			expect(result.outcome).toBe("unremarkable");
			expect(result.summary.checked).toBe(47 + scrollerStops);
		});

		it("ignores sticky navigation focused midway down the page", async () => {
			expect((await runFixture("sticky-nav.html")).outcome).toBe("unremarkable");
		});
	},
);
