import type {
	CandidateSnapshot,
	DescribePayload,
	DescribeRequest,
	ElementDescription,
} from "@a11y-pulse/text-spacing-audit/measure";
import { describe, expect, it } from "vitest";
import type { Rect, ResizeTextAuditAdaptor } from "./adaptor";
import { classifyResizedText, runResizeTextAudit } from "./audit";
import type { LayoutFingerprint } from "./browser-scripts";
import type { ViewportMeta } from "./result";

function rect(x: number, y: number, width: number, height: number): Rect {
	return { x, y, width, height };
}

function snapshot(overrides: Partial<CandidateSnapshot> = {}): CandidateSnapshot {
	const box = overrides.rect ?? rect(0, 0, 100, 20);

	return {
		index: 0,
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

type Pair = { before: CandidateSnapshot; after: CandidateSnapshot };

/** A candidate before the resize, and what the resize changed about it. */
function pair(before: Partial<CandidateSnapshot>, changes: Partial<CandidateSnapshot>): Pair {
	const base = snapshot(before);

	return { before: base, after: { ...base, ...changes } };
}

function classify(pairs: Pair[]) {
	return classifyResizedText(
		pairs.map((entry) => entry.before),
		pairs.map((entry) => entry.after),
	);
}

describe("classifyResizedText", () => {
	it("reports nothing when no text is cut off", () => {
		expect(
			classify([pair({}, { rect: rect(0, 0, 50, 40), textRects: [rect(0, 0, 50, 40)] })]),
		).toEqual([]);
	});

	it("reports text a clipping ancestor cuts into, with the axis and the overflow", () => {
		const findings = classify([
			pair({ index: 3 }, { textRects: [rect(0, 0, 50, 60)], clippedYPx: 24, clipperYIndex: 7 }),
		]);

		expect(findings).toEqual([
			{
				kind: "clipped",
				index: 3,
				clipperIndex: 7,
				otherIndex: null,
				axis: "vertical",
				affectedCount: 1,
				metrics: { beforeOverflowPx: 0, afterOverflowPx: 24 },
			},
		]);
	});

	it("reports horizontal clipping against the horizontal clipper", () => {
		const findings = classify([
			pair({}, { textRects: [rect(0, 0, 180, 20)], clippedXPx: 60, clipperXIndex: 2 }),
		]);

		expect(findings).toMatchObject([{ axis: "horizontal", clipperIndex: 2 }]);
	});

	it("says both when text is cut off in both directions, measured on the worse one", () => {
		const findings = classify([
			pair(
				{},
				{
					textRects: [rect(0, 0, 200, 80)],
					clippedXPx: 30,
					clippedYPx: 40,
					clipperXIndex: 1,
					clipperYIndex: 1,
				},
			),
		]);

		expect(findings).toMatchObject([
			{ axis: "both", metrics: { beforeOverflowPx: 0, afterOverflowPx: 40 } },
		]);
	});

	it("ignores clipping within the tolerance", () => {
		expect(classify([pair({}, { clippedYPx: 2, clipperYIndex: 0 })])).toEqual([]);
	});

	it("honours a custom tolerance", () => {
		const entry = pair({}, { textRects: [rect(0, 0, 100, 40)], clippedYPx: 6, clipperYIndex: 0 });

		expect(classifyResizedText([entry.before], [entry.after], { clipTolerancePx: 8 })).toEqual([]);
	});

	it("does not report text that was already cut off, however much more is lost", () => {
		expect(
			classify([
				pair(
					{ clippedYPx: 30, clipperYIndex: 0, textRects: [rect(0, 0, 100, 60)] },
					{ clippedYPx: 90, textRects: [rect(0, 0, 50, 120)] },
				),
			]),
		).toEqual([]);
	});

	it("does not report text an ellipsis or line clamp was already truncating", () => {
		expect(
			classify([
				pair(
					{ truncated: true, truncatorIndex: 0 },
					{ textRects: [rect(0, 0, 300, 20)], clippedXPx: 200, clipperXIndex: 0 },
				),
			]),
		).toEqual([]);
	});

	it("does not report text an ellipsis or line clamp truncates only once resized", () => {
		expect(
			classify([
				pair(
					{},
					{
						truncated: true,
						truncatorIndex: 0,
						textRects: [rect(0, 0, 300, 20)],
						clippedXPx: 200,
						clipperXIndex: 0,
					},
				),
			]),
		).toEqual([]);
	});

	it("reports cut-off text that was not rendered before the resize, marked as having no baseline", () => {
		const late = snapshot({
			index: 7,
			textRects: [rect(0, 0, 300, 90)],
			clippedYPx: 60,
			clipperYIndex: 3,
		});

		expect(classifyResizedText([], [late])).toEqual([
			{
				kind: "clipped",
				index: 7,
				clipperIndex: 3,
				otherIndex: null,
				axis: "vertical",
				affectedCount: 1,
				metrics: { beforeOverflowPx: 0, afterOverflowPx: 60 },
				noBaseline: true,
			},
		]);
	});

	it("does not report text that appears with the resize and is whole, or hidden outright", () => {
		const whole = snapshot({ index: 7, textRects: [rect(0, 0, 300, 90)] });
		const hidden = snapshot({
			index: 8,
			textRects: [rect(-400, 0, 300, 20)],
			clippedXPx: 300,
			clipperXIndex: 3,
		});

		expect(classifyResizedText([], [whole, hidden])).toEqual([]);
	});

	it("drops the no-baseline mark when the same element also cuts text that was whole before", () => {
		const known = pair(
			{ index: 0 },
			{ textRects: [rect(0, 0, 100, 50)], clippedYPx: 20, clipperYIndex: 3 },
		);
		const late = snapshot({
			index: 7,
			textRects: [rect(0, 0, 300, 90)],
			clippedYPx: 60,
			clipperYIndex: 3,
		});

		for (const after of [
			[known.after, late],
			[late, known.after],
		]) {
			const findings = classifyResizedText([known.before], after);

			expect(findings).toHaveLength(1);
			expect(findings[0]).toMatchObject({ index: 7, clipperIndex: 3, affectedCount: 2 });
			expect(findings[0]?.noBaseline).toBeUndefined();
		}
	});

	it("does not report text the resized layout hides outright", () => {
		// An off-canvas menu: the whole label sits outside the clipping box.
		expect(
			classify([
				pair({}, { textRects: [rect(-240, 0, 100, 20)], clippedXPx: 140, clipperXIndex: 0 }),
			]),
		).toEqual([]);
	});

	it("does not report text the resized layout stops rendering", () => {
		expect(classify([pair({}, { textRects: [], clippedYPx: 0 })])).toEqual([]);
	});

	it("reports everything one element cuts off once, against the worst text still showing", () => {
		const findings = classify([
			pair({ index: 0 }, {}),
			pair({ index: 1 }, { textRects: [rect(0, 0, 100, 18)], clippedYPx: 6, clipperYIndex: 4 }),
			pair({ index: 2 }, { textRects: [rect(0, 0, 100, 18)], clippedYPx: 9, clipperYIndex: 4 }),
			// Pushed out of the box altogether.
			pair({ index: 3 }, { textRects: [rect(0, 0, 100, 18)], clippedYPx: 40, clipperYIndex: 4 }),
		]);

		expect(findings).toEqual([
			{
				kind: "clipped",
				index: 2,
				clipperIndex: 4,
				otherIndex: null,
				axis: "vertical",
				affectedCount: 3,
				metrics: { beforeOverflowPx: 0, afterOverflowPx: 9 },
			},
		]);
	});

	it("keeps text cut off by different elements apart", () => {
		const findings = classify([
			pair({ index: 0 }, { textRects: [rect(0, 0, 100, 40)], clippedYPx: 10, clipperYIndex: 1 }),
			pair({ index: 1 }, { textRects: [rect(0, 0, 100, 40)], clippedYPx: 10, clipperYIndex: 2 }),
		]);

		expect(findings.map((finding) => [finding.index, finding.clipperIndex])).toEqual([
			[0, 1],
			[1, 2],
		]);
	});

	it("skips candidates that were moving at baseline", () => {
		expect(
			classify([
				pair(
					{ unstable: true },
					{ textRects: [rect(0, 0, 100, 40)], clippedYPx: 10, clipperYIndex: 0 },
				),
			]),
		).toEqual([]);
	});

	it("compares text for overlap only as far as its clipping ancestors leave it showing", () => {
		// The second label's full length reaches back over the first, but its wrapper cuts it short.
		const cut = classify([
			pair({ index: 0, rect: rect(0, 0, 150, 20) }, { textRects: [rect(0, 0, 150, 20)] }),
			pair(
				{ index: 1, rect: rect(200, 0, 150, 20) },
				{
					rect: rect(100, 0, 150, 20),
					textRects: [rect(100, 0, 150, 20)],
					visibleTextRects: [rect(160, 0, 90, 20)],
				},
			),
		]);

		expect(cut).toEqual([]);

		// Hidden altogether: nothing of it shows, so nothing of it overlaps.
		const gone = classify([
			pair({ index: 0, rect: rect(0, 0, 150, 20) }, { textRects: [rect(0, 0, 150, 20)] }),
			pair(
				{ index: 1, rect: rect(200, 0, 150, 20) },
				{ rect: rect(100, 0, 150, 20), textRects: [rect(100, 0, 150, 20)], visibleTextRects: [] },
			),
		]);

		expect(gone).toEqual([]);
	});

	it("reports text that the resized layout lays over other text", () => {
		const findings = classify([
			pair({ index: 0, rect: rect(0, 0, 150, 20) }, { textRects: [rect(0, 0, 150, 20)] }),
			pair(
				{ index: 1, rect: rect(200, 0, 150, 20) },
				{ rect: rect(100, 0, 150, 20), textRects: [rect(100, 0, 150, 20)] },
			),
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
					afterOverlapAreaPx2: 1000,
				},
				overlapRect: rect(100, 0, 50, 20),
			},
		]);
	});
});

type ScriptedPage = {
	baseline?: CandidateSnapshot[];
	after?: CandidateSnapshot[];
	limitReached?: boolean;
	/** Whether collecting again at 200% ran into the candidate limit. */
	afterLimitReached?: boolean;
	elements?: ElementDescription[];
	clippers?: ElementDescription[];
	restored?: boolean;
	meta?: ViewportMeta | null;
	throwOn?: string;
	/** Fingerprints returned in turn; the last one repeats. Defaults to a layout that never moves. */
	fingerprints?: LayoutFingerprint[];
	failRestoreViewport?: boolean;
};

const STILL: LayoutFingerprint = {
	innerWidth: 640,
	scrollWidth: 640,
	scrollHeight: 2000,
	clientWidth: 640,
	bodyScrollHeight: 2000,
	childCount: 3,
};

function scriptedAdaptor(page: ScriptedPage = {}): ResizeTextAuditAdaptor & {
	calls: string[];
	args: Record<string, unknown[]>;
	viewports: Array<{ width: number; height: number }>;
	screenshotCalls: Rect[];
} {
	const calls: string[] = [];
	const args: Record<string, unknown[]> = {};
	const viewports: Array<{ width: number; height: number }> = [];
	const screenshotCalls: Rect[] = [];
	let viewport = { width: 1280, height: 800 };
	let reading = 0;

	return {
		calls,
		args,
		viewports,
		screenshotCalls,
		getViewport: async () => viewport,
		setViewport: async (next) => {
			if (page.failRestoreViewport && viewports.length === 1) {
				throw new Error("setViewport failed");
			}

			calls.push(`setViewport ${next.width}x${next.height}`);
			viewports.push(next);
			viewport = next;
		},
		evaluate: async <T>(
			fn: (...fnArgs: never[]) => T | Promise<T>,
			...fnArgs: unknown[]
		): Promise<T> => {
			if (fn.name === "readLayoutFingerprintScript") {
				const fingerprints = page.fingerprints ?? [STILL];

				return (fingerprints[Math.min(reading++, fingerprints.length - 1)] ?? STILL) as T;
			}

			calls.push(fn.name);
			args[fn.name] = fnArgs;

			if (fn.name === page.throwOn) {
				throw new Error(`${fn.name} failed`);
			}

			switch (fn.name) {
				case "readViewportMetaScript":
					return (page.meta ?? null) as T;
				case "collectBaselineScript":
					return {
						candidates: page.baseline ?? [],
						limitReached: page.limitReached ?? false,
					} as T;
				case "remeasureScript":
					return {
						candidates: page.after ?? page.baseline ?? [],
						limitReached: page.afterLimitReached ?? false,
					} as T;
				case "describeFindingsScript": {
					const request = fnArgs[0] as DescribeRequest;
					const payload: DescribePayload = {
						page: { width: 640, height: 4000 },
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

function described(
	index: number,
	selector: string,
	box: Rect,
	overrides: Partial<ElementDescription> = {},
): ElementDescription {
	return {
		index,
		selector,
		html: `<p data-index="${index}"></p>`,
		rect: box,
		overflowX: "visible",
		overflowY: "visible",
		truncates: false,
		visible: true,
		...overrides,
	};
}

const FAST = { settleDelayMs: 0, minSettleMs: 0 };

/** A page whose one paragraph is cut off by clipper 2 once the viewport is halved. */
function clippedPage(overrides: ScriptedPage = {}): ScriptedPage {
	const entry = pair(
		{ index: 4 },
		{ textRects: [rect(20, 100, 200, 90)], clippedYPx: 30, clipperYIndex: 2 },
	);

	return {
		baseline: [entry.before],
		after: [entry.after],
		elements: [described(4, "#copy", rect(20, 100, 200, 90))],
		clippers: [described(2, "#card", rect(10, 90, 220, 70), { overflowY: "hidden" })],
		...overrides,
	};
}

describe("runResizeTextAudit", () => {
	it("measures, halves the viewport, measures again, then puts the viewport and styles back", async () => {
		const adaptor = scriptedAdaptor();
		const result = await runResizeTextAudit(adaptor, FAST);

		expect(adaptor.calls).toEqual([
			"readViewportMetaScript",
			"collectBaselineScript",
			"setViewport 640x400",
			"remeasureScript",
			"setViewport 1280x800",
			"restoreAndVerifyScript",
		]);
		expect(result).toEqual({
			findings: [],
			candidateCount: 0,
			truncated: false,
			viewport: { width: 640, height: 400 },
			originalViewport: { width: 1280, height: 800 },
			unsettled: false,
			restored: true,
			viewportMeta: null,
			summary: { clipped: 0, overlaps: 0 },
		});
	});

	it("freezes motion for the baseline without the text spacing override", async () => {
		const adaptor = scriptedAdaptor();

		await runResizeTextAudit(adaptor, { ...FAST, candidateLimit: 25 });

		expect(adaptor.args.collectBaselineScript?.[0]).toMatchObject({
			limit: 25,
			overrideCss: "",
			freezeCss: expect.stringContaining("transition: none"),
		});
	});

	it("rounds an odd viewport", async () => {
		const adaptor = scriptedAdaptor();
		adaptor.getViewport = async () => ({ width: 1025, height: 767 });

		const result = await runResizeTextAudit(adaptor, FAST);

		expect(result.viewport).toEqual({ width: 513, height: 384 });
	});

	it("describes a clipped finding and screenshots where the text is still showing", async () => {
		const adaptor = scriptedAdaptor(clippedPage());
		const result = await runResizeTextAudit(adaptor, FAST);

		expect(adaptor.args.describeFindingsScript).toEqual([{ elements: [4], clippers: [2] }]);
		expect(result.findings).toEqual([
			{
				selector: "#copy",
				html: '<p data-index="4">',
				kind: "clipped",
				metrics: { beforeOverflowPx: 0, afterOverflowPx: 30 },
				rect: rect(20, 100, 200, 90),
				axis: "vertical",
				affectedCount: 1,
				clippedBy: "#card",
				clippedByHtml: '<p data-index="2">',
				clippedByRect: rect(10, 90, 220, 70),
				screenshot: new Uint8Array([1]),
			},
		]);
		expect(result.summary).toEqual({ clipped: 1, overlaps: 0 });
		// The paragraph where the card still shows it, padded by the default buffer.
		expect(adaptor.screenshotCalls).toEqual([rect(10, 90, 220, 80)]);
		// Evidence is captured before the viewport goes back.
		expect(adaptor.calls.indexOf("screenshotClip")).toBeLessThan(
			adaptor.calls.indexOf("setViewport 1280x800"),
		);
	});

	it("drops a clipped finding whose clipping box truncates on purpose", async () => {
		const adaptor = scriptedAdaptor(
			clippedPage({
				clippers: [
					described(2, "#card", rect(10, 90, 220, 70), { overflowY: "hidden", truncates: true }),
				],
			}),
		);
		const result = await runResizeTextAudit(adaptor, FAST);

		expect(result.findings).toEqual([]);
		expect(adaptor.screenshotCalls).toEqual([]);
	});

	it("drops a clipped finding whose box no longer clips in the resized layout", async () => {
		const adaptor = scriptedAdaptor(
			clippedPage({
				clippers: [described(2, "#card", rect(10, 90, 220, 70), { overflowY: "visible" })],
			}),
		);

		expect((await runResizeTextAudit(adaptor, FAST)).findings).toEqual([]);
	});

	it("drops a finding whose element the resized layout hides", async () => {
		const adaptor = scriptedAdaptor(
			clippedPage({
				elements: [described(4, "#copy", rect(20, 100, 200, 90), { visible: false })],
			}),
		);

		expect((await runResizeTextAudit(adaptor, FAST)).findings).toEqual([]);
	});

	it("describes an overlap with both elements, and drops it when one is hidden", async () => {
		const left = pair({ index: 0, rect: rect(0, 0, 150, 20) }, {});
		const right = pair(
			{ index: 1, rect: rect(200, 0, 150, 20) },
			{ rect: rect(100, 0, 150, 20), textRects: [rect(100, 0, 150, 20)] },
		);
		const page: ScriptedPage = {
			baseline: [left.before, right.before],
			after: [left.after, right.after],
			elements: [
				described(0, "#one", rect(0, 0, 150, 20)),
				described(1, "#two", rect(100, 0, 150, 20)),
			],
		};
		const adaptor = scriptedAdaptor(page);
		const result = await runResizeTextAudit(adaptor, FAST);

		expect(result.findings).toMatchObject([
			{
				selector: "#one",
				kind: "overlap",
				overlapsWith: "#two",
				overlapsWithHtml: '<p data-index="1">',
				overlapRect: rect(100, 0, 50, 20),
			},
		]);
		expect(result.summary).toEqual({ clipped: 0, overlaps: 1 });
		// Both elements, padded.
		expect(adaptor.screenshotCalls).toEqual([rect(0, 0, 260, 30)]);

		const hidden = scriptedAdaptor({
			...page,
			elements: [
				described(0, "#one", rect(0, 0, 150, 20)),
				described(1, "#two", rect(100, 0, 150, 20), { visible: false }),
			],
		});

		expect((await runResizeTextAudit(hidden, FAST)).findings).toEqual([]);

		// A `text-overflow` in an element's styles says nothing about whether its text is cut short:
		// the measurement has already left out whatever a clipping ancestor hides, so text that
		// still overlaps is text that shows.
		for (const styled of [0, 1]) {
			const ellipsisStyled = scriptedAdaptor({
				...page,
				elements: [
					described(0, "#one", rect(0, 0, 150, 20), { truncates: styled === 0 }),
					described(1, "#two", rect(100, 0, 150, 20), { truncates: styled === 1 }),
				],
			});

			expect((await runResizeTextAudit(ellipsisStyled, FAST)).summary).toEqual({
				clipped: 0,
				overlaps: 1,
			});
		}
	});

	it("stops screenshotting at screenshotLimit but keeps the findings", async () => {
		const adaptor = scriptedAdaptor(clippedPage());
		const result = await runResizeTextAudit(adaptor, { ...FAST, screenshotLimit: 0 });

		expect(result.findings).toHaveLength(1);
		expect(result.findings[0]?.screenshot).toBeUndefined();
		expect(adaptor.screenshotCalls).toEqual([]);
	});

	it("counts candidates that held still and reports a capped page as truncated", async () => {
		const adaptor = scriptedAdaptor({
			baseline: [snapshot({ index: 0 }), snapshot({ index: 1, unstable: true })],
			limitReached: true,
		});
		const result = await runResizeTextAudit(adaptor, FAST);

		expect(result.candidateCount).toBe(1);
		expect(result.truncated).toBe(true);
	});

	it("collects candidates again once resized, and passes the no-baseline mark through", async () => {
		const late = snapshot({
			index: 9,
			textRects: [rect(20, 100, 200, 90)],
			clippedYPx: 30,
			clipperYIndex: 2,
		});
		const adaptor = scriptedAdaptor({
			baseline: [],
			after: [late],
			elements: [described(9, "#notice", rect(20, 100, 200, 90))],
			clippers: [described(2, "#bar", rect(10, 90, 220, 70), { overflowY: "hidden" })],
		});
		const result = await runResizeTextAudit(adaptor, FAST);

		expect(adaptor.args.remeasureScript).toEqual([0, true]);
		expect(result.findings).toMatchObject([
			{ selector: "#notice", kind: "clipped", clippedBy: "#bar", noBaseline: true },
		]);
	});

	it("reports the page as truncated when the limit is reached only once resized", async () => {
		const adaptor = scriptedAdaptor({ baseline: [snapshot()], afterLimitReached: true });

		expect((await runResizeTextAudit(adaptor, FAST)).truncated).toBe(true);
	});

	it("passes the viewport meta tag through", async () => {
		const meta: ViewportMeta = {
			content: "user-scalable=no",
			html: '<meta name="viewport" content="user-scalable=no">',
			userScalable: false,
			maximumScale: null,
			blocksZoom: true,
		};

		expect((await runResizeTextAudit(scriptedAdaptor({ meta }), FAST)).viewportMeta).toEqual(meta);
	});

	it("reports the layout as unsettled when it never holds still", async () => {
		let width = 0;
		const adaptor = scriptedAdaptor();
		const evaluate = adaptor.evaluate.bind(adaptor);

		adaptor.evaluate = (async (fn: (...fnArgs: never[]) => unknown, ...fnArgs: unknown[]) =>
			fn.name === "readLayoutFingerprintScript"
				? { ...STILL, scrollHeight: width++ }
				: evaluate(fn, ...fnArgs)) as typeof adaptor.evaluate;

		const result = await runResizeTextAudit(adaptor, { ...FAST, settleAttempts: 3 });

		expect(result.unsettled).toBe(true);
	});

	it("puts the viewport and styles back when measuring throws", async () => {
		const adaptor = scriptedAdaptor({ throwOn: "remeasureScript" });

		await expect(runResizeTextAudit(adaptor, FAST)).rejects.toThrow("remeasureScript failed");
		expect(adaptor.viewports).toEqual([
			{ width: 640, height: 400 },
			{ width: 1280, height: 800 },
		]);
		expect(adaptor.calls.at(-1)).toBe("restoreAndVerifyScript");
	});

	it("removes its styles without touching the viewport when the baseline throws", async () => {
		const adaptor = scriptedAdaptor({ throwOn: "collectBaselineScript" });

		await expect(runResizeTextAudit(adaptor, FAST)).rejects.toThrow();
		expect(adaptor.viewports).toEqual([]);
		expect(adaptor.calls.at(-1)).toBe("restoreAndVerifyScript");
	});

	it("reports restored false when the layout did not come back", async () => {
		const result = await runResizeTextAudit(scriptedAdaptor({ restored: false }), FAST);

		expect(result.restored).toBe(false);
	});

	it("reports restored false when the viewport could not be put back", async () => {
		const adaptor = scriptedAdaptor({ failRestoreViewport: true });
		const result = await runResizeTextAudit(adaptor, FAST);

		expect(result.restored).toBe(false);
		expect(adaptor.calls.at(-1)).toBe("restoreAndVerifyScript");
	});
});
