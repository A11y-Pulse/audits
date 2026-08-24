import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PuppeteerAdaptor } from "../../src/adaptors/puppeteer";
import {
	runTextSpacingAudit,
	type TextSpacingAuditAdaptor,
	type TextSpacingOptions,
	type TextSpacingResult,
} from "../../src/index";
import {
	type FixtureServer,
	startFixtureServer,
} from "./helpers/serve-fixtures";

let server: FixtureServer;
let browser: Browser;

beforeAll(async () => {
	server = await startFixtureServer();
	browser = await puppeteer.launch();
});

afterAll(async () => {
	await browser.close();
	await server.close();
});

async function runFixture(
	name: string,
	options?: TextSpacingOptions,
): Promise<{ result: TextSpacingResult; leftoverStyles: number }> {
	const page: Page = await browser.newPage();

	try {
		await page.goto(`${server.url}/${name}`, { waitUntil: "load" });
		const result = await runTextSpacingAudit(
			new PuppeteerAdaptor(page),
			options,
		);
		const leftoverStyles = await page.evaluate(
			() =>
				document.querySelectorAll(
					'[data-a11y-pulse="ts-freeze"], [data-a11y-pulse="ts-override"]',
				).length,
		);

		return { result, leftoverStyles };
	} finally {
		await page.close();
	}
}

describe("text spacing audit (integration)", () => {
	it("lets a spacious layout survive the override with no findings", async () => {
		const { result, leftoverStyles } = await runFixture("passing.html");

		expect(result.candidateCount).toBeGreaterThan(0);
		expect(result.findings).toEqual([]);
		expect(result.summary).toEqual({
			clipped: 0,
			truncationIncreased: 0,
			overlaps: 0,
		});
		expect(result.restored).toBe(true);
		expect(leftoverStyles).toBe(0);
	});

	it("flags a fixed-height overflow-hidden box as clipped", async () => {
		const { result, leftoverStyles } = await runFixture(
			"clipped-fixed-height.html",
		);

		expect(result.findings.some((finding) => finding.kind === "clipped")).toBe(
			true,
		);
		expect(
			result.findings.find((finding) => finding.kind === "clipped")?.metrics
				.afterOverflowPx,
		).toBeGreaterThan(2);
		expect(result.summary.clipped).toBeGreaterThan(0);
		expect(result.restored).toBe(true);
		expect(leftoverStyles).toBe(0);

		const clipped = result.findings.find(
			(finding) => finding.kind === "clipped",
		);
		expect(clipped?.screenshot).toBeInstanceOf(Uint8Array);
		expect(clipped?.screenshot?.length ?? 0).toBeGreaterThan(100);
		// PNG magic number.
		expect(Array.from(clipped!.screenshot!.slice(0, 8))).toEqual([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		]);
	});

	it("captures the screenshot at the adaptor's fixed scale", async () => {
		// Puppeteer's clip.scale multiplies against the page's current
		// deviceScaleFactor rather than replacing it (verified directly against
		// real Puppeteer in the reflow-audit integration suite), so this only
		// comes out matching the clip's own CSS-pixel size given the page's own
		// deviceScaleFactor is 1, as it is by default here.
		const page: Page = await browser.newPage();

		try {
			await page.goto(`${server.url}/clipped-fixed-height.html`, {
				waitUntil: "load",
			});

			const inner = new PuppeteerAdaptor(page);
			const calls: Array<{
				clip: { width: number };
				scale: number;
			}> = [];
			const spy: TextSpacingAuditAdaptor = {
				evaluate: inner.evaluate.bind(inner),
				screenshotClipScale: inner.screenshotClipScale,
				screenshotClip: async (clip, scale = 1) => {
					calls.push({ clip, scale });

					return inner.screenshotClip(clip, scale);
				},
			};

			const result = await runTextSpacingAudit(spy);
			const clipped = result.findings.find(
				(finding) => finding.kind === "clipped",
			);

			expect(clipped?.screenshot).toBeInstanceOf(Uint8Array);
			expect(calls).toHaveLength(1);
			expect(calls[0]?.scale).toBe(1);

			const png = Buffer.from(clipped!.screenshot!);
			const pngWidth = png.readUInt32BE(16);

			expect(pngWidth).toBe(Math.round(calls[0]!.clip.width));
		} finally {
			await page.close();
		}
	});

	it("routes deeper ellipsis truncation to incomplete, never a violation", async () => {
		const { result, leftoverStyles } = await runFixture("ellipsis.html");

		expect(result.findings.some((finding) => finding.kind === "clipped")).toBe(
			false,
		);
		expect(result.summary.clipped).toBe(0);
		expect(
			result.findings.every(
				(finding) => finding.kind === "truncation-increased",
			),
		).toBe(true);
		expect(result.summary.truncationIncreased).toBeGreaterThan(0);
		expect(result.restored).toBe(true);
		expect(leftoverStyles).toBe(0);
	});

	it("reports overlapping text blocks as overlap incomplete", async () => {
		const { result, leftoverStyles } = await runFixture("overlap.html");

		expect(result.findings.some((finding) => finding.kind === "overlap")).toBe(
			true,
		);
		expect(result.summary.overlaps).toBeGreaterThan(0);
		expect(result.summary.clipped).toBe(0);
		expect(
			result.findings.find((finding) => finding.kind === "overlap"),
		).toEqual(
			expect.objectContaining({
				kind: "overlap",
				overlapsWith: expect.any(String),
			}),
		);
		expect(result.restored).toBe(true);
		expect(leftoverStyles).toBe(0);
	});

	it("finds no candidates on a page with no text", async () => {
		const { result, leftoverStyles } = await runFixture("no-text.html");

		expect(result.candidateCount).toBe(0);
		expect(result.findings).toEqual([]);
		expect(result.restored).toBe(true);
		expect(leftoverStyles).toBe(0);
	});
});
