import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PuppeteerAdaptor } from "../../src/adaptors/puppeteer";
import {
	runTextSpacingAudit,
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
