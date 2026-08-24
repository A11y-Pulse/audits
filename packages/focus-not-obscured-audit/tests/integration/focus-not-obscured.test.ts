import { PuppeteerAdaptor } from "@a11y-pulse/tab-orchestrator/puppeteer";
import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	type FocusNotObscuredOptions,
	type FocusNotObscuredResult,
	runFocusNotObscuredAudit,
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
	options?: FocusNotObscuredOptions,
): Promise<FocusNotObscuredResult> {
	const page: Page = await browser.newPage();

	try {
		await page.goto(`${server.url}/${name}`, { waitUntil: "load" });

		return await runFocusNotObscuredAudit(new PuppeteerAdaptor(page), options);
	} finally {
		await page.close();
	}
}

describe("focus not obscured audit (integration)", () => {
	it("flags an element entirely hidden behind a sticky footer", async () => {
		const result = await runFixture("sticky-footer-obscures.html");

		const violations = result.elements.filter(
			(element) => element.bucket === "violation",
		);
		expect(violations.length).toBeGreaterThanOrEqual(1);
		expect(violations[0]?.measurement.obscuredBy?.html).toMatch(
			/sticky-footer/,
		);

		expect(violations[0]?.screenshot).toBeInstanceOf(Uint8Array);
		expect(violations[0]?.screenshot?.length ?? 0).toBeGreaterThan(100);
		// PNG magic number.
		expect(Array.from(violations[0]!.screenshot!.slice(0, 8))).toEqual([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		]);
	});

	it("passes a page where no element is obscured", async () => {
		const result = await runFixture("obscuring-clean.html");

		expect(result.elements.length).toBeGreaterThanOrEqual(2);
		expect(
			result.elements.filter((element) => element.bucket === "violation"),
		).toHaveLength(0);
		expect(
			result.elements.filter((element) => element.bucket === "incomplete"),
		).toHaveLength(0);
		expect(result.elements.every((element) => !element.screenshot)).toBe(true);
	});

	it("does not flag a semi-transparent overlay as a violation", async () => {
		const result = await runFixture("semi-transparent-overlay.html");

		expect(
			result.elements.filter((element) => element.bucket === "violation"),
		).toHaveLength(0);

		const fullyCovered = result.elements.find(
			(element) => element.measurement.fullyObscured,
		);
		expect(fullyCovered?.measurement.opacity).toBe("semi-transparent");
	});
});
