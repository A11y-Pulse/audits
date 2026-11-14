import {
	type AdaptorFactories,
	describeEachEngine,
	type EnginePage,
	type FixtureServer,
	isPng,
	startFixtureServer,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { ReflowAuditAdaptor } from "../../src/adaptor";
import { PlaywrightAdaptor } from "../../src/adaptors/playwright";
import { PuppeteerAdaptor } from "../../src/adaptors/puppeteer";
import { type ReflowResult, runReflowAudit } from "../../src/index";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
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

/** Each offender as `[selector, reason, overflowPx]`. */
function summary(result: ReflowResult): Array<[string, string, number]> {
	return result.offenders.map((o) => [o.selector, o.reason, o.overflowPx]);
}

/** Width in pixels from a PNG's IHDR chunk (bytes 16-19, big-endian). */
function readPngWidth(png: Uint8Array): number {
	return new DataView(png.buffer, png.byteOffset, png.byteLength).getUint32(16);
}

/** The `[r, g, b]` of one pixel of a PNG, decoded by the browser itself. */
function pixelAt(
	page: EnginePage<ReflowAuditAdaptor>,
	png: Uint8Array,
	x: number,
	y: number,
): Promise<number[]> {
	return page.adaptor.evaluate(
		async (base64: string, px: number, py: number) => {
			const image = new Image();
			image.src = `data:image/png;base64,${base64}`;
			await image.decode();

			const canvas = document.createElement("canvas");
			canvas.width = image.naturalWidth;
			canvas.height = image.naturalHeight;

			const context = canvas.getContext("2d")!;
			context.drawImage(image, 0, 0);

			return Array.from(context.getImageData(px, py, 1, 1).data.slice(0, 3));
		},
		Buffer.from(png).toString("base64"),
		x,
		y,
	);
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
			expect(summary(result)).toEqual([["#app", "element-overflow", result.documentOverflowPx]]);
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
			expect(summary(result)).toEqual([["#poke", "element-overflow", 480]]);
			expect(result.offenders[0]?.rect).toEqual({ x: 0, y: 0, width: 800, height: 40 });
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

		it("passes a scroll-snap carousel with no document overflow", async () => {
			const result = await runFixture("carousel.html");

			expect(result.bucket).toBe("pass");
			expect(result.offenders).toEqual([]);
			expect(result.documentOverflowPx).toBeLessThanOrEqual(2);
		});

		it("does not flag a 1px subpixel overshoot", async () => {
			const result = await runFixture("subpixel-overflow.html");

			expect(result.bucket).toBe("pass");
			expect(result.offenders).toEqual([]);
		});

		it("returns incomplete for a 100vw scrollbar-gutter band", async () => {
			const result = await runFixture("vw-overflow.html");

			expect(result.bucket).toBe("incomplete");
			expect(result.documentOverflowPx).toBeGreaterThan(2);
			expect(result.documentOverflowPx).toBeLessThanOrEqual(20);
		});

		it("asks for review of content the page cuts off with overflow-x: hidden", async () => {
			const result = await runFixture("clipped.html");

			expect(result.bucket).toBe("incomplete");
			expect(result.documentOverflowPx).toBe(0);
			expect(summary(result)).toEqual([["div.wide", "clipped-content", 880]]);
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

			expect(result.bucket).toBe("pass");
			expect(result.offenders).toEqual([]);
		});

		it("still flags a fixed-width shell that wraps a data table", async () => {
			const result = await runFixture("nested-table-in-fixed-shell.html");

			expect(result.bucket).toBe("violation");
			expect(summary(result)).toEqual([["#shell", "element-overflow", 680]]);
		});

		it("does not report a slider clipped by overflow: hidden beside a data table", async () => {
			const result = await runFixture("hidden-slider.html");

			// The data table is what scrolls the page, and it is exempt.
			expect(result.documentOverflowPx).toBeGreaterThan(20);
			expect(result.bucket).toBe("pass");
			expect(result.offenders).toEqual([]);
		});

		it("waits out a debounced resize handler before measuring", async () => {
			const result = await runFixture("debounced-resize.html");

			expect(result.unsettled).toBe(false);
			expect(result.bucket).toBe("pass");
			expect(result.offenders).toEqual([]);
		});

		it("attributes overflowing text to the heading, URL and code that will not wrap", async () => {
			const result = await runFixture("text-overflow.html");

			expect(result.bucket).toBe("violation");
			expect(result.offenders.map((o) => [o.selector, o.reason])).toEqual([
				["#headline", "text-overflow"],
				["#url", "text-overflow"],
				["#code", "text-overflow"],
			]);

			const widest = Math.max(...result.offenders.map((o) => o.overflowPx));

			// The widest run of text is what sets the document's scroll width. Engines round the
			// two measurements separately.
			expect(Math.abs(widest - result.documentOverflowPx)).toBeLessThanOrEqual(1);

			for (const offender of result.offenders) {
				expect(offender.rect.x).toBe(16);
				expect(offender.rect.width).toBeGreaterThan(320);
				expect(offender.screenshot).toBeInstanceOf(Uint8Array);
			}
		});

		it("asks for review when the whole page sits in a horizontal scroller", async () => {
			const result = await runFixture("scrolling-app-shell.html");

			expect(result.documentOverflowPx).toBe(0);
			expect(result.bucket).toBe("incomplete");
			expect(summary(result)).toEqual([["#app", "scrolling-container", 880]]);
		});

		it("passes code, a data table and a card rail that scroll inside their own containers", async () => {
			const result = await runFixture("contained-scrollers.html");

			expect(result.bucket).toBe("pass");
			expect(result.offenders).toEqual([]);
		});

		it("flags a layout table that has no header cells, caption or roles", async () => {
			const result = await runFixture("legacy-layout-table.html");

			expect(result.bucket).toBe("violation");
			expect(summary(result)).toEqual([["#shell", "element-overflow", 680]]);
		});

		it("flags a fixed-width layout on a right-to-left page", async () => {
			const result = await runFixture("rtl.html");

			expect(result.bucket).toBe("violation");
			expect(summary(result)).toEqual([["#app", "element-overflow", 680]]);
			// The page overflows to the left of its origin.
			expect(result.offenders[0]?.rect.x).toBe(-680);
		});

		it("gives the same result and evidence wherever the page is scrolled to", async () => {
			const atTop = await runFixture("scrolled-start.html");
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/scrolled-start.html`);
				await page.adaptor.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
				const scrolledY = await page.adaptor.evaluate(() => window.scrollY);
				const atBottom = await runReflowAudit(page.adaptor, { settleDelayMs: 20 });

				expect(scrolledY).toBeGreaterThan(1000);
				expect(atBottom.bucket).toBe("violation");
				expect(summary(atBottom)).toEqual([["#poke", "element-overflow", 480]]);
				expect(atBottom.offenders[0]?.rect).toEqual({ x: 0, y: 0, width: 800, height: 60 });
				expect(summary(atBottom)).toEqual(summary(atTop));
				expect(atBottom.offenders[0]?.rect).toEqual(atTop.offenders[0]?.rect);
				// The clip is in document coordinates, so the evidence shows the banner either way.
				expect(Buffer.from(atBottom.offenders[0]!.screenshot!)).toEqual(
					Buffer.from(atTop.offenders[0]!.screenshot!),
				);
			} finally {
				await page.close();
			}
		});

		it("asks for review of a fixed header wider than the viewport", async () => {
			const result = await runFixture("fixed-header.html");

			expect(result.documentOverflowPx).toBe(0);
			expect(result.bucket).toBe("incomplete");
			expect(summary(result)).toEqual([["#masthead", "clipped-content", 680]]);
		});

		it("asks for review of an image and an iframe that do not scale down", async () => {
			const result = await runFixture("wide-media.html");

			expect(result.bucket).toBe("incomplete");
			expect(summary(result)).toEqual([
				["#photo", "media-overflow", 880],
				["#player", "media-overflow", 244],
			]);
		});

		it("widens the screenshot to show an offender that starts beyond the viewport", async () => {
			const result = await runFixture("offscreen-offender.html");

			expect(result.bucket).toBe("violation");
			expect(summary(result)).toEqual([["#badge", "element-overflow", 480]]);
			expect(readPngWidth(result.offenders[0]!.screenshot!)).toBe(800);
		});

		it("does not report a fixed tab bar that scrolls sideways within itself", async () => {
			const result = await runFixture("fixed-tab-bar.html");

			expect(result.bucket).toBe("pass");
			expect(result.offenders).toEqual([]);
		});

		it("does not report wide content a fixed dialog scrolls within itself", async () => {
			const result = await runFixture("fixed-dialog.html");

			expect(result.bucket).toBe("pass");
			expect(result.offenders).toEqual([]);
		});

		it("asks for review of unscaled media inside a picture or link, naming the media", async () => {
			const result = await runFixture("media-in-inline-wrapper.html");

			expect(result.bucket).toBe("incomplete");
			expect(summary(result)).toEqual([
				["#hero", "media-overflow", 880],
				["#promo", "media-overflow", 580],
			]);
		});

		it("still flags an inline link whose own text runs past the viewport", async () => {
			const result = await runFixture("inline-link-overflow.html");

			expect(result.bucket).toBe("violation");
			expect(result.offenders.map((o) => [o.selector, o.reason])).toEqual([
				["#long", "element-overflow"],
			]);
		});

		it("widens the screenshot leftwards for a right-to-left offender beyond the viewport", async () => {
			const page = await engine.newPage();

			try {
				const result = await runOnPage(page, "rtl-offscreen-offender.html");
				const screenshot = result.offenders[0]!.screenshot!;

				expect(result.bucket).toBe("violation");
				expect(summary(result)).toEqual([["#badge", "element-overflow", 600]]);
				expect(result.offenders[0]?.rect).toEqual({ x: -600, y: 40, width: 200, height: 60 });
				expect(isPng(screenshot)).toBe(true);
				// The capture scrolls the window sideways and must put it back.
				expect(await page.adaptor.evaluate(() => window.scrollX)).toBe(0);

				// Capturing left of the document origin is only verified on Chromium. Another engine
				// may refuse such a clip, in which case the audit falls back to the viewport-wide one.
				if (engine.name === "puppeteer" || engine.name === "playwright-chromium") {
					// From the badge's far edge at x=-600 to the viewport's right edge at x=320.
					expect(readPngWidth(screenshot)).toBe(920);
					// The badge itself is in the picture: its red fill, at its left end.
					expect(await pixelAt(page, screenshot, 20, 50)).toEqual([204, 51, 51]);
				}
			} finally {
				await page.close();
			}
		});

		it("asks for review of content cut off by overflow-x: hidden on the root element alone", async () => {
			const result = await runFixture("html-clipped.html");

			expect(result.bucket).toBe("incomplete");
			expect(result.documentOverflowPx).toBe(0);
			expect(summary(result)).toEqual([["div.wide", "clipped-content", 880]]);
		});

		it("names what overflows inside an app shell that scrolls the whole page", async () => {
			const result = await runFixture("app-shell-hero.html");

			expect(result.documentOverflowPx).toBe(0);
			expect(result.bucket).toBe("incomplete");
			expect(summary(result)).toEqual([["#root", "scrolling-container", 280]]);
			expect(result.offenders[0]?.overflowing).toEqual([
				{
					selector: "#hero",
					html: '<div id="hero">',
					overflowPx: 280,
					rect: { x: 0, y: expect.any(Number), width: 600, height: expect.any(Number) },
				},
			]);
		});

		it("names the layout that overflows a page-wide horizontal scroller", async () => {
			const result = await runFixture("scrolling-app-shell.html");

			expect(result.offenders[0]?.overflowing?.map((o) => [o.selector, o.overflowPx])).toEqual([
				["#layout", 880],
			]);
		});

		it("passes a realistic responsive page with a sticky header, drawer, media, carousel and table", async () => {
			const result = await runFixture("responsive-page.html");

			expect(result.bucket).toBe("pass");
			expect(result.documentOverflowPx).toBe(0);
			expect(result.offenders).toEqual([]);
		});
	},
);
