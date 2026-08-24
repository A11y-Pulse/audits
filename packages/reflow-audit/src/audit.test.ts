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

const OPTIONS = { settleDelayMs: 0, settleAttempts: 4 };

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
}): {
	adaptor: ReflowAuditAdaptor;
	setCalls: Array<{ width: number; height: number }>;
	current: () => { width: number; height: number };
	screenshotCalls: Array<{
		clip: { x: number; y: number; width: number; height: number };
		scale: number;
		viewportWidthAtCall: number;
	}>;
} {
	let viewport = { ...(opts.viewport ?? WIDE) };
	const setCalls: Array<{ width: number; height: number }> = [];
	const screenshotCalls: Array<{
		clip: { x: number; y: number; width: number; height: number };
		scale: number;
		viewportWidthAtCall: number;
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
		): Promise<T> => {
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
				return { width: 320, height: 1024 } as T;
			}

			throw new Error(`unexpected evaluate: ${fn.name}`);
		},
		screenshotClip: async (clip, scale = 1) => {
			screenshotCalls.push({ clip, scale, viewportWidthAtCall: viewport.width });
			return new Uint8Array([1, 2, 3]);
		},
		screenshotClipScale: opts.screenshotClipScale,
	};

	return { adaptor, setCalls, current: () => viewport, screenshotCalls };
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

		await expect(runReflowAudit(fake.adaptor, OPTIONS)).rejects.toThrow(
			"measure failed",
		);

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

	it("suppresses a 1px overshoot via rounding tolerance", async () => {
		const fake = createFake({
			measure: emptyMeasure({ documentOverflowPx: 1 }),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.bucket).toBe("pass");
		expect(result.documentOverflowPx).toBe(1);
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

function offender(
	overrides: Partial<ReflowMeasureOffender> = {},
): ReflowMeasureOffender {
	return {
		selector: overrides.selector ?? "#el",
		html: overrides.html ?? "<div id='el'>",
		overflowPx: overrides.overflowPx ?? 80,
		reason: overrides.reason ?? "element-overflow",
		rect: overrides.rect ?? { x: 0, y: 0, width: 1000, height: 40 },
	};
}

describe("runReflowAudit screenshots", () => {
	it("captures a clipped screenshot for each offender while still at the narrow viewport", async () => {
		const fake = createFake({
			viewport: WIDE,
			measure: emptyMeasure({
				documentOverflowPx: 80,
				offenders: [
					offender({ rect: { x: 10, y: 20, width: 100, height: 30 } }),
				],
			}),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.offenders[0]?.screenshot).toEqual(new Uint8Array([1, 2, 3]));
		expect(fake.screenshotCalls).toHaveLength(1);
		// Always the full 320px measurement viewport, starting at x=0, so an
		// offender that extends past the edge is visibly cut off there. Vertically
		// buffered by the default 10px clip, clamped to the 1024px-tall page.
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
				offenders: [
					offender({ rect: { x: 10, y: 20, width: 100, height: 30 } }),
				],
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
				offenders: [
					offender({ rect: { x: 10, y: 20, width: 100, height: 30 } }),
				],
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
				offenders: [
					offender({ rect: { x: 250, y: 0, width: 150, height: 20 } }),
				],
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

	it(`omits screenshots past screenshotLimit (${DEFAULT_SCREENSHOT_LIMIT}) but keeps every offender`, async () => {
		const offenders = Array.from(
			{ length: DEFAULT_SCREENSHOT_LIMIT + 2 },
			(_, i) => offender({ selector: `#el-${i}` }),
		);
		const fake = createFake({
			measure: emptyMeasure({ documentOverflowPx: 80, offenders }),
		});

		const result = await runReflowAudit(fake.adaptor, OPTIONS);

		expect(result.offenders).toHaveLength(DEFAULT_SCREENSHOT_LIMIT + 2);
		expect(fake.screenshotCalls).toHaveLength(DEFAULT_SCREENSHOT_LIMIT);
		expect(
			result.offenders
				.slice(0, DEFAULT_SCREENSHOT_LIMIT)
				.every((o) => o.screenshot),
		).toBe(true);
		expect(
			result.offenders
				.slice(DEFAULT_SCREENSHOT_LIMIT)
				.every((o) => o.screenshot === undefined),
		).toBe(true);
	});

	it("takes no screenshots when there are no offenders", async () => {
		const fake = createFake({ measure: emptyMeasure() });

		await runReflowAudit(fake.adaptor, OPTIONS);

		expect(fake.screenshotCalls).toHaveLength(0);
	});
});
