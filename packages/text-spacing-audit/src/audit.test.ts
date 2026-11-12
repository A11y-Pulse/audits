import { describe, expect, it } from "vitest";
import type { TextSpacingAuditAdaptor } from "./adaptor";
import {
	type CandidateSnapshot,
	classifyCandidates,
	classifyTextSpacing,
	DEFAULT_SCREENSHOT_LIMIT,
	runTextSpacingAudit,
} from "./audit";
import type {
	BaselineConfig,
	DescribePayload,
	DescribeRequest,
	ElementDescription,
} from "./browser-scripts";

const TOLERANCE = 2;

type Rect = CandidateSnapshot["rect"];

function rect(x: number, y: number, width: number, height: number): Rect {
	return { x, y, width, height };
}

function snapshot(
	overrides: Partial<CandidateSnapshot> & Pick<CandidateSnapshot, "index">,
): CandidateSnapshot {
	const box = overrides.rect ?? rect(0, overrides.index * 100, 100, 20);

	return {
		selector: "",
		html: "",
		scrollWidth: 100,
		scrollHeight: 20,
		clientWidth: 100,
		clientHeight: 20,
		rect: box,
		overflowX: "visible",
		overflowY: "visible",
		clipScrollWidth: 100,
		clipScrollHeight: 20,
		clipClientWidth: 100,
		clipClientHeight: 20,
		clipOverflowX: "visible",
		clipOverflowY: "visible",
		truncated: false,
		unstable: false,
		fontSize: 16,
		position: "static",
		textRects: [box],
		clippedXPx: 0,
		clippedYPx: 0,
		clipperXIndex: null,
		clipperYIndex: null,
		truncatorIndex: null,
		truncationOverflowPx: 0,
		...overrides,
	};
}

/** The same candidate before and after, differing only in what `after` overrides. */
function pair(
	before: Partial<CandidateSnapshot> & Pick<CandidateSnapshot, "index">,
	after: Partial<CandidateSnapshot>,
): { before: CandidateSnapshot; after: CandidateSnapshot } {
	const first = snapshot(before);

	return { before: first, after: { ...first, ...after } };
}

function classify(pairs: Array<{ before: CandidateSnapshot; after: CandidateSnapshot }>) {
	return classifyCandidates(
		pairs.map((entry) => entry.before),
		pairs.map((entry) => entry.after),
		{ clipTolerancePx: TOLERANCE },
	);
}

describe("classifyCandidates: clipped", () => {
	it("returns no findings when nothing changed", () => {
		expect(classify([pair({ index: 0, clipperYIndex: 0 }, {})])).toEqual([]);
	});

	it("ignores growth that no ancestor cuts off", () => {
		expect(classify([pair({ index: 0 }, { rect: rect(0, 0, 100, 80) })])).toEqual([]);
	});

	it("flags text that newly extends past its clipping box, with the axis and the clipper", () => {
		expect(
			classify([pair({ index: 3, clipperYIndex: 7 }, { clippedYPx: 14, clipperYIndex: 7 })]),
		).toEqual([
			{
				kind: "clipped",
				index: 3,
				clipperIndex: 7,
				otherIndex: null,
				axis: "vertical",
				affectedCount: 1,
				metrics: { beforeOverflowPx: 0, afterOverflowPx: 14 },
			},
		]);
	});

	it("does not flag overflow within the clip tolerance", () => {
		expect(classify([pair({ index: 0, clipperYIndex: 0 }, { clippedYPx: 2 })])).toEqual([]);
	});

	it("reports horizontal clipping against the element clipping that axis", () => {
		const [finding] = classify([
			pair({ index: 0, clipperXIndex: 1, clipperYIndex: 2 }, { clippedXPx: 40 }),
		]);

		expect(finding).toMatchObject({
			axis: "horizontal",
			clipperIndex: 1,
			metrics: { beforeOverflowPx: 0, afterOverflowPx: 40 },
		});
	});

	it("reports both axes, measured on the one that loses more", () => {
		const [finding] = classify([
			pair({ index: 0, clipperXIndex: 1, clipperYIndex: 2 }, { clippedXPx: 10, clippedYPx: 30 }),
		]);

		expect(finding).toMatchObject({
			axis: "both",
			clipperIndex: 2,
			metrics: { beforeOverflowPx: 0, afterOverflowPx: 30 },
		});
	});

	it("does not flag text that was already cut off at baseline", () => {
		expect(
			classify([pair({ index: 0, clipperYIndex: 0, clippedYPx: 10 }, { clippedYPx: 40 })]),
		).toEqual([]);
	});

	it("reports text cut off by the same element once, against the text that loses the most", () => {
		const findings = classify([
			// Still fully visible: not part of the finding.
			pair({ index: 0, clipperYIndex: 5 }, {}),
			pair({ index: 1, clipperYIndex: 5 }, { clippedYPx: 20 }),
			pair({ index: 2, clipperYIndex: 5 }, { clippedYPx: 76 }),
			pair({ index: 3, clipperYIndex: 5 }, { clippedYPx: 48 }),
		]);

		expect(findings).toEqual([
			{
				kind: "clipped",
				index: 2,
				clipperIndex: 5,
				otherIndex: null,
				axis: "vertical",
				affectedCount: 3,
				metrics: { beforeOverflowPx: 0, afterOverflowPx: 76 },
			},
		]);
	});

	it("keeps findings from different clipping elements apart, in document order", () => {
		const findings = classify([
			pair({ index: 0, clipperYIndex: 9 }, { clippedYPx: 10 }),
			pair({ index: 1, clipperXIndex: 4 }, { clippedXPx: 10 }),
			pair({ index: 2, clipperYIndex: 9 }, { clippedYPx: 5 }),
		]);

		expect(findings.map((finding) => [finding.index, finding.clipperIndex])).toEqual([
			[0, 9],
			[1, 4],
		]);
		expect(findings[0]?.affectedCount).toBe(2);
	});

	it("excludes candidates that were moving at baseline", () => {
		expect(
			classify([pair({ index: 0, clipperYIndex: 0, unstable: true }, { clippedYPx: 60 })]),
		).toEqual([]);
	});
});

describe("classifyCandidates: truncation-increased", () => {
	it("routes text that was already truncated to truncation-increased, never clipped", () => {
		expect(
			classify([
				pair(
					{ index: 0, truncated: true, truncatorIndex: 3, truncationOverflowPx: 20 },
					// Truncated text also extends further past its box, which must not count as clipping.
					{ truncationOverflowPx: 60, clippedXPx: 60 },
				),
			]),
		).toEqual([
			{
				kind: "truncation-increased",
				index: 0,
				clipperIndex: 3,
				otherIndex: null,
				affectedCount: 1,
				metrics: { beforeOverflowPx: 20, afterOverflowPx: 60 },
			},
		]);
	});

	it("does not flag truncation that stays within tolerance", () => {
		expect(
			classify([
				pair(
					{ index: 0, truncated: true, truncatorIndex: 3, truncationOverflowPx: 20 },
					{ truncationOverflowPx: 22 },
				),
			]),
		).toEqual([]);
	});

	it("reports several pieces of text behind one ellipsis once", () => {
		const truncatedBy = { truncated: true, truncatorIndex: 3, truncationOverflowPx: 20 };
		const findings = classify([
			pair({ index: 0, ...truncatedBy }, { truncationOverflowPx: 60 }),
			pair({ index: 1, ...truncatedBy }, { truncationOverflowPx: 60 }),
		]);

		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({ index: 0, affectedCount: 2 });
	});
});

describe("classifyCandidates: overlap", () => {
	it("flags text that newly shares space with its neighbour, with the shared region", () => {
		const findings = classify([
			pair({ index: 0, rect: rect(0, 0, 100, 20) }, { textRects: [rect(0, 0, 100, 28)] }),
			pair({ index: 1, rect: rect(0, 24, 100, 20) }, { textRects: [rect(0, 20, 100, 28)] }),
		]);

		expect(findings).toEqual([
			{
				kind: "overlap",
				index: 0,
				clipperIndex: null,
				otherIndex: 1,
				affectedCount: 1,
				metrics: {
					beforeOverflowPx: 0,
					afterOverflowPx: 0,
					beforeOverlapAreaPx2: 0,
					afterOverlapAreaPx2: 800,
				},
				overlapRect: rect(0, 20, 100, 8),
			},
		]);
	});

	it("compares lines of text, not the box around a wrapped inline element", () => {
		// "Note:" sits at the start of the first line. The link after it wraps, so the box around
		// the link spans both lines at full width and covers "Note:", but none of its lines do.
		const note = pair({ index: 0, rect: rect(0, 0, 40, 20) }, { textRects: [rect(0, 0, 44, 20)] });
		const link = pair(
			{ index: 1, rect: rect(44, 0, 150, 20) },
			{
				rect: rect(0, 0, 200, 44),
				textRects: [rect(48, 0, 152, 20), rect(0, 24, 60, 20)],
			},
		);

		expect(classify([note, link])).toEqual([]);
	});

	it("does not treat lines that only touch as overlapping", () => {
		const findings = classify([
			pair({ index: 0, rect: rect(0, 0, 300, 20) }, { textRects: [rect(0, 0, 300, 20.6)] }),
			pair({ index: 1, rect: rect(0, 22, 300, 20) }, { textRects: [rect(0, 20, 300, 20)] }),
		]);

		expect(findings).toEqual([]);
	});

	it("does not flag text that already overlapped at baseline", () => {
		const findings = classify([
			pair({ index: 0, rect: rect(0, 0, 100, 24) }, { textRects: [rect(0, 0, 100, 30)] }),
			pair({ index: 1, rect: rect(0, 16, 100, 24) }, {}),
		]);

		expect(findings).toEqual([]);
	});

	it("does not flag overlap for sticky or fixed elements", () => {
		const findings = classify([
			pair({ index: 0, position: "fixed", rect: rect(0, 0, 200, 40) }, {}),
			pair({ index: 1, rect: rect(0, 48, 200, 40) }, { textRects: [rect(0, 20, 200, 40)] }),
		]);

		expect(findings).toEqual([]);
	});

	it("does not compare pairs that started more than a line box apart", () => {
		const findings = classify([
			pair({ index: 0, rect: rect(0, 0, 100, 20) }, { textRects: [rect(0, 0, 100, 90)] }),
			pair({ index: 1, rect: rect(0, 80, 100, 20) }, {}),
		]);

		expect(findings).toEqual([]);
	});

	it("excludes candidates that were moving at baseline", () => {
		const findings = classify([
			pair({ index: 0, unstable: true, rect: rect(0, 0, 100, 20) }, {}),
			pair({ index: 1, rect: rect(0, 24, 100, 20) }, { textRects: [rect(0, 10, 100, 20)] }),
		]);

		expect(findings).toEqual([]);
	});
});

describe("classifyTextSpacing", () => {
	it("takes each selector and html from the snapshots it is given", () => {
		const clipped = pair(
			{ index: 0, selector: "#promo", html: '<p id="promo">', clipperYIndex: 0 },
			{ clippedYPx: 14 },
		);
		const above = pair(
			{ index: 1, selector: "#a", html: '<p id="a">', rect: rect(0, 200, 100, 20) },
			{ textRects: [rect(0, 200, 100, 28)] },
		);
		const below = pair(
			{ index: 2, selector: "#b", html: '<p id="b">', rect: rect(0, 224, 100, 20) },
			{ textRects: [rect(0, 220, 100, 28)] },
		);
		const all = [clipped, above, below];

		expect(
			classifyTextSpacing(
				all.map((entry) => entry.before),
				all.map((entry) => entry.after),
			),
		).toEqual([
			{
				selector: "#promo",
				html: '<p id="promo">',
				kind: "clipped",
				metrics: { beforeOverflowPx: 0, afterOverflowPx: 14 },
				axis: "vertical",
				affectedCount: 1,
			},
			{
				selector: "#a",
				html: '<p id="a">',
				kind: "overlap",
				metrics: {
					beforeOverflowPx: 0,
					afterOverflowPx: 0,
					beforeOverlapAreaPx2: 0,
					afterOverlapAreaPx2: 800,
				},
				overlapsWith: "#b",
				overlapRect: rect(0, 220, 100, 8),
			},
		]);
	});
});

type ScriptedPage = {
	baseline?: CandidateSnapshot[];
	after?: CandidateSnapshot[];
	limitReached?: boolean;
	elements?: ElementDescription[];
	clippers?: ElementDescription[];
	restored?: boolean;
	throwOn?: string;
};

type Clip = { x: number; y: number; width: number; height: number };

function scriptedAdaptor(page: ScriptedPage = {}): TextSpacingAuditAdaptor & {
	calls: string[];
	args: Record<string, unknown[]>;
	screenshotCalls: Clip[];
} {
	const calls: string[] = [];
	const args: Record<string, unknown[]> = {};
	const screenshotCalls: Clip[] = [];

	return {
		calls,
		args,
		screenshotCalls,
		evaluate: async <T>(
			fn: (...fnArgs: never[]) => T | Promise<T>,
			...fnArgs: unknown[]
		): Promise<T> => {
			calls.push(fn.name);
			args[fn.name] = fnArgs;

			if (fn.name === page.throwOn) {
				throw new Error(`${fn.name} failed`);
			}

			switch (fn.name) {
				case "collectBaselineScript":
					return {
						candidates: page.baseline ?? [],
						limitReached: page.limitReached ?? false,
					} as T;
				case "applyOverrideScript":
					return { candidates: page.after ?? page.baseline ?? [] } as T;
				case "describeFindingsScript": {
					const request = fnArgs[0] as DescribeRequest;
					const payload: DescribePayload = {
						page: { width: 1280, height: 4000 },
						elements: (page.elements ?? []).filter((el) => request.elements.includes(el.index)),
						clippers: (page.clippers ?? []).filter((el) => request.clippers.includes(el.index)),
					};

					return payload as T;
				}
				case "restoreAndVerifyScript":
					return { restored: page.restored ?? true } as T;
				default:
					throw new Error(`unexpected evaluate: ${fn.name}`);
			}
		},
		screenshotClip: async (clip) => {
			calls.push("screenshotClip");
			screenshotCalls.push(clip);

			return new Uint8Array([screenshotCalls.length]);
		},
	};
}

function described(index: number, selector: string, box: Rect): ElementDescription {
	return {
		index,
		selector,
		html: `<p data-index="${index}"></p>`,
		rect: box,
		overflowX: "visible",
		overflowY: "visible",
		truncates: false,
		visible: true,
	};
}

describe("runTextSpacingAudit", () => {
	it("reports restored true when restore verification succeeds", async () => {
		const adaptor = scriptedAdaptor();
		const result = await runTextSpacingAudit(adaptor);

		expect(result).toEqual({
			findings: [],
			candidateCount: 0,
			truncated: false,
			restored: true,
			summary: { clipped: 0, truncationIncreased: 0, overlaps: 0 },
		});
		expect(adaptor.calls).toEqual([
			"collectBaselineScript",
			"applyOverrideScript",
			"restoreAndVerifyScript",
		]);
	});

	it("reports restored false without throwing when restore verification fails", async () => {
		await expect(runTextSpacingAudit(scriptedAdaptor({ restored: false }))).resolves.toMatchObject({
			restored: false,
		});
	});

	it("reports restored false without throwing when restore itself throws", async () => {
		await expect(
			runTextSpacingAudit(scriptedAdaptor({ throwOn: "restoreAndVerifyScript" })),
		).resolves.toMatchObject({ restored: false });
	});

	it("restores injected styles even when measuring under the override throws", async () => {
		const adaptor = scriptedAdaptor({ throwOn: "applyOverrideScript" });

		await expect(runTextSpacingAudit(adaptor)).rejects.toThrow("applyOverrideScript failed");
		expect(adaptor.calls).toContain("restoreAndVerifyScript");
	});

	it("counts only stable candidates toward candidateCount", async () => {
		const adaptor = scriptedAdaptor({
			baseline: [
				snapshot({ index: 0, unstable: true }),
				snapshot({ index: 1 }),
				snapshot({ index: 2 }),
			],
		});

		expect((await runTextSpacingAudit(adaptor)).candidateCount).toBe(2);
	});

	it("hands the candidate limit and both stylesheets to the page", async () => {
		const adaptor = scriptedAdaptor();

		await runTextSpacingAudit(adaptor, { candidateLimit: 7, settleMs: 25 });

		const config = adaptor.args.collectBaselineScript?.[0] as BaselineConfig;

		expect(config.limit).toBe(7);
		expect(config.freezeCss).toContain("transition: none !important");
		expect(config.overrideCss).toContain("line-height: 1.5 !important");
		expect(config.overrideCss).toContain("letter-spacing: 0.12em !important");
		expect(config.overrideCss).toContain("word-spacing: 0.16em !important");
		expect(config.overrideCss).toContain("p { margin-bottom: 2em !important; }");
		// Layered, so that it outranks unlayered author `!important` declarations.
		expect(config.overrideCss).toMatch(/^@layer [\w-]+ \{/);
		expect(adaptor.args.applyOverrideScript).toEqual([25]);
	});

	it("says when the candidate limit left text unmeasured", async () => {
		const result = await runTextSpacingAudit(scriptedAdaptor({ limitReached: true }));

		expect(result.truncated).toBe(true);
	});

	it("describes only the elements behind findings, and names the clipping element", async () => {
		const promo = pair({ index: 4, clipperYIndex: 2 }, { clippedYPx: 14 });
		const quiet = pair({ index: 5, clipperYIndex: 2 }, {});
		const adaptor = scriptedAdaptor({
			baseline: [promo.before, quiet.before],
			after: [promo.after, quiet.after],
			elements: [described(4, "#promo-text", rect(20, 100, 300, 60))],
			clippers: [described(2, "#promo", rect(10, 90, 320, 50))],
		});

		const result = await runTextSpacingAudit(adaptor);

		expect(adaptor.args.describeFindingsScript).toEqual([{ elements: [4], clippers: [2] }]);
		expect(result.findings).toEqual([
			{
				selector: "#promo-text",
				html: '<p data-index="4">',
				kind: "clipped",
				metrics: { beforeOverflowPx: 0, afterOverflowPx: 14 },
				rect: rect(20, 100, 300, 60),
				axis: "vertical",
				affectedCount: 1,
				clippedBy: "#promo",
				clippedByHtml: '<p data-index="2">',
				screenshot: new Uint8Array([1]),
			},
		]);
		expect(result.summary).toEqual({ clipped: 1, truncationIncreased: 0, overlaps: 0 });
	});

	it("summarises clipped, truncation-increased, and overlap findings", async () => {
		const pairs = [
			pair({ index: 0, clipperYIndex: 0, rect: rect(400, 0, 100, 20) }, { clippedYPx: 20 }),
			pair(
				{
					index: 1,
					truncated: true,
					truncatorIndex: 1,
					truncationOverflowPx: 20,
					rect: rect(400, 80, 100, 20),
				},
				{ truncationOverflowPx: 50 },
			),
			pair({ index: 2, rect: rect(0, 0, 50, 16) }, { textRects: [rect(0, 0, 50, 24)] }),
			pair({ index: 3, rect: rect(0, 20, 50, 16) }, { textRects: [rect(0, 16, 50, 24)] }),
		];
		const adaptor = scriptedAdaptor({
			baseline: pairs.map((entry) => entry.before),
			after: pairs.map((entry) => entry.after),
			elements: pairs.map((entry) =>
				described(entry.before.index, `#el-${entry.before.index}`, entry.before.rect),
			),
		});

		const result = await runTextSpacingAudit(adaptor);

		expect(result.summary).toEqual({ clipped: 1, truncationIncreased: 1, overlaps: 1 });
		expect(result.findings.map((finding) => [finding.kind, finding.selector])).toEqual([
			["clipped", "#el-0"],
			["truncation-increased", "#el-1"],
			["overlap", "#el-2"],
		]);
		expect(result.findings[2]).toMatchObject({
			overlapsWith: "#el-3",
			overlapsWithHtml: '<p data-index="3">',
			overlapRect: rect(0, 16, 50, 8),
		});
	});
});

describe("runTextSpacingAudit screenshots", () => {
	function clippedPage(count: number, selector: (index: number) => string): ScriptedPage {
		const pairs = Array.from({ length: count }, (_, index) =>
			pair({ index, clipperYIndex: index }, { clippedYPx: 30 }),
		);

		return {
			baseline: pairs.map((entry) => entry.before),
			after: pairs.map((entry) => entry.after),
			elements: pairs.map((_, index) =>
				described(index, selector(index), rect(100, 500 + index * 200, 300, 80)),
			),
			clippers: pairs.map((_, index) =>
				described(index, `#card-${index}`, rect(90, 490 + index * 200, 320, 60)),
			),
		};
	}

	it("frames a clipped element where it is cut off, while overrides are still applied", async () => {
		const adaptor = scriptedAdaptor(clippedPage(1, () => "#copy"));
		const result = await runTextSpacingAudit(adaptor);

		expect(result.findings[0]?.screenshot).toEqual(new Uint8Array([1]));
		// The element (y 500-580) where its clipper (y 490-550) still shows it, plus the 10px buffer.
		expect(adaptor.screenshotCalls).toEqual([{ x: 90, y: 490, width: 320, height: 70 }]);
		expect(adaptor.calls.indexOf("screenshotClip")).toBeLessThan(
			adaptor.calls.indexOf("restoreAndVerifyScript"),
		);
	});

	it("falls back to the clipping element when the text has left it altogether", async () => {
		const gone = pair({ index: 0, clipperYIndex: 0 }, { clippedYPx: 90 });
		const adaptor = scriptedAdaptor({
			baseline: [gone.before],
			after: [gone.after],
			elements: [described(0, "#copy", rect(100, 700, 300, 20))],
			clippers: [described(0, "#card", rect(100, 500, 300, 60))],
		});

		await runTextSpacingAudit(adaptor, { screenshotClipBuffer: 0 });

		expect(adaptor.screenshotCalls).toEqual([{ x: 100, y: 500, width: 300, height: 60 }]);
	});

	it("frames both elements of an overlap", async () => {
		const above = pair(
			{ index: 0, rect: rect(0, 100, 200, 20) },
			{ textRects: [rect(0, 100, 200, 28)] },
		);
		const below = pair(
			{ index: 1, rect: rect(0, 124, 260, 20) },
			{ textRects: [rect(0, 120, 260, 28)] },
		);
		const adaptor = scriptedAdaptor({
			baseline: [above.before, below.before],
			after: [above.after, below.after],
			elements: [
				described(0, "#above", rect(0, 100, 200, 28)),
				described(1, "#below", rect(0, 120, 260, 28)),
			],
		});

		await runTextSpacingAudit(adaptor, { screenshotClipBuffer: 0 });

		expect(adaptor.screenshotCalls).toEqual([{ x: 0, y: 100, width: 260, height: 48 }]);
	});

	it("drops an overlap when either element cannot be seen", async () => {
		const above = pair(
			{ index: 0, rect: rect(0, 100, 200, 20) },
			{ textRects: [rect(0, 100, 200, 28)] },
		);
		const below = pair(
			{ index: 1, rect: rect(0, 124, 260, 20) },
			{ textRects: [rect(0, 120, 260, 28)] },
		);

		// A closed menu faded out with `opacity`, laid over whatever is under it.
		for (const hidden of [0, 1]) {
			const adaptor = scriptedAdaptor({
				baseline: [above.before, below.before],
				after: [above.after, below.after],
				elements: [
					{ ...described(0, "#above", rect(0, 100, 200, 28)), visible: hidden !== 0 },
					{ ...described(1, "#below", rect(0, 120, 260, 28)), visible: hidden !== 1 },
				],
			});
			const result = await runTextSpacingAudit(adaptor);

			expect(result.findings).toEqual([]);
			expect(result.summary.overlaps).toBe(0);
			expect(adaptor.screenshotCalls).toEqual([]);
		}
	});

	it("matches each finding to its own element, even when two share a selector", async () => {
		const adaptor = scriptedAdaptor(clippedPage(2, () => "li>p"));
		const result = await runTextSpacingAudit(adaptor, { screenshotClipBuffer: 0 });

		expect(result.findings.map((finding) => finding.selector)).toEqual(["li>p", "li>p"]);
		expect(result.findings.map((finding) => finding.rect?.y)).toEqual([500, 700]);
		expect(adaptor.screenshotCalls.map((clip) => clip.y)).toEqual([500, 700]);
		expect(result.findings.map((finding) => finding.screenshot)).toEqual([
			new Uint8Array([1]),
			new Uint8Array([2]),
		]);
	});

	it(`omits screenshots past screenshotLimit (${DEFAULT_SCREENSHOT_LIMIT}) but keeps every finding`, async () => {
		const adaptor = scriptedAdaptor(
			clippedPage(DEFAULT_SCREENSHOT_LIMIT + 2, (index) => `#copy-${index}`),
		);
		const result = await runTextSpacingAudit(adaptor);

		expect(result.findings).toHaveLength(DEFAULT_SCREENSHOT_LIMIT + 2);
		expect(adaptor.screenshotCalls).toHaveLength(DEFAULT_SCREENSHOT_LIMIT);
		expect(result.findings.map((finding) => finding.screenshot !== undefined)).toEqual([
			...Array.from({ length: DEFAULT_SCREENSHOT_LIMIT }, () => true),
			false,
			false,
		]);
	});

	it("neither describes nor screenshots anything when there are no findings", async () => {
		const adaptor = scriptedAdaptor({ baseline: [snapshot({ index: 0 })] });

		await runTextSpacingAudit(adaptor);

		expect(adaptor.calls).not.toContain("describeFindingsScript");
		expect(adaptor.screenshotCalls).toHaveLength(0);
	});
});
