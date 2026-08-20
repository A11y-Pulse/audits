import { describe, expect, it } from "vitest";
import type { TextSpacingAuditAdaptor } from "./adaptor";
import {
	type CandidateSnapshot,
	classifyTextSpacing,
	DEFAULT_CANDIDATE_LIMIT,
	runTextSpacingAudit,
} from "./audit";

const TOLERANCE = 2;

function rect(
	x: number,
	y: number,
	width: number,
	height: number,
): CandidateSnapshot["rect"] {
	return { x, y, width, height };
}

function snapshot(
	overrides: Partial<CandidateSnapshot> &
		Pick<CandidateSnapshot, "index" | "selector">,
): CandidateSnapshot {
	return {
		html: overrides.html ?? "<p>",
		scrollWidth: overrides.scrollWidth ?? 100,
		scrollHeight: overrides.scrollHeight ?? 20,
		clientWidth: overrides.clientWidth ?? 100,
		clientHeight: overrides.clientHeight ?? 20,
		rect: overrides.rect ?? rect(0, 0, 100, 20),
		overflowX: overrides.overflowX ?? "visible",
		overflowY: overrides.overflowY ?? "visible",
		clipScrollWidth: overrides.clipScrollWidth ?? overrides.scrollWidth ?? 100,
		clipScrollHeight:
			overrides.clipScrollHeight ?? overrides.scrollHeight ?? 20,
		clipClientWidth: overrides.clipClientWidth ?? overrides.clientWidth ?? 100,
		clipClientHeight:
			overrides.clipClientHeight ?? overrides.clientHeight ?? 20,
		clipOverflowX: overrides.clipOverflowX ?? overrides.overflowX ?? "visible",
		clipOverflowY: overrides.clipOverflowY ?? overrides.overflowY ?? "visible",
		truncated: overrides.truncated ?? false,
		unstable: overrides.unstable ?? false,
		fontSize: overrides.fontSize ?? 16,
		position: overrides.position ?? "static",
		...overrides,
	};
}

describe("classifyTextSpacing", () => {
	it("returns no findings when metrics are unchanged", () => {
		const before = [
			snapshot({
				index: 0,
				selector: "#card",
				clipOverflowY: "hidden",
			}),
		];

		expect(
			classifyTextSpacing(before, before, { clipTolerancePx: TOLERANCE }),
		).toEqual([]);
	});

	it("ignores growth without a clipping context", () => {
		const before = [
			snapshot({
				index: 0,
				selector: "#flow",
				scrollHeight: 20,
				clientHeight: 20,
				clipScrollHeight: 20,
				clipClientHeight: 20,
			}),
		];
		const after = [
			snapshot({
				index: 0,
				selector: "#flow",
				scrollHeight: 80,
				clientHeight: 80,
				clipScrollHeight: 80,
				clipClientHeight: 80,
				rect: rect(0, 0, 100, 80),
			}),
		];

		expect(
			classifyTextSpacing(before, after, { clipTolerancePx: TOLERANCE }),
		).toEqual([]);
	});

	it("flags clipped when overflow appears inside overflow hidden beyond tolerance", () => {
		const before = [
			snapshot({
				index: 0,
				selector: "#card",
				html: '<div id="card">',
				scrollHeight: 40,
				clientHeight: 40,
				clipScrollHeight: 40,
				clipClientHeight: 40,
				clipOverflowY: "hidden",
				overflowY: "hidden",
			}),
		];
		const after = [
			snapshot({
				index: 0,
				selector: "#card",
				html: '<div id="card">',
				scrollHeight: 54,
				clientHeight: 40,
				clipScrollHeight: 54,
				clipClientHeight: 40,
				clipOverflowY: "hidden",
				overflowY: "hidden",
			}),
		];

		expect(
			classifyTextSpacing(before, after, { clipTolerancePx: TOLERANCE }),
		).toEqual([
			{
				selector: "#card",
				html: '<div id="card">',
				kind: "clipped",
				metrics: { beforeOverflowPx: 0, afterOverflowPx: 14 },
			},
		]);
	});

	it("does not flag overflow within the clip tolerance", () => {
		const before = [
			snapshot({
				index: 0,
				selector: "#card",
				clipOverflowY: "hidden",
				overflowY: "hidden",
				scrollHeight: 40,
				clientHeight: 40,
				clipScrollHeight: 40,
				clipClientHeight: 40,
			}),
		];
		const after = [
			snapshot({
				index: 0,
				selector: "#card",
				clipOverflowY: "hidden",
				overflowY: "hidden",
				scrollHeight: 42,
				clientHeight: 40,
				clipScrollHeight: 42,
				clipClientHeight: 40,
			}),
		];

		expect(
			classifyTextSpacing(before, after, { clipTolerancePx: TOLERANCE }),
		).toEqual([]);
	});

	it("flags overflow clip the same way as overflow hidden", () => {
		const before = [
			snapshot({
				index: 0,
				selector: "#clip",
				clipOverflowX: "clip",
				overflowX: "clip",
			}),
		];
		const after = [
			snapshot({
				index: 0,
				selector: "#clip",
				clipOverflowX: "clip",
				overflowX: "clip",
				scrollWidth: 140,
				clientWidth: 100,
				clipScrollWidth: 140,
				clipClientWidth: 100,
			}),
		];

		expect(
			classifyTextSpacing(before, after, { clipTolerancePx: TOLERANCE })[0],
		).toMatchObject({
			kind: "clipped",
			metrics: { beforeOverflowPx: 0, afterOverflowPx: 40 },
		});
	});

	it("does not flag clipped when the clip box already overflowed at baseline", () => {
		const before = [
			snapshot({
				index: 0,
				selector: "#card",
				clipOverflowY: "hidden",
				overflowY: "hidden",
				scrollHeight: 50,
				clientHeight: 40,
				clipScrollHeight: 50,
				clipClientHeight: 40,
			}),
		];
		const after = [
			snapshot({
				index: 0,
				selector: "#card",
				clipOverflowY: "hidden",
				overflowY: "hidden",
				scrollHeight: 80,
				clientHeight: 40,
				clipScrollHeight: 80,
				clipClientHeight: 40,
			}),
		];

		expect(
			classifyTextSpacing(before, after, { clipTolerancePx: TOLERANCE }),
		).toEqual([]);
	});

	it("routes baseline-truncated growth to truncation-increased, never clipped", () => {
		const before = [
			snapshot({
				index: 0,
				selector: "#title",
				html: '<p id="title">',
				truncated: true,
				overflowX: "hidden",
				clipOverflowX: "hidden",
				scrollWidth: 120,
				clientWidth: 100,
				clipScrollWidth: 120,
				clipClientWidth: 100,
			}),
		];
		const after = [
			snapshot({
				index: 0,
				selector: "#title",
				html: '<p id="title">',
				truncated: true,
				overflowX: "hidden",
				clipOverflowX: "hidden",
				scrollWidth: 160,
				clientWidth: 100,
				clipScrollWidth: 160,
				clipClientWidth: 100,
			}),
		];

		expect(
			classifyTextSpacing(before, after, { clipTolerancePx: TOLERANCE }),
		).toEqual([
			{
				selector: "#title",
				html: '<p id="title">',
				kind: "truncation-increased",
				metrics: { beforeOverflowPx: 20, afterOverflowPx: 60 },
			},
		]);
	});

	it("does not flag truncation that stays within tolerance", () => {
		const before = [
			snapshot({
				index: 0,
				selector: "#title",
				truncated: true,
				overflowX: "hidden",
				clipOverflowX: "hidden",
				scrollWidth: 120,
				clientWidth: 100,
				clipScrollWidth: 120,
				clipClientWidth: 100,
			}),
		];
		const after = [
			snapshot({
				index: 0,
				selector: "#title",
				truncated: true,
				overflowX: "hidden",
				clipOverflowX: "hidden",
				scrollWidth: 122,
				clientWidth: 100,
				clipScrollWidth: 122,
				clipClientWidth: 100,
			}),
		];

		expect(
			classifyTextSpacing(before, after, { clipTolerancePx: TOLERANCE }),
		).toEqual([]);
	});

	it("flags overlap with the counterpart selector when nearby rects newly intersect", () => {
		const before = [
			snapshot({
				index: 0,
				selector: "#a",
				html: '<p id="a">',
				rect: rect(0, 0, 100, 20),
				fontSize: 16,
			}),
			snapshot({
				index: 1,
				selector: "#b",
				html: '<p id="b">',
				rect: rect(0, 24, 100, 20),
				fontSize: 16,
			}),
		];
		const after = [
			snapshot({
				index: 0,
				selector: "#a",
				html: '<p id="a">',
				rect: rect(0, 0, 100, 28),
				fontSize: 16,
			}),
			snapshot({
				index: 1,
				selector: "#b",
				html: '<p id="b">',
				rect: rect(0, 20, 100, 28),
				fontSize: 16,
			}),
		];

		expect(
			classifyTextSpacing(before, after, { clipTolerancePx: TOLERANCE }),
		).toEqual([
			{
				selector: "#a",
				html: '<p id="a">',
				kind: "overlap",
				metrics: { beforeOverflowPx: 0, afterOverflowPx: 0 },
				overlapsWith: "#b",
			},
		]);
	});

	it("does not flag overlap for sticky or fixed elements", () => {
		const before = [
			snapshot({
				index: 0,
				selector: "#header",
				position: "fixed",
				rect: rect(0, 0, 200, 40),
			}),
			snapshot({
				index: 1,
				selector: "#body",
				rect: rect(0, 48, 200, 40),
			}),
		];
		const after = [
			snapshot({
				index: 0,
				selector: "#header",
				position: "fixed",
				rect: rect(0, 0, 200, 40),
			}),
			snapshot({
				index: 1,
				selector: "#body",
				rect: rect(0, 20, 200, 40),
			}),
		];

		expect(
			classifyTextSpacing(before, after, { clipTolerancePx: TOLERANCE }),
		).toEqual([]);
	});

	it("does not compare pairs whose baseline vertical gap exceeds one line box", () => {
		const before = [
			snapshot({
				index: 0,
				selector: "#a",
				rect: rect(0, 0, 100, 20),
				fontSize: 16,
			}),
			snapshot({
				index: 1,
				selector: "#b",
				rect: rect(0, 80, 100, 20),
				fontSize: 16,
			}),
		];
		const after = [
			snapshot({
				index: 0,
				selector: "#a",
				rect: rect(0, 0, 100, 90),
				fontSize: 16,
			}),
			snapshot({
				index: 1,
				selector: "#b",
				rect: rect(0, 80, 100, 20),
				fontSize: 16,
			}),
		];

		expect(
			classifyTextSpacing(before, after, { clipTolerancePx: TOLERANCE }),
		).toEqual([]);
	});

	it("excludes unstable candidates from every finding kind", () => {
		const before = [
			snapshot({
				index: 0,
				selector: "#marquee",
				unstable: true,
				clipOverflowY: "hidden",
				overflowY: "hidden",
			}),
			snapshot({
				index: 1,
				selector: "#stable",
				rect: rect(0, 0, 100, 20),
			}),
		];
		const after = [
			snapshot({
				index: 0,
				selector: "#marquee",
				unstable: true,
				clipOverflowY: "hidden",
				overflowY: "hidden",
				scrollHeight: 80,
				clientHeight: 20,
				clipScrollHeight: 80,
				clipClientHeight: 20,
			}),
			snapshot({
				index: 1,
				selector: "#stable",
				rect: rect(0, 10, 100, 20),
			}),
		];

		expect(
			classifyTextSpacing(before, after, { clipTolerancePx: TOLERANCE }),
		).toEqual([]);
	});
});

type ScriptedPage = {
	baseline: { candidates: CandidateSnapshot[] };
	after: { candidates: CandidateSnapshot[] };
	restore: { restored: boolean };
	throwOnRestore?: Error;
};

function scriptedAdaptor(page: ScriptedPage): TextSpacingAuditAdaptor & {
	calls: string[];
} {
	const calls: string[] = [];

	return {
		calls,
		evaluate: async <T>(
			fn: (...args: never[]) => T | Promise<T>,
			..._args: unknown[]
		): Promise<T> => {
			calls.push(fn.name);

			if (fn.name === "collectBaselineScript") {
				return page.baseline as T;
			}

			if (fn.name === "injectOverrideScript") {
				return undefined as T;
			}

			if (fn.name === "waitTwoFramesScript") {
				return undefined as T;
			}

			if (fn.name === "remeasureScript") {
				return page.after as T;
			}

			if (fn.name === "restoreAndVerifyScript") {
				if (page.throwOnRestore) {
					throw page.throwOnRestore;
				}

				return page.restore as T;
			}

			throw new Error(`unexpected evaluate: ${fn.name}`);
		},
	};
}

describe("runTextSpacingAudit", () => {
	it("defaults candidateLimit to 500", () => {
		expect(DEFAULT_CANDIDATE_LIMIT).toBe(500);
	});

	it("reports restored true when restore verification succeeds", async () => {
		const adaptor = scriptedAdaptor({
			baseline: { candidates: [] },
			after: { candidates: [] },
			restore: { restored: true },
		});

		const result = await runTextSpacingAudit(adaptor, { settleMs: 0 });

		expect(result.restored).toBe(true);
		expect(result.candidateCount).toBe(0);
		expect(result.findings).toEqual([]);
		expect(adaptor.calls).toContain("restoreAndVerifyScript");
	});

	it("reports restored false without throwing when restore verification fails", async () => {
		const adaptor = scriptedAdaptor({
			baseline: { candidates: [] },
			after: { candidates: [] },
			restore: { restored: false },
		});

		await expect(
			runTextSpacingAudit(adaptor, { settleMs: 0 }),
		).resolves.toMatchObject({ restored: false });
	});

	it("reports restored false without throwing when restore itself throws", async () => {
		const adaptor = scriptedAdaptor({
			baseline: { candidates: [] },
			after: { candidates: [] },
			restore: { restored: true },
			throwOnRestore: new Error("boom"),
		});

		await expect(
			runTextSpacingAudit(adaptor, { settleMs: 0 }),
		).resolves.toMatchObject({ restored: false });
	});

	it("restores injected styles even when remeasure throws", async () => {
		const calls: string[] = [];
		const adaptor: TextSpacingAuditAdaptor = {
			evaluate: async <T>(
				fn: (...args: never[]) => T | Promise<T>,
			): Promise<T> => {
				calls.push(fn.name);

				if (fn.name === "collectBaselineScript") {
					return { candidates: [] } as T;
				}

				if (fn.name === "remeasureScript") {
					throw new Error("remeasure failed");
				}

				if (fn.name === "restoreAndVerifyScript") {
					return { restored: true } as T;
				}

				return undefined as T;
			},
		};

		await expect(runTextSpacingAudit(adaptor, { settleMs: 0 })).rejects.toThrow(
			"remeasure failed",
		);
		expect(calls).toContain("restoreAndVerifyScript");
	});

	it("counts only stable candidates toward candidateCount", async () => {
		const candidates = [
			snapshot({ index: 0, selector: "#a", unstable: true }),
			snapshot({ index: 1, selector: "#b" }),
			snapshot({ index: 2, selector: "#c" }),
		];
		const adaptor = scriptedAdaptor({
			baseline: { candidates },
			after: { candidates },
			restore: { restored: true },
		});

		const result = await runTextSpacingAudit(adaptor, { settleMs: 0 });

		expect(result.candidateCount).toBe(2);
	});

	it("passes candidateLimit through to the baseline script", async () => {
		let received: unknown;
		const adaptor: TextSpacingAuditAdaptor = {
			evaluate: async <T>(
				fn: (...args: never[]) => T | Promise<T>,
				...args: unknown[]
			): Promise<T> => {
				if (fn.name === "collectBaselineScript") {
					received = args[0];

					return { candidates: [] } as T;
				}

				if (fn.name === "remeasureScript") {
					return { candidates: [] } as T;
				}

				if (fn.name === "restoreAndVerifyScript") {
					return { restored: true } as T;
				}

				return undefined as T;
			},
		};

		await runTextSpacingAudit(adaptor, { candidateLimit: 7, settleMs: 0 });

		expect(received).toBe(7);
	});

	it("summarises clipped, truncation-increased, and overlap findings", async () => {
		const before = [
			snapshot({
				index: 0,
				selector: "#clip",
				html: "<div>",
				overflowY: "hidden",
				clipOverflowY: "hidden",
				rect: rect(400, 0, 100, 20),
			}),
			snapshot({
				index: 1,
				selector: "#ellip",
				html: "<p>",
				truncated: true,
				overflowX: "hidden",
				clipOverflowX: "hidden",
				scrollWidth: 120,
				clientWidth: 100,
				clipScrollWidth: 120,
				clipClientWidth: 100,
				rect: rect(400, 80, 100, 20),
			}),
			snapshot({
				index: 2,
				selector: "#a",
				html: "<span>",
				rect: rect(0, 0, 50, 16),
			}),
			snapshot({
				index: 3,
				selector: "#b",
				html: "<span>",
				rect: rect(0, 20, 50, 16),
			}),
		];
		const after = [
			snapshot({
				index: 0,
				selector: "#clip",
				html: "<div>",
				overflowY: "hidden",
				clipOverflowY: "hidden",
				scrollHeight: 40,
				clientHeight: 20,
				clipScrollHeight: 40,
				clipClientHeight: 20,
				rect: rect(400, 0, 100, 20),
			}),
			snapshot({
				index: 1,
				selector: "#ellip",
				html: "<p>",
				truncated: true,
				overflowX: "hidden",
				clipOverflowX: "hidden",
				scrollWidth: 150,
				clientWidth: 100,
				clipScrollWidth: 150,
				clipClientWidth: 100,
				rect: rect(400, 80, 100, 20),
			}),
			snapshot({
				index: 2,
				selector: "#a",
				html: "<span>",
				rect: rect(0, 0, 50, 24),
			}),
			snapshot({
				index: 3,
				selector: "#b",
				html: "<span>",
				rect: rect(0, 16, 50, 24),
			}),
		];
		const adaptor = scriptedAdaptor({
			baseline: { candidates: before },
			after: { candidates: after },
			restore: { restored: true },
		});

		const result = await runTextSpacingAudit(adaptor, { settleMs: 0 });

		expect(result.summary).toEqual({
			clipped: 1,
			truncationIncreased: 1,
			overlaps: 1,
		});
		expect(result.findings.map((finding) => finding.kind)).toEqual([
			"clipped",
			"truncation-increased",
			"overlap",
		]);
	});
});
