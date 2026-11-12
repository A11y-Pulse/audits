import { fakeStashAdaptor } from "@a11y-pulse/integration-harness/fake-stash-adaptor";
import { describe, expect, it } from "vitest";
import { type MovingContentOptions, pollInterval, quietGap, runMovingContentAudit } from "./audit";
import {
	type CollectedRegion,
	type CollectOptions,
	collectRegionsScript,
	type RegionCollection,
	startObservationScript,
	stopObservationScript,
} from "./browser-scripts";

const QUICK: MovingContentOptions = { observationWindow: 0, screenshotInterval: 0 };

const TICKER = {
	name: "ticker",
	css: true,
	infinite: true,
	activeDurationMs: null,
	properties: ["transform"],
	pseudoElement: null,
	pseudoArea: null,
};

function region(elementIndex: number, overrides: Partial<CollectedRegion> = {}): CollectedRegion {
	return {
		elementIndex,
		html: `<div class="ticker" data-index="${elementIndex}">`,
		rect: { x: 0, y: 0, width: 800, height: 50 },
		times: [],
		appeared: false,
		animations: [TICKER],
		marquee: null,
		video: null,
		control: null,
		pausesOn: [],
		reducedMotion: false,
		...overrides,
	};
}

function collection(
	regions: CollectedRegion[],
	extra: Partial<RegionCollection> = {},
): RegionCollection {
	return { elapsedMs: 5000, regions, total: regions.length, tooSmall: 0, essential: 0, ...extra };
}

function fakePage(collected: RegionCollection) {
	const page = fakeStashAdaptor(collectRegionsScript, collected, "region");
	const calls: { fn: unknown; args: unknown[] }[] = [];
	const evaluate = page.adaptor.evaluate;

	page.adaptor.evaluate = (async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
		calls.push({ fn, args });

		return evaluate(fn, ...args);
	}) as typeof evaluate;

	return { ...page, calls };
}

const small = { rect: { x: 0, y: 0, width: 120, height: 60 } };
const control = { elementIndex: 9, html: "<button>", name: "Pause", foundBy: "name" as const };

describe("runMovingContentAudit", () => {
	it("sorts regions into failed, needs review and passed", async () => {
		const page = fakePage(collection([region(0), region(1, small), region(2, { control })]));

		const result = await runMovingContentAudit(page.adaptor, QUICK);

		expect(result.failed).toEqual([
			{
				selector: "#region-0",
				html: '<div class="ticker" data-index="0">',
				rect: { x: 0, y: 0, width: 800, height: 50 },
				motion: "css-animation",
				detectedBy: "animation-api",
				finding: "no-pause-control",
				observedMs: 5000,
				animations: [
					{
						name: "ticker",
						infinite: true,
						activeDurationMs: null,
						properties: ["transform"],
						pseudoElement: null,
					},
				],
				pauseControl: null,
				pausesOn: [],
				reducedMotion: false,
				screenshot: new Uint8Array([1]),
				laterScreenshot: new Uint8Array([1]),
			},
		]);
		expect(result.needsReview).toMatchObject([{ selector: "#region-1", finding: "small-region" }]);
		expect(result.passed).toMatchObject([
			{
				selector: "#region-2",
				finding: "pause-control",
				pauseControl: { selector: "#region-9", html: "<button>", name: "Pause", foundBy: "name" },
			},
		]);
		expect(result.summary).toEqual({
			checked: 3,
			failed: 1,
			needsReview: 1,
			passed: 1,
			unchecked: 0,
			ignored: { essential: 0, tooSmall: 0 },
		});
		expect(result.observedMs).toBe(5000);
	});

	it("leaves out regions the page facts do not show moving past the window", async () => {
		// Changed early in the window, then stopped.
		const settled = region(0, { animations: [], times: [100, 300, 900] });
		const page = fakePage(collection([settled, region(1)]));

		const result = await runMovingContentAudit(page.adaptor, QUICK);

		expect(result.failed.map(({ selector }) => selector)).toEqual(["#region-1"]);
		expect(result.summary.checked).toBe(1);
	});

	it("carries the page's counts of ignored and unexamined regions", async () => {
		const page = fakePage(collection([region(0)], { total: 4, tooSmall: 2, essential: 5 }));

		const { summary } = await runMovingContentAudit(page.adaptor, QUICK);

		expect(summary.unchecked).toBe(3);
		expect(summary.ignored).toEqual({ essential: 5, tooSmall: 2 });
	});

	it("screenshots failed regions before needs-review ones, twice each, up to the limit", async () => {
		const page = fakePage(collection([region(3, small), region(4), region(5), region(6, small)]));

		const result = await runMovingContentAudit(page.adaptor, { ...QUICK, screenshotLimit: 3 });

		// Both failed regions, then the first for review; each pass captures them in the same order.
		expect(page.screenshotted()).toEqual([4, 5, 3, 4, 5, 3]);
		expect(result.failed.every((item) => item.screenshot && item.laterScreenshot)).toBe(true);
		expect(result.needsReview[0]).toHaveProperty("screenshot");
		expect(result.needsReview[1]).not.toHaveProperty("screenshot");
	});

	it("takes no screenshots when the limit is 0 or everything passed", async () => {
		const none = fakePage(collection([region(0)]));
		const passing = fakePage(collection([region(0, { control })]));

		await runMovingContentAudit(none.adaptor, { ...QUICK, screenshotLimit: 0 });
		await runMovingContentAudit(passing.adaptor, QUICK);

		expect(none.screenshotted()).toEqual([]);
		expect(passing.screenshotted()).toEqual([]);
	});

	it("passes its thresholds to the page and uses the large-region area itself", async () => {
		const page = fakePage(collection([region(0)]));

		const result = await runMovingContentAudit(page.adaptor, {
			...QUICK,
			minRegionArea: 123,
			regionLimit: 7,
			largeRegionArea: 50_000,
			controlNamePattern: "pauzeer",
		});

		const options = page.calls.find(({ fn }) => fn === collectRegionsScript)?.args[2];

		expect(options).toMatchObject({
			durationLimitMs: 5000,
			minRegionArea: 123,
			regionLimit: 7,
			controlNamePattern: "pauzeer",
		} satisfies Partial<CollectOptions>);
		// 800 x 50 is under the raised large-region area.
		expect(result.needsReview).toMatchObject([{ finding: "small-region" }]);
	});

	it("samples the page about fifty times over the window, within sane bounds", () => {
		expect(pollInterval(5000)).toBe(100);
		expect(pollInterval(0)).toBe(20);
		expect(pollInterval(60_000)).toBe(250);
	});

	it("gives the page and the classifier the same quiet gap: a tenth of the window, three samples at least", async () => {
		expect(quietGap(5000)).toBe(500);
		expect(quietGap(1000)).toBe(100);
		expect(quietGap(200)).toBe(60);

		// One burst under a 100ms gap, two under the 60ms gap a 200ms window gets.
		const page = fakePage(
			collection([region(0, { animations: [], times: [130, 150, 230, 250] })], { elapsedMs: 300 }),
		);

		const result = await runMovingContentAudit(page.adaptor, { ...QUICK, observationWindow: 200 });

		expect(page.calls.find(({ fn }) => fn === startObservationScript)?.args[4]).toBe(60);
		expect(result.failed).toMatchObject([{ selector: "#region-0", motion: "script" }]);
	});

	it("stops watching and releases the stash even when collecting fails", async () => {
		const page = fakePage(collection([]));
		const evaluate = page.adaptor.evaluate;

		page.adaptor.evaluate = (async (fn: (...args: unknown[]) => unknown, ...args: unknown[]) => {
			if (fn === collectRegionsScript) {
				throw new Error("page navigated");
			}

			return evaluate(fn, ...args);
		}) as typeof evaluate;

		await expect(runMovingContentAudit(page.adaptor, QUICK)).rejects.toThrow("page navigated");

		expect(page.calls.at(-2)?.fn).toBe(stopObservationScript);
		// The last call hands the stash key, alone, to the release script.
		expect(page.calls.at(-1)?.args).toEqual(["__a11yPulseMovingContent"]);
	});
});
