import { describe, expect, it } from "vitest";
import type { CollectedRegion } from "./browser-scripts";
import { type ClassifyOptions, classifyRegion } from "./classify";

const OPTIONS: ClassifyOptions = {
	observedMs: 5000,
	durationLimitMs: 5000,
	largeRegionArea: 20_000,
};

function region(overrides: Partial<CollectedRegion> = {}): CollectedRegion {
	return {
		elementIndex: 0,
		html: '<div class="carousel">',
		rect: { x: 0, y: 0, width: 800, height: 300 },
		times: [],
		appeared: false,
		animations: [],
		marquee: null,
		video: null,
		control: null,
		pausesOn: [],
		reducedMotion: null,
		...overrides,
	};
}

const TICKER = {
	name: "ticker",
	css: true,
	infinite: true,
	activeDurationMs: null,
	properties: ["transform"],
	pseudoElement: null,
	pseudoArea: null,
};

describe("classifyRegion", () => {
	describe("movement seen by watching the page", () => {
		it("fails a large region that changed in several parts of the window, the last part included", () => {
			expect(classifyRegion(region({ times: [1000, 1100, 3000, 3100, 4900] }), OPTIONS)).toEqual({
				verdict: "failed",
				finding: "no-pause-control",
				motion: "script",
				detectedBy: "dom-observation",
				observedMs: 4900,
			});
		});

		it("does not report a region that stopped changing early in the window", () => {
			// An entrance effect: busy for the first two seconds, then still.
			expect(classifyRegion(region({ times: [0, 200, 400, 1200, 1900] }), OPTIONS)).toBeNull();
		});

		it("does not report a single late change", () => {
			// A banner that loads late and stays put.
			expect(classifyRegion(region({ times: [4200] }), OPTIONS)).toBeNull();
		});

		it("sends a region that only changed in the last part of the window for review", () => {
			// One slide transition of a carousel on a four-second timer.
			expect(classifyRegion(region({ times: [4000, 4100, 4200] }), OPTIONS)).toMatchObject({
				verdict: "needsReview",
				finding: "changed-once",
			});
		});

		it("does not call one burst of change sustained just because it is long or late", () => {
			// One 300ms slide that starts at 2.8s: it used to straddle two fifths of the window and
			// fail as movement that kept going.
			expect(classifyRegion(region({ times: [2800, 2900, 3000, 3100] }), OPTIONS)).toMatchObject({
				verdict: "needsReview",
				finding: "changed-once",
			});
		});

		it("does not report one burst from content that only arrived during the window", () => {
			// An ad that was put in and then eased to its final size.
			const times = [3500, 3600, 3700];

			expect(classifyRegion(region({ times, appeared: true }), OPTIONS)).toBeNull();
			// Content that arrives and then keeps changing is still reported.
			expect(
				classifyRegion(region({ times: [1500, ...times], appeared: true }), OPTIONS),
			).toMatchObject({ verdict: "failed", finding: "no-pause-control" });
		});

		it("fails movement that runs on without a pause for much of the window", () => {
			// A ticker a script moves on every frame, sampled ten times a second.
			const times = Array.from({ length: 30 }, (_, i) => 2000 + i * 100);

			expect(classifyRegion(region({ times }), OPTIONS)).toMatchObject({
				verdict: "failed",
				motion: "script",
			});
		});

		it("uses the quiet gap it is given to tell one burst from two", () => {
			const times = [3000, 3100, 3500, 3600];

			// 400ms apart: one burst by default, two when the gap is 300ms.
			expect(classifyRegion(region({ times }), OPTIONS)?.finding).toBe("changed-once");
			expect(classifyRegion(region({ times }), { ...OPTIONS, quietGapMs: 300 })?.verdict).toBe(
				"failed",
			);
		});

		it("measures the window it was given, not five seconds", () => {
			const short = { ...OPTIONS, observedMs: 1000 };

			expect(classifyRegion(region({ times: [250, 500, 750] }), short)?.verdict).toBe("failed");
			expect(classifyRegion(region({ times: [250, 500, 750] }), OPTIONS)).toBeNull();
		});
	});

	describe("animations", () => {
		it("fails a large region with an endless animation that moves it", () => {
			expect(classifyRegion(region({ animations: [TICKER] }), OPTIONS)).toEqual({
				verdict: "failed",
				finding: "no-pause-control",
				motion: "css-animation",
				detectedBy: "animation-api",
				observedMs: 5000,
			});
		});

		it("calls an animation a script started a web animation", () => {
			const animations = [{ ...TICKER, css: false, name: null }];

			expect(classifyRegion(region({ animations }), OPTIONS)?.motion).toBe("web-animation");
		});

		it.each([["backgroundColor"], ["boxShadow"], ["filter"]])(
			"sends an animation of %s alone for review",
			(property) => {
				const animations = [{ ...TICKER, properties: [property] }];

				expect(classifyRegion(region({ animations }), OPTIONS)).toMatchObject({
					verdict: "needsReview",
					finding: "subtle-animation",
				});
			},
		);

		it.each([
			["transform"],
			["opacity"],
			["backgroundPositionX"],
			["marginLeft"],
			["strokeDashoffset"],
			["left"],
		])("treats an animation of %s as movement", (property) => {
			const animations = [{ ...TICKER, properties: [property] }];

			expect(classifyRegion(region({ animations }), OPTIONS)?.verdict).toBe("failed");
		});

		it("sends an animation whose keyframes could not be read for review", () => {
			const animations = [{ ...TICKER, properties: [] }];

			expect(classifyRegion(region({ animations }), OPTIONS)?.finding).toBe("subtle-animation");
		});

		it("sends an animation on a pseudo-element of unknown size for review", () => {
			const animations = [{ ...TICKER, pseudoElement: "::after", pseudoArea: null }];

			expect(classifyRegion(region({ animations }), OPTIONS)).toMatchObject({
				verdict: "needsReview",
				finding: "pseudo-element",
				motion: "css-animation",
			});
		});

		it("treats a pseudo-element as large as a failing region as the region moving", () => {
			const large = [{ ...TICKER, pseudoElement: "::before", pseudoArea: 20_000 }];
			const medium = [{ ...TICKER, pseudoElement: "::before", pseudoArea: 19_999 }];

			expect(classifyRegion(region({ animations: large }), OPTIONS)?.verdict).toBe("failed");
			expect(classifyRegion(region({ animations: medium }), OPTIONS)?.finding).toBe(
				"pseudo-element",
			);
		});

		it("fails on the element's own animation whatever its pseudo-elements do", () => {
			const animations = [{ ...TICKER, pseudoElement: "::after", pseudoArea: null }, TICKER];

			expect(classifyRegion(region({ animations }), OPTIONS)?.verdict).toBe("failed");
		});

		it("sends an animation that pauses on hover for review, since a keyboard cannot hover", () => {
			expect(
				classifyRegion(region({ animations: [TICKER], pausesOn: ["hover"] }), OPTIONS),
			).toMatchObject({ verdict: "needsReview", finding: "pauses-on-hover" });
		});

		it("reports pausing on focus ahead of pausing on hover", () => {
			expect(
				classifyRegion(region({ animations: [TICKER], pausesOn: ["hover", "focus"] }), OPTIONS)
					?.finding,
			).toBe("pauses-on-focus");
		});

		it("does not let a prefers-reduced-motion rule excuse the animation", () => {
			expect(
				classifyRegion(region({ animations: [TICKER], reducedMotion: true }), OPTIONS)?.verdict,
			).toBe("failed");
		});
	});

	describe("size", () => {
		it("sends a moving region under the large-region area for review", () => {
			const small = region({ animations: [TICKER], rect: { x: 0, y: 0, width: 120, height: 80 } });

			expect(classifyRegion(small, OPTIONS)).toMatchObject({
				verdict: "needsReview",
				finding: "small-region",
			});
		});

		it("fails a region exactly at the large-region area", () => {
			const exact = region({ animations: [TICKER], rect: { x: 0, y: 0, width: 200, height: 100 } });

			expect(classifyRegion(exact, OPTIONS)?.verdict).toBe("failed");
		});
	});

	describe("pause mechanisms", () => {
		const control = {
			elementIndex: 1,
			html: "<button>",
			name: "Pause slideshow",
			foundBy: "name" as const,
		};

		it("passes a moving region with a pause control", () => {
			expect(classifyRegion(region({ animations: [TICKER], control }), OPTIONS)).toMatchObject({
				verdict: "passed",
				finding: "pause-control",
				motion: "css-animation",
			});
		});

		it("passes on a control even when the movement itself is in doubt", () => {
			expect(classifyRegion(region({ times: [4000, 4100], control }), OPTIONS)?.verdict).toBe(
				"passed",
			);
		});

		it("does not report a region that has a pause control but was not seen moving", () => {
			expect(classifyRegion(region({ control }), OPTIONS)).toBeNull();
		});
	});

	describe("marquee", () => {
		it("fails an endless <marquee>", () => {
			expect(classifyRegion(region({ marquee: { loop: -1 } }), OPTIONS)).toMatchObject({
				verdict: "failed",
				motion: "marquee",
				detectedBy: "element",
			});
		});

		it("sends a <marquee> with a loop count for review", () => {
			expect(classifyRegion(region({ marquee: { loop: 2 } }), OPTIONS)).toMatchObject({
				verdict: "needsReview",
				finding: "finite-loop",
			});
		});
	});

	describe("video", () => {
		const video = {
			controls: false,
			endless: true,
			durationS: 12,
			playingAtStart: true,
			advanced: true,
		};

		it("fails a looping video that plays through the window with no controls", () => {
			expect(classifyRegion(region({ video }), OPTIONS)).toMatchObject({
				verdict: "failed",
				finding: "no-pause-control",
				motion: "video",
				detectedBy: "media-element",
			});
		});

		it("passes a video with the browser's controls", () => {
			expect(
				classifyRegion(region({ video: { ...video, controls: true } }), OPTIONS),
			).toMatchObject({ verdict: "passed", finding: "native-controls" });
		});

		it("does not report a video that ends within five seconds", () => {
			const short = { ...video, endless: false, durationS: 4 };

			expect(classifyRegion(region({ video: short }), OPTIONS)).toBeNull();
		});

		it("fails a video longer than five seconds that does not loop", () => {
			const long = { ...video, endless: false, durationS: 30 };

			expect(classifyRegion(region({ video: long }), OPTIONS)?.verdict).toBe("failed");
		});

		it.each([
			["started during the window", { ...video, playingAtStart: false }],
			["has not advanced", { ...video, advanced: false }],
			["has no known length", { ...video, endless: false, durationS: null }],
		])("sends a video that %s for review", (_, uncertain) => {
			expect(classifyRegion(region({ video: uncertain }), OPTIONS)).toMatchObject({
				verdict: "needsReview",
				finding: "uncertain-playback",
			});
		});

		it("prefers strong evidence when a region moves in more than one way", () => {
			// A video of unknown length inside a region with an endless ticker.
			const mixed = region({
				video: { ...video, endless: false, durationS: null },
				animations: [TICKER],
			});

			expect(classifyRegion(mixed, OPTIONS)).toMatchObject({
				verdict: "failed",
				motion: "css-animation",
			});
		});
	});
});
