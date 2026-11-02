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
	runSuspiciousNameAudit,
	type SuspiciousNameElement,
	type SuspiciousNameResult,
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

function selectors(elements: readonly SuspiciousNameElement[]): string[] {
	return elements.map(({ selector }) => selector);
}

describeEachEngine<BrowserAdaptor>(
	"suspicious accessible name audit (integration)",
	{ adaptor: adaptors },
	(engine) => {
		async function runFixture(name: string): Promise<SuspiciousNameResult> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);

				return await runSuspiciousNameAudit(page.adaptor);
			} finally {
				await page.close();
			}
		}

		it("fails a name copied from the class and passes a real one", async () => {
			const result = await runFixture("identifier-class.html");

			expect(result.failed).toMatchObject([
				{
					selector: "#copied",
					role: "spinbutton",
					signal: "attribute-match",
					evidence: "class",
					criterion: "2.4.6",
				},
			]);
			expect(selectors(result.passed)).toEqual(["#named"]);
		});

		it("fails template tokens and script values but not visible text", async () => {
			const result = await runFixture("template-token.html");

			expect(result.failed).toMatchObject([
				{ selector: "#frame", role: "iframe", signal: "artefact", criterion: "1.1.1" },
				{ selector: "#icon-button", signal: "artefact", criterion: "1.1.1" },
			]);
			expect(selectors(result.passed)).toEqual(["#visible-undefined"]);
		});

		it("reviews a numbered placeholder and fails a bare one", async () => {
			const result = await runFixture("placeholder-suffix.html");

			expect(result.needsReview).toMatchObject([
				{ selector: "#numbered", signal: "placeholder-suffix" },
			]);
			expect(result.failed).toMatchObject([{ selector: "#bare", signal: "artefact" }]);
			expect(selectors(result.passed)).toEqual(["#formula"]);
		});

		it("passes brand and product names shaped like identifiers", async () => {
			const result = await runFixture("brand-names.html");

			expect(result.summary).toMatchObject({ checked: 6, failed: 0, needsReview: 0, passed: 6 });
		});

		it("reviews names that repeat the role and passes visible text", async () => {
			const result = await runFixture("role-word.html");

			expect(result.needsReview).toMatchObject([
				{ selector: "#disclaimer", signal: "role-word", evidence: "button", criterion: null },
				{ selector: "#custom-checkbox", signal: "role-word", evidence: "checkbox" },
			]);
			expect(selectors(result.passed)).toEqual(["#open-menu", "#report"]);
		});

		it("matches role words in the element's language", async () => {
			const result = await runFixture("role-word-swedish.html");

			expect(result.needsReview).toMatchObject([{ selector: "#close", evidence: "knapp" }]);
			expect(selectors(result.passed)).toEqual(["#english"]);
		});

		it("passes a plain word that is also the id", async () => {
			const result = await runFixture("same-id-same-name.html");

			expect(result.summary).toMatchObject({ failed: 0, needsReview: 0 });
			expect(selectors(result.passed)).toEqual(["#search", "#footer", "#home"]);
		});

		it("checks nothing on a page with no named controls", async () => {
			const result = await runFixture("no-controls.html");

			expect(result.summary.checked).toBe(0);
		});
	},
);
