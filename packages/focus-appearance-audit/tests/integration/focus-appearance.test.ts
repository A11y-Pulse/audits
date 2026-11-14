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
	type FocusAppearanceOptions,
	type FocusAppearanceResult,
	runFocusAppearanceAudit,
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
	"focus appearance audit (integration)",
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
			options?: FocusAppearanceOptions,
		): Promise<FocusAppearanceResult> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);

				return await runFocusAppearanceAudit(page.adaptor, options);
			} finally {
				await page.close();
			}
		}

		it("passes a page where every element has a focus outline", async () => {
			const result = await runFixture("all-pass.html");
			expect(result.summary).toMatchObject({ checked: 3, passed: 3, failed: 0, needsReview: 0 });
			expect(result.elements.map((e) => e.detectionMethod)).toEqual(["style", "style", "style"]);
			expect(result.elements[0]?.changedProperties).toEqual([
				"outline-color",
				"outline-style",
				"outline-width",
			]);
		});

		it("flags every element when focus styles are suppressed", async () => {
			const result = await runFixture("all-fail.html");
			expect(result.summary).toMatchObject({ checked: 2, passed: 0, failed: 2, needsReview: 0 });
		});

		it("flags only the failing element on a mixed page", async () => {
			const result = await runFixture("mixed.html");
			const failed = result.elements.filter((e) => !e.passed);
			expect(failed).toHaveLength(1);
			expect(failed[0]?.selector).toBe("#bad");
			expect(failed[0]?.html).toContain('id="bad"');
			expect(failed[0]?.html).not.toContain("data-a11y-focus-idx");
		});

		/** Each element's selector against how it came out, for exact comparison. */
		function outcomes(result: FocusAppearanceResult): Record<string, string> {
			return Object.fromEntries(
				result.elements.map((element) => [
					element.selector,
					element.needsReview !== undefined
						? `review:${element.needsReview}`
						: (element.detectionMethod ?? "fail"),
				]),
			);
		}

		it("fails visually hidden inputs whose custom control shows no focus", async () => {
			// The browser's default outline lands on the hidden input, where nobody can see it. The
			// label is compared instead, and only the controls that style their visible box pass.
			const result = await runFixture("hidden-inputs.html");

			expect(outcomes(result)).toEqual({
				"#bad-sr-only": "fail",
				"#bad-opacity": "fail",
				"#bad-offscreen": "fail",
				"#good-sr-only": "pixel-diff",
				"#good-opacity": "pixel-diff",
				"#good-offscreen": "pixel-diff",
			});
			expect(result.elements.map((e) => e.measuredOn)).toEqual(Array(6).fill("label"));
			expect(result.elements[0]?.failureEvidence?.focusedScreenshot.byteLength).toBeGreaterThan(0);
		});

		it("compares the label or parent of a hidden input that has no wrapping label", async () => {
			const result = await runFixture("hidden-input-separate-label.html");

			expect(outcomes(result)).toEqual({
				"#good": "pixel-diff",
				"#bad": "fail",
				"#unlabelled": "fail",
			});
			expect(result.elements.map((e) => e.measuredOn)).toEqual(["label", "label", "parent"]);
		});

		it("does not count transparent outlines, shadows or borders as indicators", async () => {
			const result = await runFixture("transparent-indicators.html");

			expect(outcomes(result)).toEqual({
				"#transparent-outline": "fail",
				"#transparent-shadow": "fail",
				"#transparent-border": "fail",
				"#ring": "style",
				"#outline": "style",
			});
			// The ring's transparent outline is not what passed it.
			expect(result.elements[3]?.changedProperties).toEqual(["box-shadow"]);
		});

		it("sends text fields that show only a caret for review, the same on every engine", async () => {
			const result = await runFixture("text-inputs.html");
			// Firefox selects a read-only field's text on Tab and paints the selection.
			const readonlySelects = engine.name === "playwright-firefox";

			expect(outcomes(result)).toEqual({
				"#caret-only": "review:caret",
				"#caret-textarea": "review:caret",
				"#no-caret": "fail",
				"#outlined": "style",
				"#readonly": readonlySelects ? "pixel-diff" : "fail",
			});
			expect(result.summary).toMatchObject(
				readonlySelects
					? { passed: 2, failed: 1, needsReview: 2 }
					: { passed: 1, failed: 2, needsReview: 2 },
			);
		});

		it("leaves no trace of hiding the caret", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/text-inputs.html`);
				await runFocusAppearanceAudit(page.adaptor);

				const left = await page.adaptor.evaluate(() => ({
					sheets: document.adoptedStyleSheets.length,
					state: "__a11yPulsePair" in window,
					caret: getComputedStyle(document.querySelector("#caret-only") as Element).caretColor,
				}));

				expect(left.sheets).toBe(0);
				expect(left.state).toBe(false);
				expect(left.caret).not.toMatch(/rgba\(0, 0, 0, 0\)|transparent/);
			} finally {
				await page.close();
			}
		});

		it("finds an indicator drawn on a :focus-within wrapper or a label", async () => {
			const result = await runFixture("focus-within.html");

			expect(outcomes(result)).toEqual({
				"#wrapped": "style",
				"#labelled": "style",
				"#unstyled-wrapper": "fail",
			});
			expect(result.elements[0]?.indicatorOn).toEqual({
				kind: "ancestor",
				html: '<div class="search" role="search">',
			});
			expect(result.elements[0]?.changedProperties).toContain("box-shadow");
			expect(result.elements[1]?.indicatorOn).toEqual({
				kind: "label",
				html: '<label for="labelled">',
			});
		});

		it("judges :focus-visible rules as the keyboard sees them", async () => {
			const result = await runFixture("focus-visible.html");

			expect(outcomes(result)).toEqual({
				"#fv": "style",
				"#link": "style",
				"#mouse-only": "fail",
			});
		});

		it("detects indicators that transition in", async () => {
			const result = await runFixture("transition.html");

			expect(outcomes(result)).toEqual({
				"#fade": "style",
				"#filter": "pixel-diff",
				"#none": "fail",
			});
		});

		it("measures sticky and fixed elements, and reviews one pinned under a banner", async () => {
			const result = await runFixture("sticky-layout.html");

			expect(outcomes(result)).toEqual({
				"#header-good": "style",
				"#header-bad": "fail",
				"#body-top": "style",
				"#body-middle": "style",
				// The last link in the document cannot be scrolled out from under the cookie banner, so
				// its screenshots show the banner. That is not evidence of a missing indicator.
				"#pinned-under-banner": "review:obstructed",
				"#accept": "style",
			});

			const pinned = result.elements.find((e) => e.selector === "#pinned-under-banner");
			expect(pinned?.passed).toBe(false);
			expect(pinned?.failureEvidence).toBeDefined();
		});

		it("checks links that wrap across lines", async () => {
			const result = await runFixture("wrapped-links.html");

			expect(outcomes(result)).toEqual({
				"#wrapped-good": "style",
				"#wrapped-underline": "style",
				"#wrapped-bad": "fail",
			});
		});

		it("flags focus shown by one colour changing", async () => {
			const result = await runFixture("color-only.html");
			const colorOnly = Object.fromEntries(
				result.elements.map((element) => [
					element.selector,
					element.colorOnly
						? `${element.colorOnly.property} ${element.colorOnly.contrastRatio?.toFixed(1)}`
						: null,
				]),
			);

			expect(result.summary).toMatchObject({ checked: 7, passed: 7, failed: 0 });
			expect(colorOnly).toEqual({
				"#text-low": "color 1.2",
				"#text-high": "color 4.8",
				"#text-underline": null,
				"#border-low": "border-color 1.2",
				"#border-high": "border-color 7.4",
				"#background-low": "background-color 1.1",
				"#outline-low": "outline-color 1.2",
			});

			const low = result.elements.find((e) => e.selector === "#text-low")?.colorOnly;
			expect(low?.backgroundColor).toBe("rgb(255, 255, 255)");
			expect(low?.evidence?.focusedScreenshot.byteLength).toBeGreaterThan(0);

			// Distinguishable by lightness alone: recorded, but no screenshots are needed.
			const high = result.elements.find((e) => e.selector === "#text-high")?.colorOnly;
			expect(high).not.toHaveProperty("evidence");
		});

		it("stops keeping screenshots at screenshotLimit but still checks every element", async () => {
			const result = await runFixture("hidden-inputs.html", { screenshotLimit: 1 });

			expect(result.summary).toMatchObject({ checked: 6, failed: 3, reachedScreenshotLimit: true });
			expect(
				result.elements.filter((e) => !e.passed).map((e) => e.failureEvidence !== undefined),
			).toEqual([true, false, false]);
		});

		/** Each measured element's selector against its contrast: a rounded ratio, or why there is none. */
		function contrasts(result: FocusAppearanceResult): Record<string, string | number> {
			return Object.fromEntries(
				result.elements
					.filter((element) => element.indicatorContrast !== undefined)
					.map(({ selector, indicatorContrast }) => [
						selector,
						indicatorContrast?.ratio == null
							? `unknown:${indicatorContrast?.reason}`
							: Math.round(indicatorContrast.ratio * 10) / 10,
					]),
			);
		}

		it("measures the contrast of each focus indicator", async () => {
			const result = await runFixture("indicator-contrast.html");

			// Every one of these has an indicator: contrast is judged apart from 2.4.7.
			expect(result.summary).toMatchObject({ checked: 12, passed: 12, failed: 0 });
			expect(contrasts(result)).toEqual({
				"#strong-outline": 5.8,
				"#faint-outline": 1.4,
				"#thin-outline": 5.8,
				// Mid-grey on white: enough against what is next to it, however little it moved from
				// the grey it was. That it is the only change is the colour-only check's business.
				"#border-shift": 3.5,
				"#ring-and-border": 5.1,
				"#underline-and-border": 3.5,
				"#ring-on-dark": 11.1,
				// The colours behind it cannot be read from styles, so the screenshots are: the blue
				// outline all but disappears into the dark end of the photograph.
				"#over-image": 1.3,
				"#strong-label": 12.4,
				"#faint-label": 1.5,
				"#subtle-label": 1.1,
			});
			expect(result.summary.lowContrastIndicators).toBe(4);

			const bySelector = Object.fromEntries(result.elements.map((e) => [e.selector, e]));

			expect(bySelector["#faint-outline"]?.indicatorContrast).toMatchObject({
				method: "style",
				property: "outline",
				indicatorColor: "rgb(217, 217, 217)",
				adjacentColor: "rgb(255, 255, 255)",
				comparedAgainst: "surroundings",
			});
			expect(bySelector["#border-shift"]?.indicatorContrast).toMatchObject({
				method: "style",
				property: "border",
				indicatorColor: "rgb(138, 138, 138)",
				adjacentColor: "rgb(255, 255, 255)",
			});
			expect(bySelector["#border-shift"]?.indicatorContrast?.stateChangeRatio).toBeCloseTo(1.2, 1);
			expect(bySelector["#border-shift"]?.colorOnly?.contrastRatio).toBeCloseTo(1.2, 1);
			expect(bySelector["#over-image"]?.indicatorContrast).toMatchObject({
				method: "pixels",
				comparedAgainst: "adjacent-pixels",
			});
			expect(bySelector["#ring-on-dark"]?.indicatorContrast).toMatchObject({
				property: "box-shadow",
				adjacentColor: "rgb(20, 33, 61)",
			});
			// The hidden checkboxes are judged from the screenshots of their labels.
			expect(bySelector["#strong-label"]?.indicatorContrast).toMatchObject({
				method: "pixels",
				indicatorColor: "rgb(29, 53, 87)",
				adjacentColor: "rgb(255, 255, 255)",
			});
			expect(bySelector["#faint-label"]?.indicatorContrast).toMatchObject({
				method: "pixels",
				indicatorColor: "rgb(208, 208, 208)",
			});
			// Too faint to count as a pixel difference, found on its wrapping label's styles, then measured finely.
			expect(bySelector["#subtle-label"]).toMatchObject({
				detectionMethod: "style",
				indicatorOn: { kind: "ancestor" },
				indicatorContrast: { method: "pixels", indicatorColor: "rgb(244, 244, 244)" },
			});

			// Screenshots are kept for the weak ones only.
			expect(
				result.elements
					.filter((e) => e.indicatorContrast?.evidence !== undefined)
					.map((e) => e.selector),
			).toEqual(["#faint-outline", "#over-image", "#faint-label", "#subtle-label"]);
		});

		it("does not judge an indicator part-way through a transition, and waits for one it screenshots", async () => {
			const result = await runFixture("transition.html");

			expect(contrasts(result)).toEqual({
				// Read from styles while the ring was still fading in: a part-way colour says nothing.
				"#fade": "unknown:translucent",
				// Read from screenshots, which wait for the fade to finish: black against the white page.
				"#filter": 21,
			});
			expect(result.summary.lowContrastIndicators).toBe(0);
		});

		it("leaves the browser's default focus ring and unmeasurable indicators alone", async () => {
			const result = await runFixture("indicator-contrast.html");
			const measured = Object.keys(contrasts(result));

			// The default ring is the browser's, and a pseudo-element's colours are not read.
			expect(measured).not.toContain("#default-ring");
			expect(contrasts(await runFixture("pseudo.html"))).toEqual({});
		});

		it("judges an indicator against the colours next to it, not against the unfocused state", async () => {
			const result = await runFixture("indicator-adjacent.html");
			const bySelector = Object.fromEntries(result.elements.map((e) => [e.selector, e]));

			expect(result.summary).toMatchObject({ checked: 6, passed: 6, failed: 0 });
			expect(contrasts(result)).toEqual({
				// Blue on white, however little it differs from the grey it replaced.
				"#recolour": 8.6,
				// Outlines pulled inside the button by a negative offset sit on the button's own fill.
				"#inset-outline": 16,
				"#faint-inset": 1.2,
				// Positioned over a dark layer that no ancestor accounts for: read from the screenshots.
				"#over-layer": 16,
				// A white border on a dark fill stands out from the fill, if not from the white page.
				"#filled-border": 16,
				"#appearing-bg": 1.3,
			});

			expect(bySelector["#recolour"]?.indicatorContrast).toMatchObject({
				method: "style",
				property: "border",
				indicatorColor: "rgb(0, 0, 255)",
				adjacentColor: "rgb(255, 255, 255)",
			});
			// How far it moved from the unfocused grey is recorded, and decides nothing.
			expect(bySelector["#recolour"]?.indicatorContrast?.stateChangeRatio).toBeCloseTo(1.89, 1);
			expect(bySelector["#inset-outline"]?.indicatorContrast).toMatchObject({
				property: "outline",
				comparedAgainst: "own-background",
				adjacentColor: "rgb(20, 33, 61)",
			});
			expect(bySelector["#over-layer"]?.indicatorContrast).toMatchObject({
				method: "pixels",
				comparedAgainst: "adjacent-pixels",
				indicatorColor: "rgb(255, 255, 255)",
				adjacentColor: "rgb(20, 33, 61)",
			});
			expect(bySelector["#filled-border"]?.indicatorContrast).toMatchObject({
				property: "border",
				comparedAgainst: "own-background",
			});

			// A background that appears on focus is one colour changing. It is measured against the
			// white that showed through before, and left to the colour-only check.
			expect(bySelector["#appearing-bg"]?.colorOnly).toMatchObject({
				property: "background-color",
				unfocusedColor: "rgba(0, 0, 0, 0)",
				focusedColor: "rgb(255, 221, 0)",
				backgroundColor: "rgb(255, 255, 255)",
			});
			expect(bySelector["#appearing-bg"]?.colorOnly?.contrastRatio).toBeCloseTo(1.35, 1);
			expect(result.summary.lowContrastIndicators).toBe(1);
		});

		it("does not report a change of text colour as a low-contrast indicator", async () => {
			// With the style check off every element is read from screenshots, where a recoloured
			// link is just changed pixels: they are judged against the page behind them.
			const result = await runFixture("color-only.html", { skipStyleCheck: true });
			const text = result.elements.filter((e) => e.selector.startsWith("#text-"));

			expect(text.map((e) => e.detectionMethod)).toEqual([
				"pixel-diff",
				"pixel-diff",
				"pixel-diff",
			]);
			expect(text.map((e) => (e.indicatorContrast?.ratio ?? 0) >= 3)).toEqual([true, false, true]);
			// Near enough white: the edges of glyphs are blended with it.
			expect(text[1]?.indicatorContrast?.adjacentColor).toMatch(/^rgb\(25\d, 25\d, 25\d\)$/);
		});

		it("leaves the browser's default ring alone when it is found from screenshots", async () => {
			const late = await runFixture("late-default-ring.html");

			expect(outcomes(late)).toEqual({ "#first": "style", "#late": "pixel-diff" });
			expect(contrasts(late)).toEqual({});
			expect(late.summary.lowContrastIndicators).toBe(0);

			const unchecked = await runFixture("late-default-ring.html", { skipStyleCheck: true });

			expect(outcomes(unchecked)).toEqual({ "#first": "pixel-diff", "#late": "pixel-diff" });
			expect(contrasts(unchecked)).toEqual({});
		});

		it("does not pass elements on a wrapper they share or one that is animating", async () => {
			const result = await runFixture("shared-wrapper.html");

			expect(outcomes(result)).toEqual({
				// The group lights up for either button, so it does not say which one has focus.
				"#bold": "review:shared-indicator",
				"#italic": "review:shared-indicator",
				// The group pulses on its own: what differs between two reads is the animation.
				"#like": "review:animating",
				"#share": "review:animating",
				// A wrapper around a single control does identify it.
				"#publish-now": "style",
			});
			expect(result.summary).toMatchObject({ checked: 5, passed: 1, failed: 0, needsReview: 4 });
			expect(result.elements[4]?.indicatorOn).toMatchObject({ kind: "ancestor" });
		});

		it("finds the indicator of a hidden input on a sibling box away from its label", async () => {
			const result = await runFixture("hidden-input-sibling-box.html");

			expect(outcomes(result)).toEqual({ "#receipts": "pixel-diff", "#offers": "fail" });
			expect(result.elements.map((e) => e.measuredOn)).toEqual(["label", "label"]);
			expect(contrasts(result)).toEqual({ "#receipts": 5.8 });
		});

		it("passes a box-shadow indicator via the computed-style path", async () => {
			const result = await runFixture("box-shadow.html");
			const passed = result.elements.filter((e) => e.passed);
			expect(passed).toHaveLength(1);
			expect(passed[0]?.detectionMethod).toBe("style");
		});

		it("passes a pseudo-element indicator via the computed-style path", async () => {
			const result = await runFixture("pseudo.html");
			const passed = result.elements.filter((e) => e.passed);
			expect(passed).toHaveLength(1);
			expect(passed[0]?.detectionMethod).toBe("style");
		});

		it("passes a filter-only indicator via the pixel-diff fallback", async () => {
			// `filter` is not in the computed-style allowlist, so this can only pass via the
			// screenshot/pixel-diff fallback.
			const result = await runFixture("filter.html");
			const passed = result.elements.filter((e) => e.passed);
			expect(passed).toHaveLength(1);
			expect(passed[0]?.detectionMethod).toBe("pixel-diff");
		});

		it("fails a focus rule that only changes margin", async () => {
			const result = await runFixture("margin-only.html");
			expect(result.summary.failed).toBe(1);
		});

		it("resolves focusable elements inside an open shadow root", async () => {
			const result = await runFixture("shadow-dom.html");
			const failed = result.elements.filter((e) => !e.passed);
			expect(failed).toHaveLength(2);

			const selectors = failed.map((e) => e.selector);
			expect(new Set(selectors).size).toBe(2);
			expect(selectors).not.toContain("#rnz-site-footer");
		});

		it("detects a shadow-DOM focus indicator via the style stage", async () => {
			// The element lives in an open shadow root and has an outline focus style. Passing via "style"
			// (not "pixel-diff") proves baselineScript snapshotted it, i.e. the style stage descends shadow
			// roots.
			const result = await runFixture("shadow-dom-pass.html");
			const passed = result.elements.filter((e) => e.passed);
			expect(passed).toHaveLength(1);
			expect(passed[0]?.detectionMethod).toBe("style");
		});

		it("falls back to pixel diff for every element when skipStyleCheck is set", async () => {
			// box-shadow.html passes via "style" by default. With the style stage skipped, the same visible
			// indicator must instead be caught by the pixel diff, proving skipStyleCheck routes detection
			// through the fallback.
			const result = await runFixture("box-shadow.html", {
				skipStyleCheck: true,
			});
			const passed = result.elements.filter((e) => e.passed);
			expect(passed).toHaveLength(1);
			expect(passed[0]?.detectionMethod).toBe("pixel-diff");
		});

		// Firefox reports no detection for an element inside a closed shadow root, where Chromium
		// reports a pixel diff.
		it.skipIf(engine.name === "playwright-firefox")(
			"detects a focus indicator inside a closed shadow root via the pixel diff",
			async () => {
				// document.activeElement resolves to the host (closed roots can't be traversed), so the style
				// stage can't see the inner button's outline. The pixel diff captures the focused frame before
				// blurring, so the indicator is still caught even though the host can't be re-focused into the
				// root.
				const result = await runFixture("closed-shadow.html");
				expect(result.summary.checked).toBe(1);
				expect(result.summary.passed).toBe(1);

				const [element] = result.elements;
				expect(element?.selector).toBe("#host");
				expect(element?.detectionMethod).toBe("pixel-diff");
			},
		);

		// Firefox reports no detection for the elements after a closed-shadow host, where Chromium
		// reports a pixel diff.
		it.skipIf(engine.name === "playwright-firefox")(
			"keeps checking elements after a closed-shadow host",
			async () => {
				// The closed-shadow host is caught by the pixel diff, which disturbs focus (blur, then a host
				// re-focus that lands on <body>). This guards that the audit still reaches the elements after
				// it rather than aborting the page.
				const result = await runFixture("closed-shadow-then-buttons.html");
				expect(result.summary.checked).toBe(3);

				const bySelector = new Map(result.elements.map((e) => [e.selector, e]));
				expect(bySelector.get("#host")?.detectionMethod).toBe("pixel-diff");
				// The trailing buttons still match their baseline snapshot (captured before the host's
				// blur/refocus churn) and pass via the style stage.
				expect(bySelector.get("#after-1")?.detectionMethod).toBe("style");
				expect(bySelector.get("#after-2")?.detectionMethod).toBe("style");
			},
		);

		it("never lets a clipped screenshot resize the page's viewport", async () => {
			// A clipped capture over CDP with captureBeyondViewport shrinks the emulated viewport to 1x1
			// before restoring it. A page that observes that resize can flip to its narrow breakpoint and
			// hide the focused element, which blurs it, so the "focused" screenshot has no indicator and
			// the element is reported as failing. The ring here is drawn by a child, so the elements can
			// only pass via screenshots.
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/responsive-nav.html`);

				const result = await runFocusAppearanceAudit(page.adaptor);

				expect(result.elements.map((e) => e.detectionMethod)).toEqual([
					"pixel-diff",
					"pixel-diff",
					"pixel-diff",
				]);

				const resizes = await page.adaptor.evaluate(
					() => (window as unknown as { __resizes: unknown[] }).__resizes,
				);
				expect(resizes).toEqual([]);
			} finally {
				await page.close();
			}
		});

		it("ends as completed once the page has been tabbed to the end", async () => {
			// The tab press that leaves the last element takes focus out of the
			// document entirely, which reads identically to a stolen focus. Ending
			// such a session as `lostFocus` would demote every genuine failure on a
			// fully-walked page to `incomplete`.
			const result = await runFixture("all-pass.html");
			expect(result.summary.sessionEnd).toBe("completed");
		});

		it("never invents failures when the page is backgrounded mid-session", async () => {
			const page = await engine.newPage();
			const foreground = await engine.newPage();

			try {
				await page.goto(`${server.url}/all-pass.html`);
				// The loss under test is the one pressTab introduces below, not a page that never had focus
				// at all.
				await page.bringToFront();

				const adaptor = page.adaptor;
				adaptor.ensureFocusReporting = async () => {};
				const pressTab = adaptor.pressTab.bind(adaptor);
				adaptor.pressTab = async () => {
					await pressTab();
					await foreground.bringToFront();
				};

				const result = await runFocusAppearanceAudit(adaptor);

				// The point of the lostFocus handling, and true of every engine: an element the audit could
				// not fairly measure is never reported as failing.
				expect(result.elements.filter((e) => !e.passed)).toEqual([]);
				// A backgrounded Puppeteer page stays blurred, so the audit measures nothing and bails.
				// Playwright's pages still report focus at each measurement and only end up backgrounded
				// once the last Tab has been pressed, so the session reaches its natural end instead.
				expect(result.summary.sessionEnd).toBe(
					engine.driver === "puppeteer" ? "lostFocus" : "completed",
				);
			} finally {
				await foreground.close();
				await page.close();
			}
		});

		it("runs on every navigation when one page is reused", async () => {
			// Mirrors production: one page, multiple navigations, no manual re-focus. ensureFocusReporting
			// must keep document.hasFocus() true across all of them.
			const page = await engine.newPage();

			try {
				const runOnce = async () => {
					await page.goto(`${server.url}/all-fail.html`);

					return runFocusAppearanceAudit(page.adaptor);
				};

				const first = await runOnce();
				const second = await runOnce();
				const third = await runOnce();

				expect(first.summary.failed).toBe(2);
				expect(second.summary.failed).toBe(2);
				expect(third.summary.failed).toBe(2);
			} finally {
				await page.close();
			}
		});
	},
);
