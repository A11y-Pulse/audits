import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	type AdaptorFactories,
	describeEachEngine,
	type FixtureServer,
	startFixtureServer,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	type OrphanedTabRolesElement,
	type OrphanedTabRolesResult,
	runOrphanedTabRolesAudit,
} from "../../src/index";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

const adaptors: AdaptorFactories<BrowserAdaptor> = {
	puppeteer: (page) => new PuppeteerAdaptor(page),
	playwright: (page) => new PlaywrightAdaptor(page),
};

function findings(elements: readonly OrphanedTabRolesElement[]) {
	return elements.map(({ selector, finding }) => ({ selector, finding }));
}

describeEachEngine<BrowserAdaptor>(
	"orphaned tab roles audit (integration)",
	{ adaptor: adaptors },
	(engine) => {
		async function runFixture(name: string): Promise<OrphanedTabRolesResult> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);

				return await runOrphanedTabRolesAudit(page.adaptor);
			} finally {
				await page.close();
			}
		}

		it("passes a wired tab widget, hidden panels included", async () => {
			const result = await runFixture("tabs-explicit.html");

			expect(result.summary).toEqual({ checked: 4, failed: 0, needsReview: 0, passed: 4 });
		});

		it("never fails tabs whose panels are mounted lazily", async () => {
			const result = await runFixture("tabs-lazy-mount.html");

			expect(result.failed).toEqual([]);
			expect(findings(result.needsReview)).toEqual([
				{ selector: "#tab-large", finding: "association-unverifiable" },
			]);
		});

		it("fails navigation links with tab roles and reviews the decoy panels", async () => {
			const result = await runFixture("tabs-nav-links.html");

			expect(findings(result.failed)).toEqual([
				{ selector: "#nav-men", finding: "tab-used-as-link" },
				{ selector: "#nav-women", finding: "tab-used-as-link" },
				{ selector: "#nav-kids", finding: "tab-used-as-link" },
			]);
			expect(result.needsReview.map((element) => element.selector)).toEqual([
				"#decoy-1",
				"#decoy-2",
			]);
		});

		it("checks nothing once the navigation drops its tab roles", async () => {
			const result = await runFixture("nav-links.html");

			expect(result.summary.checked).toBe(0);
		});

		it("does not treat fragment tab anchors as navigation", async () => {
			const result = await runFixture("tabs-fragment-links.html");

			expect(result.failed).toEqual([]);
		});

		it("fails tabs on a page with no tab panels", async () => {
			const result = await runFixture("tabs-no-panels.html");

			expect(findings(result.failed)).toEqual([
				{ selector: "#tab-shipping", finding: "tab-without-panel" },
				{ selector: "#tab-returns", finding: "tab-without-panel" },
			]);
		});

		it("fails a tab panel on a page with no tabs, and stops once it is a region", async () => {
			const orphan = await runFixture("orphan-tabpanel.html");
			const fixed = await runFixture("orphan-tabpanel-fixed.html");

			expect(findings(orphan.failed)).toEqual([
				{ selector: "#orphan", finding: "tabpanel-without-tab" },
			]);
			expect(fixed.summary.checked).toBe(0);
		});

		it("fails an unwired widget whose page's panels all belong to another widget", async () => {
			const result = await runFixture("multiple-widgets.html");

			expect(findings(result.failed)).toEqual([
				{ selector: "#policy-shipping", finding: "tab-without-panel" },
				{ selector: "#policy-returns", finding: "tab-without-panel" },
			]);
			expect(result.summary.passed).toBe(4);
		});

		it("reviews tabs and panels that declare no association", async () => {
			const result = await runFixture("implicit-widget.html");

			expect(result.summary).toMatchObject({ failed: 0, needsReview: 4 });
		});

		it("passes tabs wired to the wrong panels, which it does not judge", async () => {
			const result = await runFixture("wrong-pairing.html");

			expect(result.summary).toMatchObject({ failed: 0, needsReview: 0, passed: 4 });
		});

		it("reviews a tab that controls a region instead of a tab panel", async () => {
			const result = await runFixture("controls-region.html");

			expect(result.failed).toEqual([]);
			expect(findings(result.needsReview)).toEqual([
				{ selector: "#tab-a", finding: "controls-not-a-tabpanel" },
				{ selector: "#panel-elsewhere", finding: "association-unverifiable" },
			]);
		});

		it("checks nothing on a page with no tab roles, and leaves nothing behind", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/no-tabs.html`);
				const result = await runOrphanedTabRolesAudit(page.adaptor);
				const leftover = await page.adaptor.evaluate(() =>
					Object.keys(window).filter((key) => key.startsWith("__a11yPulse")),
				);

				expect(result.summary.checked).toBe(0);
				expect(leftover).toEqual([]);
			} finally {
				await page.close();
			}
		});
	},
);
