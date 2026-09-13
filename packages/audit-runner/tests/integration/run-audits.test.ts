import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	type AdaptorFactories,
	describeEachEngine,
	WEBKIT_PARTIAL_TAB_LOOP,
} from "@a11y-pulse/integration-harness";
import { PlaywrightAdaptor as ReflowPlaywrightAdaptor } from "@a11y-pulse/reflow-audit/playwright";
import { PuppeteerAdaptor as ReflowAdaptor } from "@a11y-pulse/reflow-audit/puppeteer";
import { PlaywrightAdaptor as TextSpacingPlaywrightAdaptor } from "@a11y-pulse/text-spacing-audit/playwright";
import { PuppeteerAdaptor as TextSpacingAdaptor } from "@a11y-pulse/text-spacing-audit/puppeteer";
import type { Result } from "axe-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { type AuditAdaptors, type AuditRunnerResult, runAllAudits } from "../../src/run-audits";
import { toJson } from "../../src/serialise";
import { FOCUS_APPEARANCE_AUDIT_ID } from "../../src/to-axe/focus-appearance";
import { FOCUS_NOT_OBSCURED_AUDIT_ID } from "../../src/to-axe/focus-not-obscured";
import { REFLOW_AUDIT_ID } from "../../src/to-axe/reflow";
import { SKIP_LINK_AUDIT_ID } from "../../src/to-axe/skip-link";
import { TEXT_SPACING_AUDIT_ID } from "../../src/to-axe/text-spacing";
import { type FixtureServer, startFixtureServer } from "./helpers/serve-fixtures";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer();
});

afterAll(async () => {
	await server.close();
});

const adaptors: AdaptorFactories<AuditAdaptors> = {
	puppeteer: (page) => ({
		browser: new PuppeteerAdaptor(page),
		reflow: new ReflowAdaptor(page),
		textSpacing: new TextSpacingAdaptor(page),
	}),
	playwright: (page) => ({
		browser: new PlaywrightAdaptor(page),
		reflow: new ReflowPlaywrightAdaptor(page),
		textSpacing: new TextSpacingPlaywrightAdaptor(page),
	}),
};

function auditIds(result: AuditRunnerResult): Set<string> {
	const buckets = [result.violations, result.incomplete, result.passes, result.inapplicable];

	return new Set(buckets.flat().map((audit: Result) => audit.id));
}

function find(results: Result[], id: string): Result | undefined {
	return results.find((audit) => audit.id === id);
}

describeEachEngine<AuditAdaptors>(
	"runAllAudits (integration)",
	{
		adaptor: adaptors,
		screenshotClipScale: 2,
		viewport: { width: 1280, height: 800 },
		unsupported: {
			"playwright-webkit": WEBKIT_PARTIAL_TAB_LOOP,
		},
	},
	(engine) => {
		it("reports every audit in axe-core's buckets and leaves the page restored", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/kitchen-sink.html`);

			const result = await runAllAudits(page.adaptor, {
				focusAppearance: { skipStyleCheck: true },
			});

			expect(result.url).toBe(`${server.url}/kitchen-sink.html`);
			expect(result.testEngine.name).toBe("axe-core");

			const ids = auditIds(result);
			expect(ids).toContain(FOCUS_APPEARANCE_AUDIT_ID);
			expect(ids).toContain(FOCUS_NOT_OBSCURED_AUDIT_ID);
			expect(ids).toContain(SKIP_LINK_AUDIT_ID);
			expect(ids).toContain(TEXT_SPACING_AUDIT_ID);
			expect(ids).toContain(REFLOW_AUDIT_ID);

			// axe-core's own rules report alongside the A11y Pulse audits.
			expect(result.passes.some((audit) => audit.id === "document-title")).toBe(true);

			expect(find(result.violations, REFLOW_AUDIT_ID)?.nodes[0]?.target).toEqual(["#wide"]);
			expect(find(result.passes, SKIP_LINK_AUDIT_ID)?.nodes).toHaveLength(1);

			expect(page.viewportSize()).toMatchObject({ width: 1280, height: 800 });
			await page.close();
		});

		it("tabs the page once for all three tab-driven audits", async () => {
			const page = await engine.newPage();

			await page.goto(`${server.url}/kitchen-sink.html`);

			const result = await runAllAudits(page.adaptor, {
				focusAppearance: { skipStyleCheck: true },
			});

			const nodeCount = (id: string): number =>
				[result.violations, result.incomplete, result.passes]
					.flat()
					.filter((audit) => audit.id === id)
					.reduce((total, audit) => total + audit.nodes.length, 0);

			const stops = nodeCount(FOCUS_NOT_OBSCURED_AUDIT_ID);
			expect(nodeCount(FOCUS_APPEARANCE_AUDIT_ID)).toBe(stops);

			const tabs = page.keyPresses.filter((key) => key === "Tab").length;
			const skipLinkTabs = tabs - stops - 1;
			expect(skipLinkTabs).toBeLessThanOrEqual(3);

			await page.close();
		});

		it("serialises screenshot evidence as base64", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/kitchen-sink.html`);

			const result = await runAllAudits(page.adaptor, {
				focusAppearance: { skipStyleCheck: true },
			});
			const parsed = JSON.parse(toJson(result)) as AuditRunnerResult;

			const obscured = find(parsed.violations, FOCUS_NOT_OBSCURED_AUDIT_ID);
			const screenshot = obscured?.nodes[0]?.any[0]?.data.screenshot;

			expect(typeof screenshot).toBe("string");
			expect(Buffer.from(screenshot, "base64").subarray(0, 4)).toEqual(
				Buffer.from([0x89, 0x50, 0x4e, 0x47]),
			);

			await page.close();
		});
	},
);
