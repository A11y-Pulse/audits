import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	type AdaptorFactories,
	describeEachEngine,
	type FixtureServer,
	isPng,
	startFixtureServer,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	type MovingContentOptions,
	type MovingContentResult,
	runMovingContentAudit,
} from "../../src/index";

let server: FixtureServer;

// The fixtures move several times a second, so a one-second window sees what the default
// five-second window sees on a real page.
const FAST: MovingContentOptions = { observationWindow: 1000, screenshotInterval: 100 };

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
	"moving content audit (integration)",
	{ adaptor: adaptors },
	(engine) => {
		async function runFixture(
			name: string,
			options: MovingContentOptions = FAST,
		): Promise<MovingContentResult> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);

				return await runMovingContentAudit(page.adaptor, options);
			} finally {
				await page.close();
			}
		}

		it("fails a carousel that advances by itself with no pause button", async () => {
			const result = await runFixture("carousel-no-pause.html");

			expect(result.summary).toEqual({
				checked: 1,
				failed: 1,
				needsReview: 0,
				passed: 0,
				unchecked: 0,
				ignored: { essential: 0, tooSmall: 0 },
			});
			expect(result.failed).toMatchObject([
				{
					selector: "#offers",
					motion: "script",
					detectedBy: "dom-observation",
					finding: "no-pause-control",
					rect: { width: 760, height: 280 },
					pauseControl: null,
					reducedMotion: null,
				},
			]);

			const [carousel] = result.failed;

			expect(carousel?.html).toBe('<div class="carousel__viewport" id="offers">');
			// Still moving in the last part of the window.
			expect(carousel?.observedMs).toBeGreaterThan(600);
			expect(isPng(carousel?.screenshot)).toBe(true);
			expect(isPng(carousel?.laterScreenshot)).toBe(true);
		});

		it("passes the same carousel when it has a pause button", async () => {
			const result = await runFixture("carousel-with-pause.html");

			expect(result.failed).toEqual([]);
			expect(result.needsReview).toEqual([]);
			expect(result.passed).toMatchObject([
				{
					selector: "#offers",
					motion: "script",
					finding: "pause-control",
					pauseControl: { selector: "#pause", name: "Pause slideshow", foundBy: "name" },
				},
			]);
			expect(result.passed[0]).not.toHaveProperty("screenshot");
		});

		it("fails an endless CSS ticker and names its animation", async () => {
			const result = await runFixture("css-ticker.html");

			expect(result.needsReview).toEqual([]);
			expect(result.passed).toEqual([]);
			expect(result.failed).toMatchObject([
				{
					selector: "#headlines",
					motion: "css-animation",
					detectedBy: "animation-api",
					finding: "no-pause-control",
					animations: [
						{ name: "ticker", infinite: true, activeDurationMs: null, properties: ["transform"] },
					],
					pausesOn: [],
					reducedMotion: false,
				},
			]);
		});

		it("sends a ticker that only pauses on hover for review", async () => {
			const result = await runFixture("ticker-pauses-on-hover.html");

			expect(result.failed).toEqual([]);
			expect(result.passed).toEqual([]);
			expect(result.needsReview).toMatchObject([
				{
					selector: "#headlines",
					motion: "css-animation",
					finding: "pauses-on-hover",
					pausesOn: ["hover"],
					reducedMotion: true,
				},
			]);
		});

		it("fails a <marquee>", async () => {
			const result = await runFixture("marquee-element.html");

			expect(result.summary).toMatchObject({ checked: 1, failed: 1 });
			expect(result.failed).toMatchObject([
				{ selector: "#notice", motion: "marquee", detectedBy: "element" },
			]);
		});

		it("joins slides that fade over each other and accepts a page-wide animation switch", async () => {
			const result = await runFixture("fading-slides.html");

			expect(result.failed).toEqual([]);
			expect(result.needsReview).toEqual([]);
			expect(result.passed).toMatchObject([
				{
					selector: "#slideshow",
					motion: "script",
					finding: "pause-control",
					pauseControl: {
						selector: "#motion-toggle",
						name: "Turn off animations",
						foundBy: "page-control",
					},
				},
			]);
		});

		// Headless WebKit never starts a video whose source is a canvas stream.
		it.skipIf(engine.name === "playwright-webkit")(
			"fails a playing video with no controls and passes one with them",
			async () => {
				const result = await runFixture("video.html");

				expect(result.needsReview).toEqual([]);
				expect(result.failed).toMatchObject([
					{
						selector: "#background",
						motion: "video",
						detectedBy: "media-element",
						finding: "no-pause-control",
					},
				]);
				expect(result.passed).toMatchObject([
					{ selector: "#tour", motion: "video", finding: "native-controls" },
				]);
			},
		);

		it("leaves loading indicators and small decoration alone", async () => {
			const result = await runFixture("loading-indicators.html");

			expect(result.summary).toEqual({
				checked: 0,
				failed: 0,
				needsReview: 0,
				passed: 0,
				unchecked: 0,
				ignored: { essential: 3, tooSmall: 1 },
			});
		});

		it("does not report an entrance animation that ends within five seconds", async () => {
			const result = await runFixture("entrance-animation.html");

			expect(result.summary).toMatchObject({ checked: 0, ignored: { essential: 0, tooSmall: 0 } });
		});

		it("reports nothing on a page where only a clock updates and a notice appears once", async () => {
			const result = await runFixture("static.html");

			expect(result.summary).toMatchObject({ checked: 0, ignored: { essential: 0, tooSmall: 0 } });
			expect(result.observedMs).toBeGreaterThanOrEqual(1000);
		});

		/** Load a fixture whose events are timed from the moment the audit starts watching. */
		async function runScenario(
			name: string,
			delays: number[],
			options: MovingContentOptions = FAST,
		): Promise<MovingContentResult> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);
				await page.adaptor.evaluate(
					(...args: number[]) => {
						(window as unknown as { startScenario(...args: number[]): void }).startScenario(
							...args,
						);
					},
					...delays,
				);

				return await runMovingContentAudit(page.adaptor, options);
			} finally {
				await page.close();
			}
		}

		const NOTHING = {
			checked: 0,
			failed: 0,
			needsReview: 0,
			passed: 0,
			unchecked: 0,
			ignored: { essential: 0, tooSmall: 0 },
		};

		it("does not report animated elements nobody can see", async () => {
			// A hidden preloader, a faded-out slide and a panel hidden through its parent, each
			// 600 x 300 and each with an animation that never ends.
			const result = await runFixture("hidden-motion.html");

			expect(result.summary).toEqual(NOTHING);
		});

		it("does not report a consent bar that slides in once late in the window", async () => {
			// The slide starts in one fifth of the window and ends in the next.
			const result = await runScenario("cookie-banner.html", [550]);

			expect(result.summary).toEqual(NOTHING);
		});

		it("does not report ad slots that are filled and then resized once", async () => {
			const result = await runScenario("ad-slots.html", [250, 700]);

			expect(result.summary).toEqual(NOTHING);
		});

		it("sizes an animated pseudo-element by itself, not by the element it hangs off", async () => {
			const result = await runFixture("pseudo-element.html");

			// The ten-pixel dot on the 400 x 300 card is too small to report.
			expect(result.summary).toEqual({
				checked: 2,
				failed: 1,
				needsReview: 1,
				passed: 0,
				unchecked: 0,
				ignored: { essential: 0, tooSmall: 1 },
			});
			// A sheen as large as the card is the card moving.
			expect(result.failed).toMatchObject([
				{
					selector: "#featured",
					finding: "no-pause-control",
					animations: [{ name: "sweep", pseudoElement: "::before" }],
				},
			]);
			// A cursor whose size cannot be read is left for a person to judge.
			expect(result.needsReview).toMatchObject([
				{
					selector: "#tagline",
					finding: "pseudo-element",
					animations: [{ name: "blink", pseudoElement: "::after" }],
				},
			]);
		});

		it("still finds a carousel that starts after hundreds of one-off changes", async () => {
			// 220 tiles are touched once just after the watch starts, more than it keeps track of at a
			// time. The carousel snaps between slides, so only watching its track can find it.
			const result = await runScenario("busy-then-carousel.html", [60, 200]);

			expect(result.summary).toMatchObject({ checked: 1, failed: 1 });
			expect(result.failed).toMatchObject([
				{ selector: "#offers", motion: "script", finding: "no-pause-control" },
			]);
		});

		it("does not take a link or button that plays something else for a pause control", async () => {
			// "Play trailer" links in the slides, a "Play Store" link, a "Stop-motion season" link and a
			// "Play trailer" button beside the carousel.
			const result = await runFixture("carousel-play-links.html");

			expect(result.passed).toEqual([]);
			expect(result.needsReview).toEqual([]);
			expect(result.failed).toMatchObject([
				{ selector: "#films", finding: "no-pause-control", pauseControl: null },
			]);
		});

		it("fails an SVG a script keeps moving through its attributes", async () => {
			const result = await runFixture("svg-script.html");

			expect(result.summary).toMatchObject({ checked: 1, failed: 1 });
			expect(result.failed).toMatchObject([
				{
					selector: "#map",
					motion: "script",
					detectedBy: "dom-observation",
					finding: "no-pause-control",
					rect: { width: 600, height: 300 },
				},
			]);
		});

		it("puts the page back where it was after scrolling to screenshot a region", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/carousel-below-fold.html`);
				await page.adaptor.evaluate(() => window.scrollTo(0, 120));

				const before = await page.adaptor.evaluate(() => Object.keys(window).length);
				// Record how far down the page gets while the audit runs.
				await page.adaptor.evaluate(() => {
					const seen = { maxScrollY: window.scrollY };

					Object.defineProperty(window, "__scrollSeen", { value: seen, enumerable: false });
					window.addEventListener("scroll", () => {
						seen.maxScrollY = Math.max(seen.maxScrollY, window.scrollY);
					});
				});

				const result = await runMovingContentAudit(page.adaptor, FAST);

				// The carousel sits 2,500px down the page, so capturing it means scrolling to it.
				expect(result.failed).toMatchObject([{ selector: "#offers" }]);
				expect(isPng(result.failed[0]?.screenshot)).toBe(true);

				const after = await page.adaptor.evaluate(() => ({
					scrollY: window.scrollY,
					maxScrollY: (window as unknown as { __scrollSeen: { maxScrollY: number } }).__scrollSeen
						.maxScrollY,
					globals: Object.keys(window).length,
				}));

				expect(after.maxScrollY).toBeGreaterThan(1500);
				expect(after).toMatchObject({ scrollY: 120, globals: before });
			} finally {
				await page.close();
			}
		});
	},
);
