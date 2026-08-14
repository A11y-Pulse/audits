import puppeteer, { type Browser, type Page } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PuppeteerAdaptor } from "../../src/adaptors/puppeteer";
import {
	runSkipLinkAudit,
	type SkipLinkOptions,
	type SkipLinkResult,
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
	options?: SkipLinkOptions,
): Promise<SkipLinkResult> {
	const page: Page = await browser.newPage();

	try {
		await page.goto(`${server.url}/${name}`, { waitUntil: "load" });

		return await runSkipLinkAudit(new PuppeteerAdaptor(page), options);
	} finally {
		await page.close();
	}
}

describe("skip link audit (integration)", () => {
	it("passes a skip link whose target is programmatically focused", async () => {
		const result = await runFixture("working.html");

		expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0 });
		expect(result.skipLinks[0]).toMatchObject({
			fragment: "#main",
			tabIndex: 1,
			passed: true,
			failureReason: null,
		});
	});

	it("flags a skip link whose fragment target is missing", async () => {
		const result = await runFixture("target-missing.html");

		expect(result.skipLinks[0]).toMatchObject({
			fragment: "#main",
			passed: false,
			failureReason: "target-missing",
		});
		expect(result.summary.failed).toBe(1);
	});

	it("passes when the target is not focusable but the next Tab lands inside it", async () => {
		const result = await runFixture("target-not-focusable.html");

		expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0 });
		expect(result.skipLinks[0]?.failureReason).toBeNull();
	});

	it("flags a skip link whose click handler preventDefault does nothing", async () => {
		const result = await runFixture("activation-no-effect.html");

		expect(result.skipLinks[0]).toMatchObject({
			passed: false,
			failureReason: "activation-no-effect",
		});
	});

	it("finds a skip link at the 2nd tab stop", async () => {
		const result = await runFixture("skip-link-not-first.html");

		expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0 });
		expect(result.skipLinks[0]?.tabIndex).toBe(2);
	});

	it("finds a skip link at the 3rd tab stop", async () => {
		const result = await runFixture("skip-link-at-stop-3.html");

		expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0 });
		expect(result.skipLinks[0]?.tabIndex).toBe(3);
	});

	it("stays silent on a landmark-only page with no skip link", async () => {
		const result = await runFixture("landmark-only.html");

		expect(result.skipLinks).toEqual([]);
		expect(result.summary).toEqual({ found: 0, passed: 0, failed: 0 });
	});

	it("records multiple skip links", async () => {
		const result = await runFixture("multiple-skip-links.html");

		expect(result.skipLinks).toHaveLength(2);
		expect(result.skipLinks.map((link) => link.fragment)).toEqual([
			"#main",
			"#nav",
		]);
		expect(result.summary).toEqual({ found: 2, passed: 2, failed: 0 });
	});

	it("ignores hash-router nav and still checks a real skip link", async () => {
		const result = await runFixture("hash-router.html");

		expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0 });
		expect(result.skipLinks[0]).toMatchObject({
			fragment: "#main",
			tabIndex: 2,
			passed: true,
			failureReason: null,
		});
	});

	it("passes when the target is focused asynchronously within 250ms", async () => {
		const result = await runFixture("async-focus.html");

		expect(result.summary).toEqual({ found: 1, passed: 1, failed: 0 });
		expect(result.skipLinks[0]?.passed).toBe(true);
	});
});
