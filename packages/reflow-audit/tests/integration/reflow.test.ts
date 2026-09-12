import {
	type AdaptorFactories,
	describeEachEngine,
	type EnginePage,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { ReflowAuditAdaptor } from "../../src/adaptor";
import { PlaywrightAdaptor } from "../../src/adaptors/playwright";
import { PuppeteerAdaptor } from "../../src/adaptors/puppeteer";
import { type ReflowResult, runReflowAudit } from "../../src/index";
import { type FixtureServer, startFixtureServer } from "./helpers/serve-fixtures";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer();
});

afterAll(async () => {
	await server.close();
});

const adaptors: AdaptorFactories<ReflowAuditAdaptor> = {
	puppeteer: (page) => new PuppeteerAdaptor(page),
	playwright: (page) => new PlaywrightAdaptor(page),
};

async function runOnPage(
	page: EnginePage<ReflowAuditAdaptor>,
	name: string,
): Promise<ReflowResult> {
	await page.goto(`${server.url}/${name}`);

	return runReflowAudit(page.adaptor, { settleDelayMs: 20 });
}

/** Width in pixels from a PNG's IHDR chunk (bytes 16-19, big-endian). */
function readPngWidth(png: Uint8Array): number {
	return new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(16);
}

describeEachEngine<ReflowAuditAdaptor>(
	"reflow audit (integration)",
	{ adaptor: adaptors },
	(engine) => {
		async function runFixture(name: string): Promise<ReflowResult> {
			const page = await engine.newPage();

			try {
				return await runOnPage(page, name);
			} finally {
				await page.close();
			}
		}

		it("passes a page that reflows at 320px and restores the viewport", async () => {
			const page = await engine.newPage();

			try {
				await page.adaptor.setViewport({ width: 1024, height: 768 });
				const result = await runOnPage(page, "responsive.html");
				const viewport = page.viewportSize();

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
			expect(result.offenders.some((o) => o.reason === "element-overflow")).toBe(true);
		});

		it("does not flag a wide data table", async () => {
			const result = await runFixture("wide-data-table.html");

			expect(result.bucket).toBe("pass");
		});

		it("flags a layout table with role=presentation", async () => {
			const result = await runFixture("layout-table.html");

			expect(result.bucket).toBe("violation");
		});

		it("flags a single overflowing element as the offender", async () => {
			const result = await runFixture("overflowing-element.html");

			expect(result.bucket).toBe("violation");
			expect(result.offenders.some((o) => o.selector.includes("poke"))).toBe(true);
		});

		it("captures a real PNG screenshot of the offending element", async () => {
			const result = await runFixture("overflowing-element.html");
			const offender = result.offenders.find((o) => o.selector.includes("poke"));

			expect(offender?.screenshot).toBeInstanceOf(Uint8Array);
			expect(offender?.screenshot?.length ?? 0).toBeGreaterThan(100);
			// PNG magic number.
			expect(Array.from(offender!.screenshot!.slice(0, 8))).toEqual([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
			]);
		});

		it("captures the screenshot at the measurement viewport's width in real pixels", async () => {
			// Puppeteer's clip.scale multiplies against the page's current deviceScaleFactor rather than
			// replacing it (verified directly against real Puppeteer), so this only comes out at exactly
			// 320px given the page's own deviceScaleFactor is 1, as it is by default here. A caller that
			// leaves deviceScaleFactor at something else beforehand is responsible for restoring it before
			// invoking this audit.
			const result = await runFixture("overflowing-element.html");
			const offender = result.offenders.find((o) => o.selector.includes("poke"));

			expect(offender?.screenshot).toBeInstanceOf(Uint8Array);
			expect(readPngWidth(offender!.screenshot!)).toBe(320);
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

		it("does not flag clipped overflow:hidden content", async () => {
			const result = await runFixture("clipped.html");

			expect(result.bucket).not.toBe("violation");
		});

		it("measures in place without resizing when already 320px wide", async () => {
			const page = await engine.newPage();

			try {
				await page.adaptor.setViewport({ width: 320, height: 640 });
				const original = page.adaptor.setViewport.bind(page.adaptor);
				const extra: Array<{ width: number; height: number }> = [];
				page.adaptor.setViewport = async (viewport) => {
					extra.push(viewport);

					return original(viewport);
				};

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
			expect(result.offenders.some((o) => o.selector.includes("shell"))).toBe(true);
		});
	},
);
