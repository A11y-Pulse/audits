import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	type AdaptorFactories,
	describeEachEngine,
	type EnginePage,
	type FixtureServer,
	isPng,
	startFixtureServer,
	WEBKIT_PARTIAL_TAB_LOOP,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import {
	type ContextChangeFinding,
	type ContextChangeOnFocusOptions,
	type ContextChangeOnFocusResult,
	runContextChangeOnFocusAudit,
} from "../../src/index";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

/** Every element checked, in tab order, with the kinds of finding attached to it. */
function kindsBySelector(result: ContextChangeOnFocusResult): Array<[string, string[]]> {
	return result.elements.map((element) => [
		element.selector,
		element.findings.map((finding) => finding.kind),
	]);
}

function findingsFor(result: ContextChangeOnFocusResult, selector: string): ContextChangeFinding[] {
	const matches = result.elements.filter((element) => element.selector === selector);

	expect(matches, `one result for ${selector}`).toHaveLength(1);

	return matches[0]?.findings ?? [];
}

function expectScreenshotsOnlyWithFindings(result: ContextChangeOnFocusResult) {
	for (const element of result.elements) {
		if (element.findings.length === 0) {
			expect(element.screenshot).toBeUndefined();
			continue;
		}

		expect(isPng(element.screenshot)).toBe(true);
	}
}

/** Whether the browser lets a script-initiated navigation be cancelled, and so attributed. */
function canCancelNavigation(): boolean {
	return "navigation" in window;
}

/** What a page left alone answers: whether opening windows and submitting forms work again. */
function interceptionLeftBehind(): { open: boolean; formSubmit: boolean; submitEvent: boolean } {
	const form = document.createElement("form");
	const event = new Event("submit", { bubbles: true, cancelable: true });

	document.body.append(form);
	form.dispatchEvent(event);
	form.remove();

	return {
		open: !/\[native code\]/.test(Function.prototype.toString.call(window.open)),
		formSubmit: !/\[native code\]/.test(
			Function.prototype.toString.call(HTMLFormElement.prototype.submit),
		),
		submitEvent: event.defaultPrevented,
	};
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

		it("flags window.open on the element that called it and prevents a real popup", async () => {
			let popupOpened = false;
			const page = await engine.newPage();
			page.onPopup(() => {
				popupOpened = true;
			});
			await page.goto(`${server.url}/new-window-on-focus.html`);

			try {
				const result = await runContextChangeOnFocusAudit(page.adaptor);

				expect(kindsBySelector(result)).toEqual([
					["#popup", ["new-window"]],
					["#other", []],
				]);
				expect(findingsFor(result, "#popup")).toEqual([
					{ kind: "new-window", bucket: "violation", url: "/x" },
				]);
				expectScreenshotsOnlyWithFindings(result);

				// The orchestrator's window.open interception should prevent a real popup from ever
				// firing; give one a moment to show up.
				await new Promise((resolve) => setTimeout(resolve, 500));
				expect(popupOpened).toBe(false);
			} finally {
				await page.close();
			}
		});

		it("flags requestSubmit on focus, names the form, and prevents the navigation", async () => {
			const { result, page } = await runFixture("auto-submit-on-focus.html");

			try {
				expect(kindsBySelector(result)).toEqual([
					["#auto", ["auto-submit"]],
					["#other", []],
				]);
				expect(findingsFor(result, "#auto")).toEqual([
					{
						kind: "auto-submit",
						bucket: "violation",
						form: {
							selector: "#f",
							html: '<form id="f" action="/submit" method="get">',
							action: `${server.url}/submit`,
						},
					},
				]);
				expectScreenshotsOnlyWithFindings(result);
				expect(page.url()).toBe(`${server.url}/auto-submit-on-focus.html`);
			} finally {
				await page.close();
			}
		});

		it("flags form.submit() on focus, which fires no submit event", async () => {
			const { result, page } = await runFixture("form-submit.html");

			try {
				expect(kindsBySelector(result)).toEqual([
					["#email", []],
					["#postcode", ["auto-submit"]],
					["#terms", []],
				]);
				expect(findingsFor(result, "#postcode")[0]?.form).toEqual({
					selector: "#signup",
					html: '<form id="signup" action="/subscribe" method="post">',
					action: `${server.url}/subscribe`,
				});
				expect(page.url()).toBe(`${server.url}/form-submit.html`);
			} finally {
				await page.close();
			}
		});

		it("flags focus being removed (blurred) on the element that dropped it", async () => {
			const { result, page } = await runFixture("focus-removal.html");

			try {
				expect(kindsBySelector(result)).toEqual([
					["#blurred", ["focus-removed"]],
					["#other", []],
				]);
				expect(findingsFor(result, "#blurred")).toEqual([
					{ kind: "focus-removed", bucket: "violation" },
				]);
				expectScreenshotsOnlyWithFindings(result);
			} finally {
				await page.close();
			}
		});

		it("reports focus theft against the element that stole it, not the one it went to", async () => {
			const { result, page } = await runFixture("focus-theft.html");

			try {
				// #victim is where focus ended up; it did nothing wrong and is not a result of its own.
				expect(kindsBySelector(result)).toEqual([["#thief", ["focus-redirected-outside"]]]);
				expect(result.elements[0]?.html).toContain('id="thief"');
				expect(findingsFor(result, "#thief")).toEqual([
					{
						kind: "focus-redirected-outside",
						bucket: "violation",
						redirectedTo: { selector: "#victim", html: '<input id="victim">' },
					},
				]);
				expectScreenshotsOnlyWithFindings(result);
			} finally {
				await page.close();
			}
		});

		it("reports same-subtree delegation for review, against the delegating element", async () => {
			const { result, page } = await runFixture("focus-delegation.html");

			try {
				expect(kindsBySelector(result)).toEqual([
					["#wrap", ["focus-redirected-same-subtree"]],
					['a[href="#end"]', []],
				]);
				expect(findingsFor(result, "#wrap")).toEqual([
					{
						kind: "focus-redirected-same-subtree",
						bucket: "incomplete",
						redirectedTo: { selector: "#inner", html: '<input id="inner">' },
					},
				]);
				expect(result.summary.failed).toBe(0);
			} finally {
				await page.close();
			}
		});

		it("does not report a dialog's focus guards", async () => {
			const { result, page } = await runFixture("focus-guard.html");

			try {
				// The guard before #name hands focus to it; the one after #cancel wraps back to it,
				// which ends the session on a revisit.
				expect(kindsBySelector(result)).toEqual([
					["#open", []],
					["#name", []],
					["#save", []],
					["#cancel", []],
				]);
				expect(result.summary).toMatchObject({ checked: 4, failed: 0, sessionEnd: "completed" });
			} finally {
				await page.close();
			}
		});

		it("reports a hash change and a pushState once each, with the URLs", async () => {
			const { result, page } = await runFixture("soft-url.html");

			try {
				expect(kindsBySelector(result)).toEqual([
					["#home", []],
					["#details", ["url-changed"]],
					["#reviews", ["url-changed"]],
					["#quantity", []],
					["#buy", []],
				]);
				expect(findingsFor(result, "#details")).toEqual([
					{
						kind: "url-changed",
						bucket: "incomplete",
						from: `${server.url}/soft-url.html`,
						to: `${server.url}/soft-url.html#details`,
					},
				]);
				expect(findingsFor(result, "#reviews")).toEqual([
					{
						kind: "url-changed",
						bucket: "incomplete",
						from: `${server.url}/soft-url.html#details`,
						to: `${server.url}/soft-url.html?tab=reviews`,
					},
				]);
				expect(result.summary.sessionEnd).toBe("completed");
			} finally {
				await page.close();
			}
		});

		it("ignores replaceState calls that leave the URL as it is", async () => {
			const { result, page } = await runFixture("scroll-spy.html");

			try {
				expect(kindsBySelector(result)).toEqual([
					["#skip", ["url-changed"]],
					["#intro", []],
					["#install", []],
					["#usage", []],
				]);
			} finally {
				await page.close();
			}
		});

		it("puts a change made by a timer down to the element that set it", async () => {
			const { result, page } = await runFixture("async-change.html");

			try {
				const withFindings = kindsBySelector(result).filter(([, kinds]) => kinds.length > 0);

				expect(withFindings).toEqual([
					["#quick", ["new-window"]],
					["#slow", ["new-window"]],
				]);
				// A 5ms timer usually runs while its own stop is still settling, and occasionally just
				// after; either way it is #quick's, so only the `delayed` flag may differ.
				expect(findingsFor(result, "#quick")).toHaveLength(1);
				expect(findingsFor(result, "#quick")[0]).toMatchObject({
					kind: "new-window",
					bucket: "violation",
					url: "/quick-offer",
				});
				// Focus was fields further on by the time this one opened its window.
				expect(findingsFor(result, "#slow")).toEqual([
					{ kind: "new-window", bucket: "violation", url: "/slow-offer", delayed: true },
				]);
				expect(result.elements).toHaveLength(42);
				expect(result.summary).toMatchObject({ checked: 42, failed: 2 });
			} finally {
				await page.close();
			}
		});

		it("flags a native dialog raised on focus", async () => {
			const { result, page } = await runFixture("dialog-on-focus.html");

			try {
				expect(kindsBySelector(result)).toEqual([
					["#name", []],
					["#card", ["dialog"]],
					["#expiry", []],
				]);
				expect(findingsFor(result, "#card")).toEqual([{ kind: "dialog", bucket: "violation" }]);
			} finally {
				await page.close();
			}
		});

		// Where the browser lets a script's navigation be cancelled, the observer cancels it and the
		// element that asked for it is still there to be named. Elsewhere the document is gone before
		// anything can be read from it, and all that can be said is which element came before.
		it("attributes a navigation on focus to the element that triggered it", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/navigation-on-focus.html`);

			try {
				const cancellable = await page.adaptor.evaluate(canCancelNavigation);
				const result = await runContextChangeOnFocusAudit(page.adaptor);

				if (cancellable) {
					expect(kindsBySelector(result)).toEqual([
						["#safe", []],
						["#boom", ["navigation"]],
					]);
					expect(findingsFor(result, "#boom")).toEqual([
						{ kind: "navigation", bucket: "violation", url: `${server.url}/other-page.html` },
					]);
					expect(result.navigation).toBeUndefined();
					expect(result.summary.sessionEnd).toBe("completed");
					expect(page.url()).toBe(`${server.url}/navigation-on-focus.html`);
					expectScreenshotsOnlyWithFindings(result);
				} else {
					expect(kindsBySelector(result)).toEqual([["#safe", []]]);
					expect(result.navigation).toEqual({
						after: { selector: "#safe", html: '<a href="#safe" id="safe">' },
						url: `${server.url}/other-page.html`,
					});
					expect(result.summary.sessionEnd).toBe("navigation");
				}
			} finally {
				await page.close();
			}
		});

		it("leaves the page opening windows and submitting forms as before", async () => {
			for (const fixture of ["new-window-on-focus.html", "form-submit.html"]) {
				const { page } = await runFixture(fixture);

				try {
					expect(await page.adaptor.evaluate(interceptionLeftBehind)).toEqual({
						open: false,
						formSubmit: false,
						submitEvent: false,
					});
				} finally {
					await page.close();
				}
			}
		});

		it("reports an empty element that throws focus somewhere unrelated, guard or not", async () => {
			const { result, page } = await runFixture("empty-redirector.html");

			try {
				// #catcher sends focus back to #search, so #basket after it is never reached and the
				// session ends on revisiting #deals.
				expect(kindsBySelector(result)).toEqual([
					["#search", []],
					["#deals", []],
					["#catcher", ["focus-redirected-outside"]],
				]);
				expect(findingsFor(result, "#catcher")).toEqual([
					{
						kind: "focus-redirected-outside",
						bucket: "violation",
						redirectedTo: { selector: "#search", html: '<input id="search" type="search">' },
					},
				]);
				expect(result.summary.failed).toBe(1);
			} finally {
				await page.close();
			}
		});

		it("does not report unmarked focus guards that sit beside the dialog they serve", async () => {
			const { result, page } = await runFixture("focus-guard-unmarked.html");

			try {
				expect(kindsBySelector(result)).toEqual([
					["#open", []],
					["#confirm", []],
					["#cancel", []],
				]);
				expect(result.summary).toMatchObject({ checked: 3, failed: 0, sessionEnd: "completed" });
			} finally {
				await page.close();
			}
		});

		// What a page does on a schedule of its own is not the doing of whichever link happens to be
		// focused when the schedule comes round.
		for (const background of [
			{
				name: "a session-expiry redirect set before the session",
				start: "startExpiryCountdown(250)",
				navigates: true,
			},
			{
				name: "a redirect counted down on an interval",
				start: "startExpiryInterval(4)",
				navigates: true,
			},
			{
				name: "a poll loop that re-arms itself and later opens a window",
				start: "startPolling(5)",
				navigates: false,
			},
			{
				name: "an alert raised on a schedule",
				start: "startWarningCountdown(250)",
				navigates: false,
			},
		]) {
			it(`blames no element for ${background.name}`, async () => {
				const page = await engine.newPage();
				await page.goto(`${server.url}/background-timers.html`);

				try {
					const cancellable = await page.adaptor.evaluate(canCancelNavigation);

					if (background.navigates && !cancellable) {
						// The redirect goes ahead and ends the session; there is nothing to attribute.
						return;
					}

					await page.adaptor.evaluate((source: string) => {
						new Function(source)();
					}, background.start);

					const result = await runContextChangeOnFocusAudit(page.adaptor);

					expect(result.elements).toHaveLength(40);
					expect(kindsBySelector(result).filter(([, kinds]) => kinds.length > 0)).toEqual([]);
					expect(result.summary).toMatchObject({ checked: 40, failed: 0 });
					expect(result.unattributed).toEqual([
						background.navigates
							? { kind: "navigation", bucket: "incomplete", url: `${server.url}/other-page.html` }
							: background.start.startsWith("startPolling")
								? { kind: "new-window", bucket: "incomplete", url: "/promotion" }
								: { kind: "dialog", bucket: "incomplete" },
					]);
					expect(page.url()).toBe(`${server.url}/background-timers.html`);
				} finally {
					await page.close();
				}
			});
		}

		it("blames no element for a dialog the page raised before the session", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/dialog-on-focus.html`);

			try {
				// Puppeteer leaves the dialog open, so this call does not return until the session
				// dismisses it; Playwright dismisses it at once, nothing listening for dialogs.
				const raised = page.adaptor.evaluate(() => {
					alert("Welcome back");
				});
				await Promise.race([raised, new Promise((resolve) => setTimeout(resolve, 250))]);

				const result = await runContextChangeOnFocusAudit(page.adaptor);
				await raised;

				expect(kindsBySelector(result)).toEqual([
					["#name", []],
					["#card", ["dialog"]],
					["#expiry", []],
				]);
				expect(result.unattributed).toBeUndefined();
			} finally {
				await page.close();
			}
		});

		it("waits for a timer the last element set, and reports what it did there", async () => {
			const { result, page } = await runFixture("last-element-timer.html");

			try {
				expect(kindsBySelector(result)).toEqual([
					["#name", []],
					["#email", []],
					["#postcode", ["new-window"]],
				]);
				expect(findingsFor(result, "#postcode")).toEqual([
					{ kind: "new-window", bucket: "violation", url: "/late-offer", delayed: true },
				]);
				expect(result.summary).toMatchObject({ checked: 3, failed: 1, passed: 2 });
			} finally {
				await page.close();
			}
		});

		it("does not leave the last element's navigation to happen after the session", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/last-element-timer.html?do=navigate`);

			try {
				if (!(await page.adaptor.evaluate(canCancelNavigation))) {
					return;
				}

				const result = await runContextChangeOnFocusAudit(page.adaptor);

				expect(findingsFor(result, "#postcode")).toEqual([
					{
						kind: "navigation",
						bucket: "violation",
						url: `${server.url}/other-page.html`,
						delayed: true,
					},
				]);

				// Long enough for the half-second timer to have fired had the session not waited.
				await new Promise((resolve) => setTimeout(resolve, 700));
				expect(page.url()).toBe(`${server.url}/last-element-timer.html?do=navigate`);
			} finally {
				await page.close();
			}
		});

		it("leaves no trace in a page that wrapped setTimeout again during the session", async () => {
			const { result, page } = await runFixture("rewrapped-timers.html");

			try {
				expect(kindsBySelector(result)).toEqual([
					["#home", []],
					["#reports", []],
					["#settings", []],
				]);

				const after = await page.adaptor.evaluate(async () => {
					const before = (window as unknown as { timersSeen: number }).timersSeen;

					await new Promise((resolve) => setTimeout(resolve, 10));

					return {
						// The page's own wrapper is still in place and still sees every timer.
						pageWrapperWorks: (window as unknown as { timersSeen: number }).timersSeen > before,
						globals: Object.keys(window).filter((key) => key.startsWith("__a11y")),
					};
				});

				expect(after).toEqual({ pageWrapperWorks: true, globals: [] });
			} finally {
				await page.close();
			}
		});

		it("stops at its timeout and reports what it had checked by then", async () => {
			// 42 fields take well over the timeout to tab through.
			const { result, page } = await runFixture("async-change.html", { timeout: 100 });

			try {
				expect(result.summary.timedOut).toBe(true);
				expect(result.summary.sessionEnd).toBeNull();
				expect(result.elements.length).toBeGreaterThan(0);
				expect(result.elements.length).toBeLessThan(42);
				expect(result.summary.checked).toBe(result.elements.length);
			} finally {
				await page.close();
			}
		});

		it("lets the page navigate again once the session is over", async () => {
			const { page } = await runFixture("navigation-on-focus.html");

			try {
				// Whether or not the audit's own pass navigated, a navigation asked for now goes ahead.
				await page.goto(`${server.url}/navigation-on-focus.html`);
				await runContextChangeOnFocusAudit(page.adaptor, { elementLimit: 1 });
				await page.adaptor.evaluate(() => {
					location.assign("/other-page.html");
				});

				await expect
					.poll(() => page.url(), { timeout: 5000 })
					.toBe(`${server.url}/other-page.html`);
			} finally {
				await page.close();
			}
		});
	},
);
