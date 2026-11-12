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
	runTextSpacingAudit,
	type TextSpacingAuditAdaptor,
	type TextSpacingOptions,
	type TextSpacingResult,
} from "../../src/index";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

/** Injected style elements, plus stylesheets adopted by any open shadow root. */
function leftoverStylesScript(): number {
	let count = document.querySelectorAll(
		'[data-a11y-pulse="ts-freeze"], [data-a11y-pulse="ts-override"]',
	).length;

	for (const el of Array.from(document.querySelectorAll("*"))) {
		if (el.shadowRoot) {
			count += el.shadowRoot.adoptedStyleSheets.length;
			count += el.shadowRoot.querySelectorAll("[data-a11y-pulse]").length;
		}
	}

	return count;
}

function scrollToBottomScript(): number {
	window.scrollTo(0, document.documentElement.scrollHeight);

	return window.scrollY;
}

function pngSize(png: Uint8Array): { width: number; height: number } {
	const buffer = Buffer.from(png);

	return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

const NO_FINDINGS = { clipped: 0, truncationIncreased: 0, overlaps: 0 };

const adaptors: AdaptorFactories<TextSpacingAuditAdaptor> = {
	puppeteer: (page) => new PuppeteerAdaptor(page),
	playwright: (page) => new PlaywrightAdaptor(page),
};

describeEachEngine<TextSpacingAuditAdaptor>(
	"text spacing audit (integration)",
	{ adaptor: adaptors },
	(engine) => {
		async function runFixture(
			name: string,
			options?: TextSpacingOptions,
		): Promise<{ result: TextSpacingResult; leftoverStyles: number }> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);
				const result = await runTextSpacingAudit(page.adaptor, options);
				const leftoverStyles = await page.adaptor.evaluate(leftoverStylesScript);

				return { result, leftoverStyles };
			} finally {
				await page.close();
			}
		}

		/** Every finding as `kind selector`, for asserting the exact set a page produces. */
		function summarise(result: TextSpacingResult): string[] {
			return result.findings.map((finding) => `${finding.kind} ${finding.selector}`);
		}

		it("lets a spacious layout survive the override with no findings", async () => {
			const { result, leftoverStyles } = await runFixture("passing.html");

			expect(result.candidateCount).toBe(1);
			expect(result.findings).toEqual([]);
			expect(result.summary).toEqual(NO_FINDINGS);
			expect(result.truncated).toBe(false);
			expect(result.restored).toBe(true);
			expect(leftoverStyles).toBe(0);
		});

		it("flags a fixed-height overflow-hidden box as clipped, naming the box and the axis", async () => {
			const { result, leftoverStyles } = await runFixture("clipped-fixed-height.html");

			expect(summarise(result)).toEqual(["clipped #card"]);
			expect(result.summary).toEqual({ ...NO_FINDINGS, clipped: 1 });

			const clipped = result.findings[0]!;

			expect(clipped.clippedBy).toBe("#card");
			expect(clipped.clippedByHtml).toContain('id="card"');
			expect(clipped.axis).toBe("vertical");
			expect(clipped.affectedCount).toBe(1);
			expect(clipped.metrics.beforeOverflowPx).toBeLessThanOrEqual(2);
			// The second line moves down by the 4px the first one gains.
			expect(clipped.metrics.afterOverflowPx).toBeGreaterThan(2);
			expect(clipped.metrics.afterOverflowPx).toBeLessThan(12);
			expect(result.restored).toBe(true);
			expect(leftoverStyles).toBe(0);

			expect(clipped.screenshot).toBeInstanceOf(Uint8Array);
			// PNG magic number.
			expect(Array.from(clipped.screenshot!.slice(0, 8))).toEqual([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
			]);
		});

		it("captures the screenshot at the adaptor's fixed scale", async () => {
			// Puppeteer's clip.scale multiplies against the page's current deviceScaleFactor rather than
			// replacing it (verified directly against real Puppeteer in the reflow-audit integration
			// suite), so this only comes out matching the clip's own CSS-pixel size given the page's own
			// deviceScaleFactor is 1, as it is by default here.
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/clipped-fixed-height.html`);

				const inner = page.adaptor;
				const calls: Array<{
					clip: { width: number };
					scale: number;
				}> = [];
				const spy: TextSpacingAuditAdaptor = {
					evaluate: inner.evaluate.bind(inner),
					screenshotClipScale: inner.screenshotClipScale,
					screenshotClip: async (clip, scale = 1) => {
						calls.push({ clip, scale });

						return inner.screenshotClip(clip, scale);
					},
				};

				const result = await runTextSpacingAudit(spy);
				const clipped = result.findings.find((finding) => finding.kind === "clipped");

				expect(clipped?.screenshot).toBeInstanceOf(Uint8Array);
				expect(calls).toHaveLength(1);
				expect(calls[0]?.scale).toBe(1);
				expect(pngSize(clipped!.screenshot!).width).toBe(Math.round(calls[0]!.clip.width));
			} finally {
				await page.close();
			}
		});

		it("finds text cut off by an outer box when an inner wrapper also clips", async () => {
			const { result } = await runFixture("nested-clippers.html");

			// The inner wrapper has no height of its own, so it never overflows; the card does.
			expect(summarise(result)).toEqual(["clipped #copy"]);
			expect(result.findings[0]?.clippedBy).toBe("#card");
			expect(result.findings[0]?.axis).toBe("vertical");
			expect(result.restored).toBe(true);
		});

		it("is not masked by decoration that already overflowed the clipping box", async () => {
			const { result } = await runFixture("baseline-overflow.html");

			expect(summarise(result)).toEqual(["clipped #tagline"]);
			expect(result.findings[0]?.clippedBy).toBe("#hero");
			expect(result.findings[0]?.metrics.beforeOverflowPx).toBeLessThanOrEqual(2);
		});

		it("reports a card that clips several elements once, against the worst affected", async () => {
			const { result } = await runFixture("card.html");

			// The heading and the first paragraph stay in view; the second paragraph and the link
			// are pushed out, the link furthest.
			expect(summarise(result)).toEqual(["clipped #more"]);
			expect(result.candidateCount).toBe(4);

			const clipped = result.findings[0]!;

			expect(clipped.clippedBy).toBe("#card");
			expect(clipped.affectedCount).toBe(2);
			expect(clipped.metrics.afterOverflowPx).toBeGreaterThan(60);
		});

		it("does not report wrapped inline links as overlapping the text around them", async () => {
			const { result } = await runFixture("inline-prose.html");

			expect(result.candidateCount).toBeGreaterThanOrEqual(9);
			expect(summarise(result)).toEqual([]);
			expect(result.restored).toBe(true);
		});

		it("applies the spacing inside open shadow roots", async () => {
			const { result, leftoverStyles } = await runFixture("shadow-dom.html");

			expect(summarise(result)).toEqual(["clipped #shadow-copy"]);
			expect(result.findings[0]?.clippedBy).toBe("#shadow-card");
			expect(result.restored).toBe(true);
			expect(leftoverStyles).toBe(0);
		});

		it("overrides spacing that an author stylesheet pins with !important", async () => {
			const { result } = await runFixture("author-important.html");

			expect(summarise(result)).toEqual(["clipped #copy"]);
			expect(result.findings[0]?.clippedBy).toBe("#card");
		});

		it("restores a page whose elements transition every property", async () => {
			const { result, leftoverStyles } = await runFixture("transition.html");

			expect(summarise(result)).toEqual([]);
			expect(result.restored).toBe(true);
			expect(leftoverStyles).toBe(0);
		});

		it("routes deeper ellipsis truncation to truncation-increased, never clipped", async () => {
			const { result, leftoverStyles } = await runFixture("ellipsis.html");

			expect(summarise(result)).toEqual(["truncation-increased #title"]);
			expect(result.summary).toEqual({ ...NO_FINDINGS, truncationIncreased: 1 });
			expect(result.findings[0]?.clippedBy).toBe("#title");
			expect(result.findings[0]?.metrics.afterOverflowPx).toBeGreaterThan(
				result.findings[0]!.metrics.beforeOverflowPx + 2,
			);
			expect(result.restored).toBe(true);
			expect(leftoverStyles).toBe(0);
		});

		it("never reports text behind a line clamp as clipped", async () => {
			const { result } = await runFixture("line-clamp.html");

			expect(result.candidateCount).toBe(1);
			expect(result.summary.clipped).toBe(0);
			expect(result.summary.overlaps).toBe(0);
			// Engines differ on whether clamped lines still count towards the box's scroll height.
			expect(summarise(result).filter((entry) => entry !== "truncation-increased #teaser")).toEqual(
				[],
			);
		});

		it("ignores visually hidden text, which was never visible", async () => {
			const { result } = await runFixture("sr-only.html");

			expect(summarise(result)).toEqual([]);
			expect(result.restored).toBe(true);
		});

		it("does not report text that can still be scrolled to inside a clipped card", async () => {
			const { result } = await runFixture("scroller-in-card.html");

			expect(result.candidateCount).toBe(4);
			expect(summarise(result)).toEqual([]);
		});

		it("reports text pushed into its neighbour as overlap, with the shared region", async () => {
			const { result, leftoverStyles } = await runFixture("overlap.html");

			expect(summarise(result)).toEqual(["overlap #a"]);
			expect(result.summary).toEqual({ ...NO_FINDINGS, overlaps: 1 });

			const overlap = result.findings[0]!;

			expect(overlap.overlapsWith).toBe("#b");
			expect(overlap.overlapsWithHtml).toContain('id="b"');
			expect(overlap.metrics.beforeOverlapAreaPx2).toBe(0);
			expect(overlap.metrics.afterOverlapAreaPx2).toBeGreaterThan(100);
			// The last line of the block above, over the line below it.
			expect(overlap.overlapRect?.y).toBeGreaterThan(84);
			expect(overlap.overlapRect?.height).toBeGreaterThan(1);

			// Evidence shows both elements: the four lines above (96px) and the line below them.
			expect(pngSize(overlap.screenshot!).height).toBeGreaterThanOrEqual(108);
			expect(result.restored).toBe(true);
			expect(leftoverStyles).toBe(0);
		});

		it("finds text cut off inside a scaled ancestor", async () => {
			const { result } = await runFixture("transformed-ancestor.html");

			expect(summarise(result)).toEqual(["clipped #text"]);

			const clipped = result.findings[0]!;

			expect(clipped.clippedBy).toBe("#box");
			expect(clipped.axis).toBe("vertical");
			expect(clipped.metrics.beforeOverflowPx).toBe(0);
			// The second 24px line ends a few px below the 40px box, drawn at 1.5 times that.
			expect(clipped.metrics.afterOverflowPx).toBeGreaterThan(2);
			expect(clipped.metrics.afterOverflowPx).toBeLessThan(12);
			expect(result.restored).toBe(true);
		});

		it("does not report cut-off text as overlapping the paragraph after its card", async () => {
			const { result } = await runFixture("clipped-card-neighbour.html");

			expect(summarise(result)).toEqual(["clipped #text"]);
			expect(result.findings[0]?.clippedBy).toBe("#card");
			expect(result.summary).toEqual({ ...NO_FINDINGS, clipped: 1 });
		});

		it("screenshots a finding where it is on the page, however far the page is scrolled", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/below-the-fold.html`);
				expect(await page.adaptor.evaluate(scrollToBottomScript)).toBeGreaterThan(3000);

				const inner = page.adaptor;
				const clips: Array<{ x: number; y: number; width: number; height: number }> = [];
				const spy: TextSpacingAuditAdaptor = {
					evaluate: inner.evaluate.bind(inner),
					screenshotClipScale: inner.screenshotClipScale,
					screenshotClip: async (clip, scale = 1) => {
						clips.push(clip);

						return inner.screenshotClip(clip, scale);
					},
				};

				const result = await runTextSpacingAudit(spy);

				expect(summarise(result)).toEqual(["clipped #card"]);
				// The card sits under a 3000px spacer. Its place in the viewport is nowhere near that.
				expect(result.findings[0]?.rect).toMatchObject({ x: 0, y: 3000, height: 40 });
				expect(clips).toEqual([{ x: 0, y: 2990, width: 490, height: 60 }]);
				expect(result.restored).toBe(true);
			} finally {
				await page.close();
			}
		});

		it("says when the candidate limit left text unmeasured", async () => {
			const { result } = await runFixture("card.html", { candidateLimit: 2 });

			expect(result.candidateCount).toBe(2);
			expect(result.truncated).toBe(true);
			// The clipped text is past the limit, so it is not there to report.
			expect(summarise(result)).toEqual([]);

			const { result: whole } = await runFixture("card.html", { candidateLimit: 4 });

			expect(whole.truncated).toBe(false);
		});

		it("does not report an invisible closed dropdown as overlapping what is under it", async () => {
			const { result } = await runFixture("closed-dropdown.html");

			expect(summarise(result)).toEqual([]);
			expect(result.restored).toBe(true);
		});

		it("finds no candidates on a page with no text", async () => {
			const { result, leftoverStyles } = await runFixture("no-text.html");

			expect(result.candidateCount).toBe(0);
			expect(result.findings).toEqual([]);
			expect(result.restored).toBe(true);
			expect(leftoverStyles).toBe(0);
		});
	},
);
