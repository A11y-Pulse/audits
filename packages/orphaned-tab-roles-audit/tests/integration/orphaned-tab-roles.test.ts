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

		it("passes tabs whose panels are mounted lazily, beside a wired tab in the tablist", async () => {
			const result = await runFixture("tabs-lazy-mount.html");

			expect(result.summary).toEqual({ checked: 3, failed: 0, needsReview: 0, passed: 3 });
		});

		it("passes React Aria style tabs, where only the selected tab has aria-controls", async () => {
			const result = await runFixture("react-aria-tabs.html");

			expect(result.summary).toEqual({ checked: 4, failed: 0, needsReview: 0, passed: 4 });
			expect(result.passed.map(({ selector, tablist }) => ({ selector, tablist }))).toEqual([
				{ selector: "#react-aria-1-tab-details", tablist: "#product-tabs" },
				{ selector: "#react-aria-1-tab-sizing", tablist: "#product-tabs" },
				{ selector: "#react-aria-1-tab-reviews", tablist: "#product-tabs" },
				{ selector: "#react-aria-1-tabpanel-details", tablist: undefined },
			]);
		});

		it("passes Radix style tabs, where inactive panels are unmounted", async () => {
			const result = await runFixture("radix-tabs.html");

			expect(result.summary).toEqual({ checked: 4, failed: 0, needsReview: 0, passed: 4 });
			expect(result.passed[1]).toMatchObject({
				selector: "#radix-r0-trigger-password",
				controls: [{ id: "radix-r0-content-password", found: false, role: null, tag: null }],
			});
		});

		it("passes MUI and Bootstrap style tabs, where every panel stays mounted", async () => {
			const mui = await runFixture("mui-tabs.html");
			const bootstrap = await runFixture("bootstrap-tabs.html");

			expect(mui.summary).toEqual({ checked: 6, failed: 0, needsReview: 0, passed: 6 });
			expect(bootstrap.summary).toEqual({ checked: 6, failed: 0, needsReview: 0, passed: 6 });
			expect(bootstrap.passed[0]).toMatchObject({ selector: "#home-tab", tablist: "#myTab" });
		});

		it("still fails an unwired tablist beside a lazily mounted one", async () => {
			const result = await runFixture("lazy-beside-unwired.html");

			expect(findings(result.failed)).toEqual([
				{ selector: "#filter-all", finding: "tab-without-panel" },
				{ selector: "#filter-recent", finding: "tab-without-panel" },
			]);
			expect(result.failed.map(({ tablist }) => tablist)).toEqual(["#filter-tabs", "#filter-tabs"]);
			expect(result.summary).toEqual({ checked: 5, failed: 2, needsReview: 0, passed: 3 });
		});

		it("fails the tabs left without a panel when every panel is labelled by the first tab", async () => {
			const result = await runFixture("panels-share-one-tab.html");

			expect(findings(result.failed)).toEqual([
				{ selector: "#tab-2", finding: "tab-without-panel" },
				{ selector: "#tab-3", finding: "tab-without-panel" },
			]);
			expect(result.summary).toEqual({ checked: 6, failed: 2, needsReview: 0, passed: 4 });
		});

		it("fails unwired tabs beside one wired tab when no tab is selected", async () => {
			const result = await runFixture("one-wired-none-selected.html");

			expect(findings(result.failed)).toEqual([
				{ selector: "#tab-prices", finding: "tab-without-panel" },
				{ selector: "#tab-map", finding: "tab-without-panel" },
			]);
			expect(result.summary).toEqual({ checked: 4, failed: 2, needsReview: 0, passed: 2 });
		});

		it("judges a nested tablist on its own tabs, not its parent's", async () => {
			const result = await runFixture("nested-tablists.html");

			expect(findings(result.failed)).toEqual([
				{ selector: "#inner-display", finding: "tab-without-panel" },
				{ selector: "#inner-input", finding: "tab-without-panel" },
			]);
			expect(result.failed.map(({ tablist }) => tablist)).toEqual(["#inner-tabs", "#inner-tabs"]);
			expect(result.passed.map(({ selector }) => selector)).toEqual([
				"#outer-general",
				"#outer-privacy",
				"#outer-panel-general",
			]);
		});

		it("passes both copies of a widget rendered twice with one copy hidden", async () => {
			const result = await runFixture("hidden-duplicate-widget.html");

			expect(result.summary).toEqual({ checked: 6, failed: 0, needsReview: 0, passed: 6 });
		});

		it("reports where a tab inside a navigation link goes", async () => {
			const result = await runFixture("tab-inside-link.html");

			expect(
				result.failed.map(({ selector, finding, tablist, href }) => ({
					selector,
					finding,
					tablist,
					href,
				})),
			).toEqual([
				{
					selector: "#nav-dogs",
					finding: "tab-used-as-link",
					tablist: "#section-nav",
					href: `${server.url}/dogs?sort=new`,
				},
				{
					selector: "#nav-cats",
					finding: "tab-used-as-link",
					tablist: "#section-nav",
					href: "https://elsewhere.test/cats",
				},
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

		it("fails an unwired tablist whose page's panels all belong to another tablist", async () => {
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
			expect(result.needsReview[0]?.controls).toEqual([
				{ id: "region-a", found: true, role: "region", tag: "div" },
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
