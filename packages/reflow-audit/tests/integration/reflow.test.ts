import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PuppeteerAdaptor } from "../../src/adaptors/puppeteer";
import { type ReflowResult, runReflowAudit } from "../../src/index";
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

async function runOnPage(page: Page, name: string): Promise<ReflowResult> {
	await page.goto(`${server.url}/${name}`, { waitUntil: "load" });

	return runReflowAudit(new PuppeteerAdaptor(page), { settleDelayMs: 20 });
}

async function runFixture(name: string): Promise<ReflowResult> {
	const page: Page = await browser.newPage();

	try {
		return await runOnPage(page, name);
	} finally {
		await page.close();
	}
}

describe("reflow audit (integration)", () => {
	it("passes a page that reflows at 320px and restores the viewport", async () => {
		const page = await browser.newPage();

		try {
			await page.setViewport({ width: 1024, height: 768 });
			const result = await runOnPage(page, "responsive.html");
			const viewport = page.viewport();

			expect(result.bucket).toBe("pass");
			expect(result.restored).toBe(true);
			expect(viewport?.width).toBe(1024);
			expect(viewport?.height).toBe(768);
		} finally {
			await page.close();
		}
	});

	it("flags a fixed-width layout as a violation", async () => {
		const result = await runFixture("fixed-width-layout.html");

		expect(result.bucket).toBe("violation");
		expect(result.documentOverflowPx).toBeGreaterThan(20);
		expect(result.offenders.some((o) => o.reason === "element-overflow")).toBe(
			true,
		);
	});

	it("does not flag a wide data table", async () => {
		const result = await runFixture("wide-data-table.html");

		expect(result.bucket).not.toBe("violation");
	});

	it("flags a layout table with role=presentation", async () => {
		const result = await runFixture("layout-table.html");

		expect(result.bucket).toBe("violation");
	});

	it("flags a single overflowing element as the offender", async () => {
		const result = await runFixture("overflowing-element.html");

		expect(result.bucket).toBe("violation");
		expect(result.offenders.some((o) => o.selector.includes("poke"))).toBe(
			true,
		);
	});

	it("does not flag a scroll-snap carousel with no document overflow", async () => {
		const result = await runFixture("carousel.html");

		expect(result.bucket).not.toBe("violation");
		expect(result.documentOverflowPx).toBeLessThanOrEqual(2);
	});

	it("does not flag a 1px subpixel overshoot", async () => {
		const result = await runFixture("subpixel-overflow.html");

		expect(result.bucket).not.toBe("violation");
	});

	it("returns incomplete for a 100vw scrollbar-gutter band", async () => {
		const result = await runFixture("vw-overflow.html");

		expect(result.bucket).toBe("incomplete");
		expect(result.documentOverflowPx).toBeGreaterThan(2);
		expect(result.documentOverflowPx).toBeLessThanOrEqual(20);
	});

	it("does not flag clipped overflow:hidden content (v1 gap)", async () => {
		const result = await runFixture("clipped.html");

		expect(result.bucket).not.toBe("violation");
	});

	it("measures in place without resizing when already 320px wide", async () => {
		const page = await browser.newPage();

		try {
			await page.setViewport({ width: 320, height: 640 });
			const original = page.setViewport.bind(page);
			const extra: Array<{ width: number; height: number }> = [];
			page.setViewport = (async (viewport) => {
				extra.push({
					width: viewport?.width ?? 0,
					height: viewport?.height ?? 0,
				});
				return original(viewport);
			}) as Page["setViewport"];

			const result = await runOnPage(page, "already-narrow.html");

			expect(extra).toEqual([]);
			expect(result.alreadyNarrow).toBe(true);
			expect(result.viewport.width).toBe(320);
			expect(result.bucket).toBe("pass");
		} finally {
			await page.close();
		}
	});

	it("detects overflow on body when html does not scroll", async () => {
		const result = await runFixture("body-overflow.html");

		expect(result.bucket).toBe("violation");
		expect(result.documentOverflowPx).toBeGreaterThan(20);
	});

	it("does not false-positive a translateX(-100%) off-canvas menu", async () => {
		const result = await runFixture("transform-hidden-menu.html");

		expect(result.bucket).not.toBe("violation");
	});

	it("still flags a fixed-width shell that wraps a data table", async () => {
		const result = await runFixture("nested-table-in-fixed-shell.html");

		expect(result.bucket).toBe("violation");
		expect(result.offenders.some((o) => o.selector.includes("shell"))).toBe(
			true,
		);
	});
});
