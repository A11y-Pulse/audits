import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	type AdaptorFactories,
	describeEachEngine,
	type EnginePage,
	WEBKIT_PARTIAL_TAB_LOOP,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	type ContextChangeOnFocusOptions,
	type ContextChangeOnFocusResult,
	runContextChangeOnFocusAudit,
} from "../../src/index";
import { type FixtureServer, startFixtureServer } from "./helpers/serve-fixtures";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer();
});

afterAll(async () => {
	await server.close();
});

function findings(result: ContextChangeOnFocusResult) {
	return result.elements.flatMap((element) => element.findings);
}

const adaptors: AdaptorFactories<BrowserAdaptor> = {
	puppeteer: (page) => new PuppeteerAdaptor(page),
	playwright: (page) => new PlaywrightAdaptor(page),
};

describeEachEngine<BrowserAdaptor>(
	"context change on focus audit (integration)",
	{
		adaptor: adaptors,
		screenshotClipScale: 2,
		unsupported: {
			"playwright-webkit": WEBKIT_PARTIAL_TAB_LOOP,
		},
	},
	(engine) => {
		async function runFixture(
			name: string,
			options?: ContextChangeOnFocusOptions,
		): Promise<{ result: ContextChangeOnFocusResult; page: EnginePage<BrowserAdaptor> }> {
			const page = await engine.newPage();
			await page.goto(`${server.url}/${name}`);

			const result = await runContextChangeOnFocusAudit(page.adaptor, options);

			return { result, page };
		}

		it("flags window.open on focus and prevents a real popup", async () => {
			let popupOpened = false;
			const page = await engine.newPage();
			page.onPopup(() => {
				popupOpened = true;
			});
			await page.goto(`${server.url}/new-window-on-focus.html`);

			try {
				const result = await runContextChangeOnFocusAudit(page.adaptor);

				expect(
					findings(result).some(
						(finding) => finding.kind === "new-window" && finding.bucket === "violation",
					),
				).toBe(true);

				// Race the popup event against a short timeout: the orchestrator's window.open interception
				// (installContextObserverScript) should prevent a real popup from ever firing.
				const raced = await Promise.race([
					new Promise<boolean>((resolve) => setTimeout(() => resolve(popupOpened), 500)),
				]);
				expect(raced).toBe(false);
			} finally {
				await page.close();
			}
		});

		it("flags requestSubmit on focus and prevents the actual navigation", async () => {
			const { result, page } = await runFixture("auto-submit-on-focus.html");

			try {
				expect(
					findings(result).some(
						(finding) => finding.kind === "auto-submit" && finding.bucket === "violation",
					),
				).toBe(true);

				// The orchestrator's capture-phase submit listener prevents the form from actually
				// submitting/navigating away.
				expect(page.url()).toContain("auto-submit-on-focus.html");
			} finally {
				await page.close();
			}
		});

		// Previously a KNOWN GAP: the tab-orchestrator's "done tabbing" exit used to run before context
		// signals were drained for a stop, so `focus-removal.html`'s self-blurring element was
		// indistinguishable from genuinely running out of focusable elements. Fixed by 08867a8 and
		// 02bbefe, which notify consumers of F55 focus-removal before the isBody session-end exit.
		it("flags focus being removed (blurred) on focus", async () => {
			const { result, page } = await runFixture("focus-removal.html");

			try {
				expect(
					findings(result).some(
						(finding) => finding.kind === "focus-removed" && finding.bucket === "violation",
					),
				).toBe(true);
			} finally {
				await page.close();
			}
		});

		it("flags focus theft redirected outside the intended element's subtree", async () => {
			const { result, page } = await runFixture("focus-theft.html");

			try {
				expect(
					findings(result).some(
						(finding) =>
							finding.kind === "focus-redirected-outside" && finding.bucket === "violation",
					),
				).toBe(true);
			} finally {
				await page.close();
			}
		});

		it("does not flag same-subtree focus delegation as a violation", async () => {
			const { result, page } = await runFixture("focus-delegation.html");

			try {
				const allFindings = findings(result);
				expect(allFindings.filter((finding) => finding.bucket === "violation")).toHaveLength(0);
				expect(allFindings.some((finding) => finding.kind === "focus-redirected-outside")).toBe(
					false,
				);
			} finally {
				await page.close();
			}
		});

		// A synchronous `location.assign` on focus usually completes before the orchestrator probes the
		// active element, and the new document's `document.activeElement` defaults to `<body>`, which is
		// indistinguishable from ordinary "done tabbing". The session end must therefore come from the
		// href diff, not from the probe.
		it("flags navigation triggered on focus and ends the session as navigation", async () => {
			const { result, page } = await runFixture("navigation-on-focus.html");

			try {
				expect(result.summary.sessionEnd).toBe("navigation");
				expect(findings(result).some((finding) => finding.kind === "navigation")).toBe(false);
			} finally {
				await page.close();
			}
		});

		// Known gap: the orchestrator's proactive href-diff check runs before the triggering stop's
		// snapshot is built, so no consumer's `onTabStop` fires for it and the navigation cannot be
		// attributed to an element. A `navigation` finding is only attributable in the narrower race
		// where the context-signal drain, rather than the href check, is what discovers the destroyed
		// execution context. `it.fails` keeps the suite green while making an orchestrator change that
		// starts attributing the finding fail loudly here.
		it.fails("attributes a navigation finding to the element that triggered it", async () => {
			const { result, page } = await runFixture("navigation-on-focus.html");

			try {
				expect(
					findings(result).some(
						(finding) => finding.kind === "navigation" && finding.bucket === "violation",
					),
				).toBe(true);
			} finally {
				await page.close();
			}
		});
	},
);
