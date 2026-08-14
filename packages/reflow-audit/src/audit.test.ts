import { describe, expect, it } from "vitest";
import type { ReflowAuditAdaptor } from "./adaptor";
import { runReflowAudit } from "./audit";
import {
	type LayoutFingerprint,
	measureReflowScript,
	type ReflowMeasure,
	readLayoutFingerprintScript,
} from "./browser-scripts";

const WIDE = { width: 1280, height: 800 };
const NARROW = { width: 320, height: 800 };
const SETTLED: LayoutFingerprint = {
	scrollWidth: 320,
	clientWidth: 320,
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
}): {
	adaptor: ReflowAuditAdaptor;
	setCalls: Array<{ width: number; height: number }>;
	current: () => { width: number; height: number };
} {
	let viewport = { ...(opts.viewport ?? WIDE) };
	const setCalls: Array<{ width: number; height: number }> = [];
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

			throw new Error(`unexpected evaluate: ${fn.name}`);
		},
	};

	return { adaptor, setCalls, current: () => viewport };
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
				{ scrollWidth: 400, clientWidth: 320, childCount: 1 },
				{ scrollWidth: 410, clientWidth: 320, childCount: 1 },
				{ scrollWidth: 420, clientWidth: 320, childCount: 1 },
				{ scrollWidth: 430, clientWidth: 320, childCount: 1 },
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
