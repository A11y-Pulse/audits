import {
	type AdaptorFactories,
	describeEachEngine,
	type FixtureServer,
	startFixtureServer,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import { PlaywrightAdaptor } from "../../src/adaptors/playwright";
import { PuppeteerAdaptor } from "../../src/adaptors/puppeteer";
import {
	type ResizeTextAuditAdaptor,
	type ResizeTextOptions,
	type ResizeTextResult,
	runResizeTextAudit,
} from "../../src/index";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

const VIEWPORT = { width: 1280, height: 800 };
const ZOOMED = { width: 640, height: 400 };
const NO_FINDINGS = { clipped: 0, overlaps: 0 };

function leftoverStylesScript(): number {
	return document.querySelectorAll("[data-a11y-pulse]").length;
}

const adaptors: AdaptorFactories<ResizeTextAuditAdaptor> = {
	puppeteer: (page) => new PuppeteerAdaptor(page),
	playwright: (page) => new PlaywrightAdaptor(page),
};

describeEachEngine<ResizeTextAuditAdaptor>(
	"resize text audit (integration)",
	{ adaptor: adaptors, viewport: VIEWPORT },
	(engine) => {
		async function runFixture(
			name: string,
			options?: ResizeTextOptions,
		): Promise<{
			result: ResizeTextResult;
			leftoverStyles: number;
			viewport: { width: number; height: number } | null;
		}> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);
				const result = await runResizeTextAudit(page.adaptor, options);
				const leftoverStyles = await page.adaptor.evaluate(leftoverStylesScript);

				return { result, leftoverStyles, viewport: page.viewportSize() };
			} finally {
				await page.close();
			}
		}

		/** Every finding as `kind selector`, for asserting the exact set a page produces. */
		function summarise(result: ResizeTextResult): string[] {
			return result.findings.map((finding) => `${finding.kind} ${finding.selector}`);
		}

		it("passes a responsive page and puts the viewport and styles back", async () => {
			const { result, leftoverStyles, viewport } = await runFixture("responsive.html");

			expect(result.findings).toEqual([]);
			expect(result.summary).toEqual(NO_FINDINGS);
			expect(result.candidateCount).toBe(19);
			expect(result.truncated).toBe(false);
			expect(result.originalViewport).toEqual(VIEWPORT);
			expect(result.viewport).toEqual(ZOOMED);
			expect(result.unsettled).toBe(false);
			expect(result.restored).toBe(true);
			expect(result.viewportMeta).toMatchObject({ blocksZoom: false, userScalable: true });
			expect(viewport).toEqual(VIEWPORT);
			expect(leftoverStyles).toBe(0);
		});

		it("reports a fixed-height card that cuts through its content at 200%, once", async () => {
			const { result, viewport } = await runFixture("fixed-height-card.html");

			// The third row of topics is cut through and the fourth is hidden: one finding, against
			// the first topic that is cut.
			expect(summarise(result)).toEqual(["clipped #t5"]);
			expect(result.summary).toEqual({ clipped: 1, overlaps: 0 });

			const clipped = result.findings[0]!;

			expect(clipped.clippedBy).toBe("#topics");
			expect(clipped.clippedByHtml).toContain('id="topics"');
			expect(clipped.clippedByRect).toMatchObject({ width: 256, height: 150 });
			expect(clipped.axis).toBe("vertical");
			expect(clipped.affectedCount).toBe(4);
			expect(clipped.metrics.beforeOverflowPx).toBe(0);
			expect(clipped.metrics.afterOverflowPx).toBeGreaterThan(2);
			expect(clipped.metrics.afterOverflowPx).toBeLessThan(20);
			expect(clipped.rect).toMatchObject({ width: 100, height: 32 });
			expect(clipped.screenshot).toBeInstanceOf(Uint8Array);
			// PNG magic number.
			expect(Array.from(clipped.screenshot!.slice(0, 8))).toEqual([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
			]);
			expect(result.restored).toBe(true);
			expect(viewport).toEqual(VIEWPORT);
		});

		it("omits screenshots past the limit", async () => {
			const { result } = await runFixture("fixed-height-card.html", { screenshotLimit: 0 });

			expect(summarise(result)).toEqual(["clipped #t5"]);
			expect(result.findings[0]?.screenshot).toBeUndefined();
		});

		it("reports navigation labels that run into each other at 200%", async () => {
			const { result } = await runFixture("nav-overlap.html");

			expect(summarise(result)).toEqual(["overlap #nav-products", "overlap #nav-support"]);
			expect(result.findings.map((finding) => finding.overlapsWith)).toEqual([
				"#nav-support",
				"#nav-company",
			]);
			expect(result.summary).toEqual({ clipped: 0, overlaps: 2 });

			const overlap = result.findings[0]!;

			expect(overlap.metrics.beforeOverlapAreaPx2).toBe(0);
			expect(overlap.metrics.afterOverlapAreaPx2).toBeGreaterThan(4);
			expect(overlap.overlapRect?.width).toBeGreaterThan(1);
			expect(overlap.overlapsWithHtml).toContain('id="nav-support"');
			expect(overlap.screenshot).toBeInstanceOf(Uint8Array);
			expect(result.restored).toBe(true);
		});

		it("does not report text an ellipsis or line clamp truncates on purpose", async () => {
			const { result, leftoverStyles } = await runFixture("ellipsis.html");

			expect(result.findings).toEqual([]);
			expect(result.candidateCount).toBe(4);
			expect(result.restored).toBe(true);
			expect(leftoverStyles).toBe(0);
		});

		it("does not report text that can still be scrolled to", async () => {
			const { result } = await runFixture("scroller.html");

			expect(result.findings).toEqual([]);
			expect(result.restored).toBe(true);
		});

		it("does not report text that was already cut off, or visually hidden text", async () => {
			const { result } = await runFixture("baseline-clipped.html");

			expect(result.findings).toEqual([]);
			expect(result.restored).toBe(true);
		});

		it("does not report a menu the narrow layout moves off-canvas after a debounced resize", async () => {
			const { result, viewport } = await runFixture("off-canvas.html");

			expect(result.findings).toEqual([]);
			expect(result.unsettled).toBe(false);
			expect(result.restored).toBe(true);
			expect(viewport).toEqual(VIEWPORT);
		});

		it("measures text that only the zoomed layout renders, and reports it for review", async () => {
			const { result } = await runFixture("mobile-only.html");

			expect(summarise(result)).toEqual(["clipped #notice-text"]);

			const clipped = result.findings[0]!;

			expect(clipped.noBaseline).toBe(true);
			expect(clipped.clippedBy).toBe("#notice");
			expect(clipped.axis).toBe("vertical");
			expect(clipped.metrics.afterOverflowPx).toBeGreaterThan(10);
			expect(result.restored).toBe(true);
		});

		it("does not report links cut short by an ellipsis on their wrapper", async () => {
			const { result } = await runFixture("wrapper-ellipsis.html");

			expect(result.findings).toEqual([]);
			expect(result.restored).toBe(true);
		});

		it("reports colliding labels even when one carries a text-overflow that does nothing", async () => {
			const { result } = await runFixture("colliding-labels.html");

			expect(summarise(result)).toEqual(["overlap #label-orders"]);
			expect(result.findings[0]?.overlapsWith).toBe("#label-account");
			expect(result.findings[0]?.noBaseline).toBeUndefined();
		});

		it("reports a viewport meta tag that stops the user zooming", async () => {
			const { result } = await runFixture("user-scalable.html");

			expect(result.findings).toEqual([]);
			expect(result.viewportMeta).toEqual({
				content: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
				html: expect.stringContaining('name="viewport"'),
				userScalable: false,
				maximumScale: 1,
				blocksZoom: true,
			});
		});
	},
);
