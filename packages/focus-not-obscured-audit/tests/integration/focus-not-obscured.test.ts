import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	type AdaptorFactories,
	describeEachEngine,
	type FixtureServer,
	startFixtureServer,
	WEBKIT_PARTIAL_TAB_LOOP,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	type FocusNotObscuredOptions,
	type FocusNotObscuredResult,
	runFocusNotObscuredAudit,
} from "../../src/index";

let server: FixtureServer;

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
	"focus not obscured audit (integration)",
	{
		adaptor: adaptors,
		screenshotClipScale: 2,
		unsupported: {
			"playwright-webkit": WEBKIT_PARTIAL_TAB_LOOP,
		},
	},
	(engine) => {
		async function runFixture(
			name: string,
			options?: FocusNotObscuredOptions,
		): Promise<FocusNotObscuredResult> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);

				return await runFocusNotObscuredAudit(page.adaptor, options);
			} finally {
				await page.close();
			}
		}

		const summarise = (result: FocusNotObscuredResult) =>
			result.elements.map((element) => `${element.selector}: ${element.bucket}`);

		const only = (result: FocusNotObscuredResult, selector: string) => {
			const matches = result.elements.filter((element) => element.selector === selector);
			expect(matches, `${selector} in ${summarise(result).join(", ")}`).toHaveLength(1);

			return matches[0]!;
		};

		const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

		// Undiagnosed: this was skipped on Firefox before the cover detection was rewritten, with the
		// note that Firefox "reports no violation for the element behind the sticky footer, where
		// Chromium reports one". Firefox is not installed where the rewrite was done, so whether it
		// still differs, and why, has not been established. One untested possibility is that Firefox
		// scrolls a newly focused element further into view than Chromium does, leaving it clear of
		// the footer.
		it.skipIf(engine.name === "playwright-firefox")(
			"flags an element entirely hidden behind a sticky footer",
			async () => {
				const result = await runFixture("sticky-footer-obscures.html");

				expect(summarise(result)).toEqual(["#first: pass", "#under-footer: violation"]);

				const hidden = only(result, "#under-footer");
				expect(hidden.measurement.obscuredBy?.selector).toBe("#sticky-footer");
				expect(hidden.measurement.obscuredBy?.position).toBe("fixed");
				expect(hidden.measurement.opacity).toBe("opaque");

				expect(hidden.screenshot).toBeInstanceOf(Uint8Array);
				expect(Array.from(hidden.screenshot!.slice(0, 8))).toEqual(PNG_MAGIC);
			},
		);

		it("passes a page where no element is obscured", async () => {
			const result = await runFixture("obscuring-clean.html");

			expect(result.elements.length).toBeGreaterThanOrEqual(2);
			expect(result.elements.filter((element) => element.bucket === "violation")).toHaveLength(0);
			expect(result.elements.filter((element) => element.bucket === "incomplete")).toHaveLength(0);
			expect(result.elements.every((element) => !element.screenshot)).toBe(true);
			expect(result.summary.scrolledToTopChecked).toBe(0);
		});

		it("does not flag a semi-transparent overlay as a violation", async () => {
			const result = await runFixture("semi-transparent-overlay.html");

			expect(summarise(result)).toEqual(["#target: pass"]);

			const target = only(result, "#target");
			expect(target.measurement.fullyObscured).toBe(true);
			expect(target.measurement.opacity).toBe("semi-transparent");
			expect(target.measurement.obscuredBy?.selector).toBe("#veil");
		});

		// The remaining forward-tab fixtures all rely on the browser leaving a newly focused element
		// at the bottom edge of the viewport, as the sticky-footer one above does.
		const forward = it.skipIf(engine.name === "playwright-firefox");

		forward("names the banner, not the paragraph inside it, as the cover", async () => {
			const result = await runFixture("cookie-banner.html");

			expect(summarise(result)).toEqual([
				"#first: pass",
				"#privacy: violation",
				"#accept: pass",
				"#reject: pass",
			]);

			const hidden = only(result, "#privacy");
			expect(hidden.measurement.obscuredBy?.selector).toBe("#cookie-banner");
			expect(hidden.measurement.obscuredBy?.html).toContain('role="region"');
			expect(hidden.measurement.opacity).toBe("opaque");
		});

		forward("treats a fixed image as an opaque cover", async () => {
			const result = await runFixture("fixed-image.html");

			expect(summarise(result)).toEqual(["#first: pass", "#under-image: violation"]);
			expect(only(result, "#under-image").measurement.obscuredBy?.selector).toBe("#promo");
		});

		forward("finds a banner beneath empty click-through layers", async () => {
			const result = await runFixture("toaster-over-banner.html");

			expect(summarise(result)).toEqual([
				"#first: pass",
				"#privacy: violation",
				"#accept: pass",
				"#reject: pass",
			]);

			const hidden = only(result, "#privacy");
			expect(hidden.measurement.obscuredBy?.selector).toBe("#cookie-banner");
			expect(hidden.measurement.opacity).toBe("opaque");

			// Layers that paint nothing over an element are not reported as covering it.
			expect(only(result, "#first").measurement.fullyObscured).toBe(false);
			expect(only(result, "#accept").measurement.fullyObscured).toBe(false);
		});

		it("ignores a click-through canvas with nothing known to be drawn on it", async () => {
			const result = await runFixture("canvas-overlay.html");

			expect(summarise(result)).toEqual(["#first: pass", "#second: pass", "#last: pass"]);
			expect(result.elements.every((element) => !element.measurement.fullyObscured)).toBe(true);
		});

		forward(
			"sends a canvas it cannot see into for review, and fails under a painted one",
			async () => {
				const result = await runFixture("canvas-blocking.html");

				expect(summarise(result)).toEqual(["#under-blank: incomplete", "#under-chart: violation"]);

				const blank = only(result, "#under-blank").measurement;
				expect(blank.opacity).toBe("unknown");
				expect(blank.obscuredBy?.selector).toBe("#blank");

				const chart = only(result, "#under-chart").measurement;
				expect(chart.opacity).toBe("opaque");
				expect(chart.obscuredBy?.selector).toBe("#chart");
			},
		);

		forward(
			"ignores a transparent image and sends a partly transparent one for review",
			async () => {
				const result = await runFixture("transparent-image-overlay.html");

				expect(summarise(result)).toEqual(["#first: pass", "#second: pass", "#last: incomplete"]);
				expect(only(result, "#first").measurement.fullyObscured).toBe(false);
				expect(only(result, "#second").measurement.fullyObscured).toBe(false);

				const last = only(result, "#last").measurement;
				expect(last.opacity).toBe("unknown");
				expect(last.obscuredBy?.selector).toBe("#mark");
			},
		);

		forward(
			"sends an element under a frame for review, since the frame may be transparent",
			async () => {
				const result = await runFixture("chat-iframe.html");

				expect(summarise(result)).toEqual(["#first: pass", "#under-chat: incomplete"]);

				const under = only(result, "#under-chat").measurement;
				expect(under.opacity).toBe("unknown");
				expect(under.obscuredBy?.selector).toBe("#chat");
			},
		);

		it("finishes on a page whose animation frames never arrive", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/sticky-header.html`);
				// A tab that is not being rendered never runs these callbacks.
				await page.adaptor.evaluate(() => {
					window.requestAnimationFrame = () => 0;
				});

				const result = await runFocusNotObscuredAudit(page.adaptor);

				expect(summarise(result)).toEqual([
					"#home: pass",
					"#s1: violation",
					"#s2: violation",
					"#s3: violation",
					"#s4: violation",
				]);
				expect(Array.from(only(result, "#s3").screenshot!.slice(0, 8))).toEqual(PNG_MAGIC);
			} finally {
				await page.close();
			}
		}, 30_000);

		forward("treats a solid gradient background as an opaque cover", async () => {
			const result = await runFixture("gradient-footer.html");

			expect(summarise(result)).toEqual(["#first: pass", "#under-gradient: violation"]);
			expect(only(result, "#under-gradient").measurement.obscuredBy?.selector).toBe(
				"#gradient-footer",
			);
		});

		forward(
			"reports the shared container when several of its children cover the element",
			async () => {
				const result = await runFixture("flex-banner.html");

				expect(summarise(result)).toEqual(["#first: pass", "#under-bar: violation"]);

				const hidden = only(result, "#under-bar");
				expect(hidden.measurement.obscuredBy?.selector).toBe("#app-bar");
				expect(hidden.measurement.opacity).toBe("opaque");
			},
		);

		forward(
			"sees an opaque cover that takes no pointer events, and leaves it as it was",
			async () => {
				const page = await engine.newPage();

				try {
					await page.goto(`${server.url}/pointer-events-none.html`);

					const result = await runFocusNotObscuredAudit(page.adaptor);

					expect(summarise(result)).toEqual(["#first: pass", "#under-ghost: violation"]);

					const cover = only(result, "#under-ghost").measurement.obscuredBy;
					expect(cover?.selector).toBe("#ghost-footer");
					expect(cover?.ignoresPointerEvents).toBe(true);

					const after = await page.adaptor.evaluate(() => {
						const footer = document.querySelector("#ghost-footer") as HTMLElement;

						return {
							style: footer.getAttribute("style"),
							pointerEvents: getComputedStyle(footer).pointerEvents,
							leftovers: document.querySelectorAll(
								"[data-a11y-obscurer], [data-a11y-context-outline]",
							).length,
							cache: "__a11yPulseInertCovers" in window,
						};
					});

					expect(after).toEqual({ style: null, pointerEvents: "none", leftovers: 0, cache: false });
				} finally {
					await page.close();
				}
			},
		);

		it("does not report custom controls whose real input is not painted", async () => {
			const result = await runFixture("custom-switch.html");

			expect(summarise(result)).toEqual(["#emails: pass", "#sms: pass", "#save: pass"]);
			expect(only(result, "#emails").measurement.measured).toBe("label");
			expect(only(result, "#sms").measurement.measured).toBe("label");
		});

		forward(
			"measures the label of an unpainted input, and reports it when the label is hidden",
			async () => {
				const result = await runFixture("custom-switch-covered.html");

				expect(summarise(result)).toEqual(["#first: pass", "#terms: violation"]);

				const hidden = only(result, "#terms");
				expect(hidden.measurement.measured).toBe("label");
				expect(hidden.measurement.obscuredBy?.selector).toBe("#footer");
			},
		);

		it("waits for a smooth scroll to finish before measuring", async () => {
			const result = await runFixture("smooth-scroll-clean.html");

			expect(summarise(result)).toEqual([
				"#one: pass",
				"#two: pass",
				"#three: pass",
				"#four: pass",
			]);
			expect(result.elements.every((element) => !element.measurement.offscreen)).toBe(true);
		});

		forward("still reports an element a smooth scroll leaves under a sticky footer", async () => {
			const result = await runFixture("smooth-scroll-footer.html");

			// A smooth scroll centres the element it brings in, so only the last link, which the end of
			// the page stops short, comes to rest under the footer.
			expect(summarise(result)).toEqual(["#one: pass", "#two: pass", "#three: violation"]);
			expect(only(result, "#three").measurement.obscuredBy?.selector).toBe("#footer");
		});

		forward("finds a cover that lives in a shadow root", async () => {
			const result = await runFixture("shadow-cover.html");

			expect(summarise(result)).toEqual(["#first: pass", "#under-shadow: violation"]);
			expect(only(result, "#under-shadow").measurement.obscuredBy?.selector).toBe(
				"site-footer >>> div.bar",
			);
		});

		forward("leaves what it cannot judge for review", async () => {
			const result = await runFixture("fade-footer.html");

			expect(summarise(result)).toEqual([
				"#offscreen: incomplete",
				"#first: pass",
				"#under-fade: incomplete",
			]);

			expect(only(result, "#offscreen").measurement.offscreen).toBe(true);

			const faded = only(result, "#under-fade");
			expect(faded.measurement.opacity).toBe("unknown");
			expect(faded.measurement.obscuredBy?.selector).toBe("#fade-footer");
			expect(faded.screenshot).toBeInstanceOf(Uint8Array);
		});

		it("finds elements that a sticky header hides once they are scrolled to the top", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/sticky-header.html`);

				const result = await runFocusNotObscuredAudit(page.adaptor);

				// The link inside the header moves with it, so it is never checked.
				expect(summarise(result)).toEqual([
					"#home: pass",
					"#s1: violation",
					"#s2: violation",
					"#s3: violation",
					"#s4: violation",
				]);
				expect(result.summary.scrolledToTopChecked).toBe(4);
				expect(result.summary.failed).toBe(4);

				const hidden = only(result, "#s3");
				expect(hidden.foundBy).toBe("scrolled-to-top");
				expect(hidden.measurement.obscuredBy?.selector).toBe("#site-header");
				expect(hidden.measurement.obscuredBy?.position).toBe("sticky");
				expect(Array.from(hidden.screenshot!.slice(0, 8))).toEqual(PNG_MAGIC);
				expect(only(result, "#home").foundBy).toBeUndefined();

				const after = await page.adaptor.evaluate(() => ({
					scrollY: window.scrollY,
					leftovers: document.querySelectorAll("[data-a11y-obscurer], [data-a11y-context-outline]")
						.length,
					state: "__a11yPulseScrollCheck" in window || "__a11yPulseInertCovers" in window,
				}));

				expect(after).toEqual({ scrollY: 0, leftovers: 0, state: false });
			} finally {
				await page.close();
			}
		});

		it("honours scroll-padding-top under a sticky header", async () => {
			const result = await runFixture("sticky-header-padded.html");

			expect(summarise(result)).toEqual([
				"#home: pass",
				"#s1: pass",
				"#s2: pass",
				"#s3: pass",
				"#s4: pass",
			]);
			expect(result.summary.scrolledToTopChecked).toBe(4);
		});

		it("skips the scrolled-to-top check when scrolledToTopLimit is 0", async () => {
			const result = await runFixture("sticky-header.html", { scrolledToTopLimit: 0 });

			expect(result.elements.every((element) => element.bucket === "pass")).toBe(true);
			expect(result.summary.scrolledToTopChecked).toBe(0);
		});
	},
);
