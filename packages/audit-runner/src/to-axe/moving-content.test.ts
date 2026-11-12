import type { MovingContentRegion, MovingContentResult } from "@a11y-pulse/moving-content-audit";
import { describe, expect, it } from "vitest";
import { toJson } from "../serialise";
import {
	MOVING_CONTENT_AUDIT_ID,
	MOVING_CONTENT_EVIDENCE_CHECK_ID,
	movingContentToAxe,
} from "./moving-content";

function region(overrides: Partial<MovingContentRegion> = {}): MovingContentRegion {
	return {
		selector: "#offers",
		html: '<div id="offers">',
		rect: { x: 16, y: 120, width: 760, height: 280 },
		motion: "script",
		detectedBy: "dom-observation",
		finding: "no-pause-control",
		observedMs: 4900,
		animations: [],
		pauseControl: null,
		pausesOn: [],
		reducedMotion: null,
		...overrides,
	};
}

function result(
	failed: MovingContentRegion[],
	needsReview: MovingContentRegion[] = [],
	passed: MovingContentRegion[] = [],
): MovingContentResult {
	return {
		failed,
		needsReview,
		passed,
		observedMs: 5000,
		summary: {
			checked: failed.length + needsReview.length + passed.length,
			failed: failed.length,
			needsReview: needsReview.length,
			passed: passed.length,
			unchecked: 0,
			ignored: { essential: 0, tooSmall: 0 },
		},
	};
}

const pauseControl = {
	selector: "#pause",
	html: '<button id="pause">',
	name: "Pause slideshow",
	foundBy: "name" as const,
};

describe("movingContentToAxe", () => {
	it("routes each list to its bucket under the WCAG 2.2.2 tags", () => {
		const output = movingContentToAxe(
			result(
				[region({ selector: "#failed" })],
				[region({ selector: "#review", finding: "small-region" })],
				[region({ selector: "#passed", finding: "pause-control", pauseControl })],
			),
		);

		expect(output.violations[0]?.id).toBe(MOVING_CONTENT_AUDIT_ID);
		expect(output.violations[0]?.tags).toEqual(["wcag2a", "wcag222", "cat.time-and-media"]);
		expect(output.violations[0]?.nodes[0]?.target).toEqual(["#failed"]);
		expect(output.incomplete[0]?.nodes[0]?.target).toEqual(["#review"]);
		expect(output.passes[0]?.nodes[0]?.target).toEqual(["#passed"]);
		expect(output.passes[0]?.nodes[0]).not.toHaveProperty("failureSummary");
	});

	it("is inapplicable when nothing on the page moves", () => {
		const output = movingContentToAxe(result([]));

		expect(output.inapplicable.map(({ id }) => id)).toEqual([MOVING_CONTENT_AUDIT_ID]);
		expect(output.violations).toEqual([]);
	});

	it("says what moves, for how long, and what to do about a failure", () => {
		const output = movingContentToAxe(
			result([
				region(),
				region({
					motion: "css-animation",
					detectedBy: "animation-api",
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
				}),
			]),
		);

		expect(output.violations[0]?.nodes[0]?.failureSummary).toBe(
			"This content is moved by a script on a timer, was still moving after 4.9 seconds, and no control to pause, stop or hide it was found. Add a control that pauses, stops or hides it.",
		);
		expect(output.violations[0]?.nodes[1]?.failureSummary).toContain(
			'moved by a CSS animation that starts on its own ("ticker"), was still moving after 5.0 seconds',
		);
	});

	it("explains why a region needs review", () => {
		const output = movingContentToAxe(
			result(
				[],
				[
					region({ motion: "css-animation", finding: "pauses-on-hover", pausesOn: ["hover"] }),
					region({ motion: "marquee", finding: "finite-loop" }),
					region({ motion: "video", finding: "uncertain-playback" }),
				],
			),
		);
		const summaries = output.incomplete[0]?.nodes.map((node) => node.failureSummary);

		expect(summaries?.[0]).toContain("which a keyboard user cannot do");
		expect(summaries?.[1]).toContain("This <marquee> scrolls on its own");
		expect(summaries?.[1]).toContain("stops after a set number of loops");
		expect(summaries?.[2]).toContain("This video plays on its own");
		expect(summaries?.[2]).toContain("show the browser's controls");
	});

	it("attaches the measurements as evidence, with or without screenshots", () => {
		const screenshot = new Uint8Array([1, 2, 3]);
		const laterScreenshot = new Uint8Array([4, 5, 6]);
		const output = movingContentToAxe(
			result([region({ screenshot, laterScreenshot }), region({ selector: "#second" })]),
		);
		const [withShots, without] = output.violations[0]?.nodes ?? [];

		expect(withShots?.any[0]).toMatchObject({
			id: MOVING_CONTENT_EVIDENCE_CHECK_ID,
			message: "Moving content with no pause control found",
			data: {
				motion: "script",
				detectedBy: "dom-observation",
				observedMs: 4900,
				rect: { x: 16, y: 120, width: 760, height: 280 },
				screenshot,
				laterScreenshot,
			},
		});
		expect(without?.any[0]?.data).toMatchObject({
			motion: "script",
			reason: "no-pause-control",
			observedMs: 4900,
		});
		expect(without?.any[0]?.data).not.toHaveProperty("screenshot");
		// Screenshots survive JSON output as base64.
		expect(toJson(withShots?.any[0]?.data)).toContain('"screenshot": "AQID"');
	});

	it("names the pause control on a passing region", () => {
		const output = movingContentToAxe(
			result(
				[],
				[],
				[
					region({ finding: "pause-control", pauseControl }),
					region({ motion: "video", finding: "native-controls" }),
				],
			),
		);
		const messages = output.passes[0]?.nodes.map((node) => node.any[0]?.message);

		expect(messages).toEqual([
			'Moving content with the pause control "Pause slideshow" (#pause)',
			"Video with the browser's own controls",
		]);
	});
});
