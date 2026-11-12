import { describe, expect, it } from "vitest";
import type { ReflowAuditAdaptor } from "./adaptor";
import { DEFAULT_SCREENSHOT_LIMIT, runReflowAudit } from "./audit";
import {
	type LayoutFingerprint,
	measureReflowScript,
	pageDimensionsScript,
	type ReflowMeasure,
	type ReflowMeasureOffender,
	readLayoutFingerprintScript,
	scrollWindowToScript,
} from "./browser-scripts";

const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 320, height: 800 };
const SETTLED: LayoutFingerprint = {
	scrollWidth: 320,
	clientWidth: 320,
	bodyScrollWidth: 320,
	bodyClientWidth: 320,
	childCount: 1,
};

const OPTIONS = { settleDelayMs: 0, settleAttempts: 4, minSettleMs: 0 };

function emptyMeasure(overrides: Partial<ReflowMeasure> = {}): ReflowMeasure {
	return {
		documentOverflowPx: 0,
		explainedByExempt: false,
		offenders: [],
		...overrides,
	};
}

function createFake(opts: {
	viewport?: { width: number; height: number };
	fingerprints?: LayoutFingerprint[];
	measure?: ReflowMeasure | (() => ReflowMeasure);
	throwOnMeasure?: Error;
	screenshotClipScale?: number;
	pageDimensions?: { width: number; height: number };
	/** Make a capture whose clip starts left of the document origin throw. */
	rejectNegativeClips?: boolean;
}): {
	adaptor: ReflowAuditAdaptor;
	setCalls: Array<{ width: number; height: number }>;
	current: () => { width: number; height: number };
	fingerprintReads: () => number;
	screenshotCalls: Array<{
		clip: { x: number; y: number; width: number; height: number };
		scale: number;
		viewportWidthAtCall: number;
		scrollAtCall: { x: number; y: number };
	}>;
	scroll: () => { x: number; y: number };
} {
	let scroll = { x: 0, y: 700 };
	let viewport = { ...(opts.viewport ?? WIDE) };
	const setCalls: Array<{ width: number; height: number }> = [];
	const screenshotCalls: Array<{
		clip: { x: number; y: number; width: number; height: number };
		scale: number;
		viewportWidthAtCall: number;
		scrollAtCall: { x: number; y: number };
	}> = [];
	let fingerprintIndex = 0;

	const adaptor: ReflowAuditAdaptor = {
		getViewport: async () => ({ ...viewport }),
		setViewport: async (v) => {
			setCalls.push({ ...v });
			viewport = { ...v };
		},
		evaluate: async <T>(
			fn: (...args: never[]) => T | Promise<T>,
			...args: unknown[]
		): Promise<T> => {
			if ((fn as unknown) === scrollWindowToScript) {
				const previous = scroll;
				scroll = { x: args[0] as number, y: (args[1] as number | null) ?? previous.y };

				return previous as T;
			}

			if (fn === readLayoutFingerprintScript) {
				const list = opts.fingerprints ?? [SETTLED];
				const next = list[Math.min(fingerprintIndex, list.length - 1)];
				fingerprintIndex += 1;

				return next as T;
			}

			if (fn === measureReflowScript) {
				if (opts.throwOnMeasure) {
					throw opts.throwOnMeasure;
				}

				if (typeof opts.measure === "function") {
					return opts.measure() as T;
				}

				return (opts.measure ?? emptyMeasure()) as T;
			}

			if (fn === pageDimensionsScript) {
				return (opts.pageDimensions ?? { width: 320, height: 1024 }) as T;
			}

			throw new Error(`unexpected evaluate: ${fn.name}`);
		},
		screenshotClip: async (clip, scale = 1) => {
			screenshotCalls.push({
				clip,
				scale,
				viewportWidthAtCall: viewport.width,
				scrollAtCall: scroll,
			});

			if (opts.rejectNegativeClips && clip.x < 0) {
				throw new Error("clip is outside the page");
			}

			return new Uint8Array([1, 2, 3]);
		},
		screenshotClipScale: opts.screenshotClipScale,
	};

	return {
		adaptor,
		setCalls,
		current: () => viewport,
		scroll: () => scroll,
		fingerprintReads: () => fingerprintIndex,
		screenshotCalls,
	};
}

describe("runReflowAudit viewport restore", () => {
	it("captures the incoming viewport, narrows to 320, then restores", async () => {
		const fake = createFake({ viewport: WIDE });

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(fake.setCalls[0]).toEqual({ width: 320, height: 1024 });
		expect(fake.setCalls.at(-1)).toEqual(WIDE);
		expect(fake.current()).toEqual(WIDE);
		expect(result.restored).toBe(true);
		expect(result.alreadyNarrow).toBe(false);
		expect(result.viewport).toEqual({ width: 320, height: 1024 });
	});

	it("restores the original viewport when evaluate throws", async () => {
		const fake = createFake({
			viewport: WIDE,
			throwOnMeasure: new Error("measure failed"),
		});

		await expect(runReflowAudit(fake.adaptor, OPTIONS)).rejects.toThrow("measure failed");

		expect(fake.setCalls.at(-1)).toEqual(WIDE);
		expect(fake.current()).toEqual(WIDE);
	});

	it("keeps a taller incoming height when narrowing", async () => {
		const fake = createFake({ viewport: { width: 1440, height: 1400 } });

		await runReflowAudit(fake.adaptor, OPTIONS);

		expect(fake.setCalls[0]).toEqual({ width: 320, height: 1400 });
	});
});

describe("runReflowAudit buckets", () => {
	it("passes when there is no overflow", async () => {
		const fake = createFake({ measure: emptyMeasure() });

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.bucket).toBe("pass");
		expect(result.documentOverflowPx).toBe(0);
		expect(result.offenders).toEqual([]);
		expect(result.unsettled).toBe(false);
	});

	it("violates when document overflow has a non-exempt offender", async () => {
		const fake = createFake({
			measure: emptyMeasure({
				documentOverflowPx: 80,
				offenders: [
					{
						selector: "#shell",
						html: '<div id="shell" style="width:1000px">',
						overflowPx: 80,
						reason: "element-overflow",
						rect: { x: 0, y: 0, width: 1000, height: 40 },
					},
				],
			}),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.bucket).toBe("violation");
		expect(result.documentOverflowPx).toBe(80);
		expect(result.offenders).toHaveLength(1);
		expect(result.offenders[0]?.selector).toBe("#shell");
		expect(result.offenders[0]?.reason).toBe("element-overflow");
		expect(result.offenders[0]?.screenshot).toEqual(new Uint8Array([1, 2, 3]));
	});

	it("does not flag overflow fully explained by a data table", async () => {
		const fake = createFake({
			measure: emptyMeasure({
				documentOverflowPx: 400,
				explainedByExempt: true,
			}),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.bucket).toBe("pass");
		expect(result.offenders).toEqual([]);
	});

	it("returns incomplete for the fixed-width-container heuristic", async () => {
		const fake = createFake({
			measure: emptyMeasure({
				documentOverflowPx: 40,
				offenders: [
					{
						selector: "#pinned",
						html: '<div id="pinned">',
						overflowPx: 680,
						reason: "fixed-width-container",
						rect: { x: 0, y: 0, width: 1000, height: 40 },
					},
				],
			}),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.bucket).toBe("incomplete");
		expect(result.offenders[0]?.reason).toBe("fixed-width-container");
	});

	it("returns incomplete for unattributed document overflow", async () => {
		const fake = createFake({
			measure: emptyMeasure({ documentOverflowPx: 80 }),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.bucket).toBe("incomplete");
	});

	it("returns incomplete for overflow in the scrollbar-gutter band", async () => {
		const fake = createFake({
			measure: emptyMeasure({ documentOverflowPx: 15 }),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.bucket).toBe("incomplete");
	});

	it("returns incomplete when layout never settles", async () => {
		const fake = createFake({
			fingerprints: [
				{
					scrollWidth: 400,
					clientWidth: 320,
					bodyScrollWidth: 400,
					bodyClientWidth: 320,
					childCount: 1,
				},
				{
					scrollWidth: 410,
					clientWidth: 320,
					bodyScrollWidth: 410,
					bodyClientWidth: 320,
					childCount: 1,
				},
				{
					scrollWidth: 420,
					clientWidth: 320,
					bodyScrollWidth: 420,
					bodyClientWidth: 320,
					childCount: 1,
				},
				{
					scrollWidth: 430,
					clientWidth: 320,
					bodyScrollWidth: 430,
					bodyClientWidth: 320,
					childCount: 1,
				},
			],
		});

		const result = await runReflowAudit(fake.adaptor, {
			...OPTIONS,
			settleAttempts: 3,
		});

		expect(result.unsettled).toBe(true);
		expect(result.bucket).toBe("incomplete");
	});

	it.each(["media-overflow", "clipped-content", "scrolling-container"] as const)(
		"returns incomplete for a %s offender even when a data table explains the overflow",
		async (reason) => {
			const fake = createFake({
				measure: emptyMeasure({
					documentOverflowPx: 400,
					explainedByExempt: true,
					offenders: [offender({ reason })],
				}),
			});

			const result = await runReflowAudit(fake.adaptor, OPTIONS);

			expect(result.bucket).toBe("incomplete");
		},
	);

	it("violates when text overflows and the document scrolls", async () => {
		const fake = createFake({
			measure: emptyMeasure({
				documentOverflowPx: 500,
				offenders: [offender({ reason: "text-overflow" })],
			}),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.bucket).toBe("violation");
	});

	it("returns incomplete when content is out of reach although nothing scrolls", async () => {
		const fake = createFake({
			measure: emptyMeasure({
				documentOverflowPx: 0,
				offenders: [offender({ reason: "clipped-content" })],
			}),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.bucket).toBe("incomplete");
	});

	it("keeps the offender's document rect on the result", async () => {
		const rect = { x: 12, y: 3400, width: 900, height: 48 };
		const fake = createFake({
			measure: emptyMeasure({ documentOverflowPx: 592, offenders: [offender({ rect })] }),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.offenders[0]?.rect).toEqual(rect);
	});

	it("suppresses a 1px overshoot via rounding tolerance", async () => {
		const fake = createFake({
			measure: emptyMeasure({ documentOverflowPx: 1 }),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.bucket).toBe("pass");
		expect(result.documentOverflowPx).toBe(1);
	});
});

describe("runReflowAudit settling", () => {
	const DESKTOP: LayoutFingerprint = { ...SETTLED, scrollWidth: 1000, bodyScrollWidth: 1000 };

	it("keeps reading until the layout has held still for the minimum window", async () => {
		// A debounced resize handler: the desktop layout holds still at first, then the narrow one
		// replaces it. Two equal readings are not enough to measure on.
		const fake = createFake({ fingerprints: [DESKTOP, DESKTOP, DESKTOP, SETTLED] });
		const started = Date.now();

		const result = await runReflowAudit(fake.adaptor, {
			settleDelayMs: 10,
			settleAttempts: 20,
			minSettleMs: 60,
		});

		expect(result.unsettled).toBe(false);
		expect(Date.now() - started).toBeGreaterThanOrEqual(60);
		// Three desktop readings, then narrow readings spanning at least the 60ms window.
		expect(fake.fingerprintReads()).toBeGreaterThanOrEqual(3 + 60 / 10);
	});

	it("lets a still layout finish its window after the attempts run out", async () => {
		const fake = createFake({ fingerprints: [SETTLED] });

		const result = await runReflowAudit(fake.adaptor, {
			settleDelayMs: 5,
			settleAttempts: 2,
			minSettleMs: 40,
		});

		expect(result.unsettled).toBe(false);
	});

	it("does not wait for the layout again after restoring the viewport", async () => {
		const fake = createFake({ viewport: WIDE });

		await runReflowAudit(fake.adaptor, OPTIONS);

		// Two equal readings before measuring and none after the restore.
		expect(fake.fingerprintReads()).toBe(2);
	});
});

describe("runReflowAudit already-narrow viewport", () => {
	it("measures in place without resizing when already 320px or narrower", async () => {
		const fake = createFake({ viewport: NARROW });

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(fake.setCalls).toEqual([]);
		expect(result.alreadyNarrow).toBe(true);
		expect(result.restored).toBe(true);
		expect(result.viewport).toEqual(NARROW);
		expect(result.bucket).toBe("pass");
	});
});

function offender(overrides: Partial<ReflowMeasureOffender> = {}): ReflowMeasureOffender {
	return {
		selector: overrides.selector ?? "#el",
		html: overrides.html ?? "<div id='el'>",
		overflowPx: overrides.overflowPx ?? 80,
		reason: overrides.reason ?? "element-overflow",
		rect: overrides.rect ?? { x: 0, y: 0, width: 1000, height: 40 },
		...(overrides.overflowing ? { overflowing: overrides.overflowing } : {}),
	};
}

describe("runReflowAudit screenshots", () => {
	it("captures a clipped screenshot for each offender while still at the narrow viewport", async () => {
		const fake = createFake({
			viewport: WIDE,
			measure: emptyMeasure({
				documentOverflowPx: 80,
				offenders: [offender({ rect: { x: 10, y: 20, width: 100, height: 30 } })],
			}),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.offenders[0]?.screenshot).toEqual(new Uint8Array([1, 2, 3]));
		expect(fake.screenshotCalls).toHaveLength(1);
		// Always the full 320px measurement viewport, starting at x=0, so an offender that extends past
		// the edge is visibly cut off there. Vertically buffered by the default 10px clip, clamped to
		// the 1024px-tall page.
		expect(fake.screenshotCalls[0]?.clip).toEqual({
			x: 0,
			y: 10,
			width: 320,
			height: 50,
		});
		// The clip was captured before the finally block restored the wide viewport.
		expect(fake.screenshotCalls[0]?.viewportWidthAtCall).toBe(320);
	});

	it("captures at the adaptor's screenshotClipScale, independent of the page's own scale factor", async () => {
		const fake = createFake({
			viewport: WIDE,
			screenshotClipScale: 2,
			measure: emptyMeasure({
				documentOverflowPx: 80,
				offenders: [offender({ rect: { x: 10, y: 20, width: 100, height: 30 } })],
			}),
		});

		await runReflowAudit(fake.adaptor, OPTIONS);

		expect(fake.screenshotCalls[0]?.scale).toBe(2);
	});

	it("defaults to scale 1 when the adaptor doesn't declare screenshotClipScale", async () => {
		const fake = createFake({
			viewport: WIDE,
			measure: emptyMeasure({
				documentOverflowPx: 80,
				offenders: [offender({ rect: { x: 10, y: 20, width: 100, height: 30 } })],
			}),
		});

		await runReflowAudit(fake.adaptor, OPTIONS);

		expect(fake.screenshotCalls[0]?.scale).toBe(1);
	});

	it("cuts the clip off at the viewport edge instead of widening to fit an offender that overflows it", async () => {
		const fake = createFake({
			viewport: WIDE,
			measure: emptyMeasure({
				documentOverflowPx: 80,
				offenders: [offender({ rect: { x: 250, y: 0, width: 150, height: 20 } })],
			}),
		});

		await runReflowAudit(fake.adaptor, OPTIONS);

		expect(fake.screenshotCalls[0]?.clip).toEqual({
			x: 0,
			y: 0,
			width: 320,
			height: 30,
		});
	});

	it("widens the clip to reach an offender that starts beyond the viewport", async () => {
		const fake = createFake({
			viewport: WIDE,
			pageDimensions: { width: 800, height: 1024 },
			measure: emptyMeasure({
				documentOverflowPx: 480,
				offenders: [offender({ rect: { x: 500, y: 40, width: 300, height: 60 } })],
			}),
		});

		await runReflowAudit(fake.adaptor, OPTIONS);

		expect(fake.screenshotCalls[0]?.clip).toEqual({ x: 0, y: 30, width: 800, height: 80 });
	});

	it("caps a widened clip at 1280px", async () => {
		const fake = createFake({
			viewport: WIDE,
			pageDimensions: { width: 5000, height: 1024 },
			measure: emptyMeasure({
				documentOverflowPx: 4680,
				offenders: [offender({ rect: { x: 4000, y: 0, width: 1000, height: 20 } })],
			}),
		});

		await runReflowAudit(fake.adaptor, OPTIONS);

		expect(fake.screenshotCalls[0]?.clip.width).toBe(1280);
	});

	it("reaches leftwards for a right-to-left offender wholly beyond the viewport, scrolled there for the capture", async () => {
		const fake = createFake({
			viewport: WIDE,
			pageDimensions: { width: 920, height: 1024 },
			measure: emptyMeasure({
				documentOverflowPx: 600,
				offenders: [offender({ rect: { x: -600, y: 40, width: 200, height: 60 } })],
			}),
		});

		await runReflowAudit(fake.adaptor, OPTIONS);

		expect(fake.screenshotCalls).toHaveLength(1);
		expect(fake.screenshotCalls[0]?.clip).toEqual({ x: -600, y: 30, width: 920, height: 80 });
		// Scrolled to the clip's edge while capturing, at the same vertical position, then put back.
		expect(fake.screenshotCalls[0]?.scrollAtCall).toEqual({ x: -600, y: 700 });
		expect(fake.scroll()).toEqual({ x: 0, y: 700 });
	});

	it("does not reach further left than the page scrolls or than 1280px in all", async () => {
		const fake = createFake({
			viewport: WIDE,
			pageDimensions: { width: 5000, height: 1024 },
			measure: emptyMeasure({
				documentOverflowPx: 4680,
				offenders: [offender({ rect: { x: -4680, y: 0, width: 1000, height: 20 } })],
			}),
		});

		await runReflowAudit(fake.adaptor, OPTIONS);

		expect(fake.screenshotCalls[0]?.clip).toMatchObject({ x: -960, width: 1280 });
	});

	it("keeps the ordinary clip for a right-to-left offender that still shows in the viewport", async () => {
		const fake = createFake({
			viewport: WIDE,
			pageDimensions: { width: 1000, height: 1024 },
			measure: emptyMeasure({
				documentOverflowPx: 680,
				offenders: [offender({ rect: { x: -680, y: 0, width: 1000, height: 20 } })],
			}),
		});

		await runReflowAudit(fake.adaptor, OPTIONS);

		expect(fake.screenshotCalls[0]?.clip).toEqual({ x: 0, y: 0, width: 320, height: 30 });
		expect(fake.screenshotCalls[0]?.scrollAtCall).toEqual({ x: 0, y: 700 });
	});

	it("falls back to the viewport-wide clip when the engine refuses one left of the origin", async () => {
		const fake = createFake({
			viewport: WIDE,
			pageDimensions: { width: 920, height: 1024 },
			rejectNegativeClips: true,
			measure: emptyMeasure({
				documentOverflowPx: 600,
				offenders: [offender({ rect: { x: -600, y: 40, width: 200, height: 60 } })],
			}),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(fake.screenshotCalls.map((call) => call.clip)).toEqual([
			{ x: -600, y: 30, width: 920, height: 80 },
			{ x: 0, y: 30, width: 320, height: 80 },
		]);
		// The fallback is taken with the scroll position already restored.
		expect(fake.screenshotCalls[1]?.scrollAtCall).toEqual({ x: 0, y: 700 });
		expect(result.offenders[0]?.screenshot).toBeInstanceOf(Uint8Array);
	});

	it("carries what overflows a scrolling container, with its markup truncated", async () => {
		const longClass = "x".repeat(400);
		const fake = createFake({
			measure: emptyMeasure({
				offenders: [
					offender({
						selector: "#root",
						reason: "scrolling-container",
						overflowPx: 280,
						overflowing: [
							{
								selector: "#hero",
								html: `<div id="hero" class="${longClass}">`,
								overflowPx: 280,
								rect: { x: 0, y: 20, width: 600, height: 120 },
							},
						],
					}),
				],
			}),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);
		const overflowing = result.offenders[0]?.overflowing;

		expect(overflowing).toHaveLength(1);
		expect(overflowing?.[0]).toMatchObject({
			selector: "#hero",
			overflowPx: 280,
			rect: { x: 0, y: 20, width: 600, height: 120 },
		});
		expect(overflowing?.[0]?.html.length).toBeLessThan(400);
	});

	it("leaves overflowing off offenders that have none", async () => {
		const fake = createFake({
			measure: emptyMeasure({ documentOverflowPx: 80, offenders: [offender()] }),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.offenders[0]).not.toHaveProperty("overflowing");
	});

	it(`omits screenshots past screenshotLimit (${DEFAULT_SCREENSHOT_LIMIT}) but keeps every offender`, async () => {
		const offenders = Array.from({ length: DEFAULT_SCREENSHOT_LIMIT + 2 }, (_, i) =>
			offender({ selector: `#el-${i}` }),
		);
		const fake = createFake({
			measure: emptyMeasure({ documentOverflowPx: 80, offenders }),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.offenders).toHaveLength(DEFAULT_SCREENSHOT_LIMIT + 2);
		expect(fake.screenshotCalls).toHaveLength(DEFAULT_SCREENSHOT_LIMIT);
		expect(result.offenders.slice(0, DEFAULT_SCREENSHOT_LIMIT).every((o) => o.screenshot)).toBe(
			true,
		);
		expect(
			result.offenders.slice(DEFAULT_SCREENSHOT_LIMIT).every((o) => o.screenshot === undefined),
		).toBe(true);
	});

	it("takes no screenshots when there are no offenders", async () => {
		const fake = createFake({ measure: emptyMeasure() });

		await runReflowAudit(fake.adaptor, OPTIONS);

		expect(fake.screenshotCalls).toHaveLength(0);
	});
});
