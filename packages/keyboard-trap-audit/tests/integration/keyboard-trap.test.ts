import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	describeEachEngine,
	type FixtureServer,
	startFixtureServer,
	WEBKIT_NO_LINK_FOCUS,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import { runKeyboardTrapAudit } from "../../src/audit";
import type { KeyboardTrapResult } from "../../src/result";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

describeEachEngine<BrowserAdaptor>(
	"keyboard trap audit (integration)",
	{
		adaptor: {
			puppeteer: (page) => new PuppeteerAdaptor(page),
			playwright: (page) => new PlaywrightAdaptor(page),
		},
		unsupported: {
			"playwright-webkit": WEBKIT_NO_LINK_FOCUS,
		},
	},
	(engine) => {
		async function runFixture(name: string): Promise<KeyboardTrapResult> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);

				return await runKeyboardTrapAudit(page.adaptor);
			} finally {
				await page.close();
			}
		}

		it("passes a page whose tab order runs off the end", async () => {
			const result = await runFixture("no-trap.html");

			expect(result.outcome).toBe("no-cycle");
			expect(result.summary.checked).toBe(3);
		});

		it("reports a widget that cycles Tab and Shift+Tab and ignores Escape", async () => {
			const result = await runFixture("hard-trap.html");

			expect(result.outcome).toBe("trapped");
			expect(result.container?.selector).toBe("#widget");
			expect(result.ring.map((element) => element.selector)).toEqual(["#w1", "#w2"]);
			expect(result.excludedCount).toBe(2);
			expect(result.roundsAttempted).toBe(2);
			expect(result.dialog).toBeNull();
			expect(result.keysTried).toEqual(["Escape", "Shift+Tab", "ArrowDown", "Tab", "ArrowRight"]);
			expect(result.attempts[0]).toEqual({
				round: 1,
				key: "Escape",
				presses: 1,
				from: '<button id="w1">',
				landed: '<button id="w1">',
				exited: false,
			});
			expect(result.attempts[1]).toMatchObject({
				round: 1,
				key: "Shift+Tab",
				from: '<button id="w1">',
				exited: false,
				cancelled: true,
			});
		});

		it("ends the wait on Escape early when the page ignores the key", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/hard-trap.html`);
				const started = Date.now();
				const result = await runKeyboardTrapAudit(page.adaptor);

				expect(result.outcome).toBe("trapped");
				// Two rounds each waited a full second on Escape before.
				expect(Date.now() - started).toBeLessThan(2000);
			} finally {
				await page.close();
			}
		});

		it("gives up on the escape attempts when the timeout runs out", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/large-ring.html`);
				const result = await runKeyboardTrapAudit(page.adaptor, { timeout: 15_000 });

				// Every exit was tried within the time allowed: the verdict is not `timed-out`.
				expect(result.outcome).toBe("inconclusive");
				expect(result.inconclusiveReason).toBe("ring-sampled");
				expect(result.summary.timedOut).toBe(false);

				await page.goto(`${server.url}/modal-close-button-only.html`);
				const hurried = await runKeyboardTrapAudit(page.adaptor, { timeout: 150 });

				expect(hurried.outcome).toBe("inconclusive");
				expect(hurried.inconclusiveReason).toBe("timed-out");
				expect(hurried.summary.timedOut).toBe(true);
			} finally {
				await page.close();
			}
		});

		it("passes a forward-only cycle that Shift+Tab leaves", async () => {
			const result = await runFixture("shift-tab-exit.html");

			expect(result.outcome).toBe("escaped");
			expect(result.escapedVia).toBe("shift-tab");
		});

		it("passes a load-time modal that Escape closes", async () => {
			const result = await runFixture("modal-escape.html");

			expect(result.outcome).toBe("escaped");
			expect(result.escapedVia).toBe("escape-key");
			expect(result.container?.selector).toBe("#dialog");
			expect(result.attempts).toHaveLength(1);
			expect(result.attempts[0]).toMatchObject({ key: "Escape", exited: true });
		});

		it("waits for a modal that Escape closes only after an exit animation", async () => {
			const result = await runFixture("modal-escape-animated.html");

			expect(result.outcome).toBe("escaped");
			expect(result.escapedVia).toBe("escape-key");
		});

		it("resolves a trap whose elements have no ids", async () => {
			const result = await runFixture("hard-trap-no-ids.html");

			expect(result.outcome).toBe("trapped");
			expect(result.ring).toHaveLength(3);
			expect(result.container?.html).toBe('<div class="toolbar">');
		});

		it("sends for review a trap whose only exit is to the browser's own UI, which pulls focus back on the way in", async () => {
			const result = await runFixture("focusin-trap.html");

			expect(result.outcome).toBe("inconclusive");
			expect(result.inconclusiveReason).toBe("page-edge-only");
			expect(result.escapedVia).toBeNull();
			expect(result.container?.selector).toBe("#chat");
			expect(result.excludedCount).toBe(1);
			expect(result.attempts.filter((attempt) => attempt.pageEdge).map(({ key }) => key)).toEqual([
				"Shift+Tab",
				"Shift+Tab",
			]);
		});

		it("passes a forward-only cycle at the start of the page, which Shift+Tab leaves by the browser's own UI", async () => {
			const result = await runFixture("edge-exit.html");

			expect(result.outcome).toBe("escaped");
			expect(result.escapedVia).toBe("shift-tab");
			expect(result.attempts.at(-1)).toMatchObject({
				key: "Shift+Tab",
				pageEdge: true,
				exited: true,
			});
		});

		it("still sends the page-edge trap for review when the element outside it is re-rendered on every focus change", async () => {
			const result = await runFixture("focusin-trap-rerender.html");

			expect(result.outcome).toBe("inconclusive");
			expect(result.inconclusiveReason).toBe("page-edge-only");
			expect(result.escapedVia).toBeNull();
			expect(result.container?.selector).toBe("#chat");
		});

		it("closes what the element outside the ring opened when it was given focus, and leaves focus on nothing", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/edge-exit-search-panel.html`);
				const result = await runKeyboardTrapAudit(page.adaptor);
				const after = await page.adaptor.evaluate(() => ({
					suggestionsHidden: document.querySelector<HTMLElement>("#suggestions")?.hidden,
					search: document.querySelector<HTMLInputElement>("#search")?.value,
					active: document.activeElement?.tagName,
				}));

				expect(result.outcome).toBe("escaped");
				expect(result.escapedVia).toBe("shift-tab");
				expect(after).toEqual({ suggestionsHidden: true, search: "", active: "BODY" });
			} finally {
				await page.close();
			}
		});

		it("credits Escape when its handler closes the dialog only after a delay with nothing to show for it meanwhile", async () => {
			const result = await runFixture("modal-escape-delayed.html");

			expect(result.outcome).toBe("escaped");
			expect(result.escapedVia).toBe("escape-key");
			expect(result.keysTried).toEqual(["Escape"]);
			expect(result.attempts).toHaveLength(1);
			expect(result.attempts[0]).toMatchObject({ key: "Escape", exited: true });
		});

		it("tabs on through an iframe with 70 links and reaches the rest of the page", async () => {
			const result = await runFixture("iframe-many-links.html");

			expect(result.outcome).toBe("no-cycle");
			expect(result.summary.sessionEnd).toBe("completed");
			// The stops inside the frame are not this document's, so only the two links around it count.
			expect(result.summary.checked).toBe(2);
		});

		it("does not call a sampled ring a trap when an exit in the middle of it was never tried", async () => {
			const result = await runFixture("large-ring-mid-exit.html");

			expect(result.outcome).toBe("inconclusive");
			expect(result.inconclusiveReason).toBe("ring-sampled");
			expect(result.sampledRing).toBe(true);
			expect(result.ringSize).toBe(40);
			expect(result.container?.selector).toBe("#palette");
			expect(result.summary.failed).toBe(0);
		});

		it("reports a trap that pulls focus back from both directions", async () => {
			const result = await runFixture("focusin-trap-both-ways.html");

			expect(result.outcome).toBe("trapped");
			expect(result.container?.selector).toBe("#chat");
		});

		it("reports a load-time modal whose only exit is its close button", async () => {
			const result = await runFixture("modal-close-button-only.html");

			expect(result.outcome).toBe("trapped");
			expect(result.container?.selector).toBe("#dialog");
			expect(result.dialog).toEqual({ role: "dialog", native: false, modal: true, buttons: 1 });
		});

		it("reports a modal at the end of the page that only cancels Tab at its own edges", async () => {
			const result = await runFixture("edge-cancel-modal.html");

			expect(result.outcome).toBe("trapped");
			expect(result.container?.selector).toBe("#dialog");
		});

		it("finds no cycle in a native modal dialog, which Tab leaves for the browser's own UI", async () => {
			const result = await runFixture("native-modal-dialog.html");

			expect(result.outcome).toBe("no-cycle");
			expect(result.attempts).toEqual([]);
		});

		it("passes a native modal dialog that wraps Tab itself, because Escape closes it", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/native-modal-cycling.html`);
				const result = await runKeyboardTrapAudit(page.adaptor);
				const open = await page.adaptor.evaluate(
					() => document.querySelector<HTMLDialogElement>("#dialog")?.open,
				);

				expect(result.outcome).toBe("escaped");
				expect(result.escapedVia).toBe("escape-key");
				expect(result.keysTried).toEqual(["Escape"]);
				expect(result.container?.selector).toBe("#dialog");
				expect(result.dialog).toEqual({ role: "dialog", native: true, modal: true, buttons: 2 });
				expect(open).toBe(false);
			} finally {
				await page.close();
			}
		});

		it("reports a native modal dialog that cancels Escape and has no exit", async () => {
			const result = await runFixture("native-modal-no-exit.html");

			expect(result.outcome).toBe("trapped");
			expect(result.container?.selector).toBe("#dialog");
			expect(result.excludedCount).toBe(2);
		});

		it("reports a modal that shuts out the rest of the page with inert and has no exit", async () => {
			const result = await runFixture("inert-modal-no-exit.html");

			expect(result.outcome).toBe("trapped");
			expect(result.container?.selector).toBe("#dialog");
			expect(result.excludedCount).toBe(2);
		});

		it("passes a page whose whole tab order is one small cycle", async () => {
			const result = await runFixture("small-ring.html");

			expect(result.outcome).toBe("small-ring");
			expect(result.ringSize).toBe(3);
		});

		it("never forms a cycle from the stops inside an iframe", async () => {
			const result = await runFixture("iframe-page.html");

			expect(result.outcome).toBe("no-cycle");
		});

		it("sends for review an iframe that focus never comes back out of", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/iframe-trap.html`);
				const result = await runKeyboardTrapAudit(page.adaptor);

				expect(result.outcome).toBe("inconclusive");
				expect(result.inconclusiveReason).toBe("stuck-in-frame");
				expect(result.container?.selector).toBe("#frame");
				expect(result.container?.html).toContain('title="Booking form"');
				expect(result.summary.sessionEnd).toBe("stuck");
				// The tab pass gives a frame 256 presses before it gives up on it, so that a frame with
				// many links of its own is tabbed through rather than taken for a trap.
				expect(page.keyPresses.length).toBeGreaterThan(256);
				expect(page.keyPresses.length).toBeLessThan(280);
			} finally {
				await page.close();
			}
		});

		it("reports a code editor that swallows Tab and Shift+Tab as a trap of one element", async () => {
			const result = await runFixture("editor-swallows-tab.html");

			expect(result.outcome).toBe("trapped");
			expect(result.ringSize).toBe(1);
			expect(result.container?.selector).toBe("#editor");
			expect(result.excludedCount).toBe(2);
			// Arrows move the caret in a text field, so they are never pressed.
			expect(result.keysTried).toEqual(["Escape", "Shift+Tab", "Tab"]);
			expect(
				result.attempts
					.filter((attempt) => attempt.key !== "Escape")
					.every((attempt) => attempt.cancelled === true && attempt.presses === 1),
			).toBe(true);
		});

		it("reports a trap on a page whose other links are all inside shadow roots", async () => {
			const result = await runFixture("shadow-page.html");

			expect(result.outcome).toBe("trapped");
			expect(result.container?.selector).toBe("#widget");
			expect(result.ring.map((element) => element.selector)).toEqual(["#w1", "#w2"]);
			expect(result.excludedCount).toBe(4);
		});

		it("reports a consent dialog held by focus-guard sentinels, and says it is a dialog with buttons", async () => {
			const result = await runFixture("focus-guard-modal.html");

			expect(result.outcome).toBe("trapped");
			expect(result.container?.selector).toBe("#consent");
			expect(result.ring.map((element) => element.selector).sort()).toEqual(["#accept", "#reject"]);
			expect(result.dialog).toEqual({ role: "dialog", native: false, modal: true, buttons: 2 });
		});

		it("samples a ring of 150 elements either side of its wrap instead of walking all of it", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/large-ring.html`);
				const result = await runKeyboardTrapAudit(page.adaptor);
				const presses = (key: string) =>
					result.attempts
						.filter((attempt) => attempt.key === key && attempt.presses > 1)
						.map((attempt) => attempt.presses);

				// No key left it, but most of its members were never pressed from, so it goes for
				// review and is not counted as a failure.
				expect(result.outcome).toBe("inconclusive");
				expect(result.inconclusiveReason).toBe("ring-sampled");
				expect(result.summary.failed).toBe(0);
				expect(result.escapedVia).toBeNull();
				expect(result.ringSize).toBe(150);
				expect(result.sampledRing).toBe(true);
				expect(result.container?.selector).toBe("#palette");
				expect(presses("Shift+Tab")).toEqual([16, 16]);
				expect(presses("Tab")).toEqual([16, 16]);
				// 150 presses find the ring. Walking it both ways for two rounds took 600 more.
				expect(page.keyPresses.length).toBeLessThan(250);
			} finally {
				await page.close();
			}
		});

		it("treats a widget that re-creates its elements on every Tab as inconclusive", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/dom-churn.html`);
				const result = await runKeyboardTrapAudit(page.adaptor, { elementLimit: 20 });

				expect(result.outcome).toBe("inconclusive");
				// Every slide is new content ("Slide 2", "Slide 3", …) standing where the last one was.
				// The tab loop cannot tell that from a list loading its next page, so it does not call
				// it a cycle: the audit runs to its element limit and says it could not decide.
				expect(result.summary.reachedLimit).toBe(true);
			} finally {
				await page.close();
			}
		});

		it("passes a widget that an arrow key lets focus out of", async () => {
			const result = await runFixture("arrow-exit.html");

			expect(result.outcome).toBe("escaped");
			expect(result.escapedVia).toBe("arrow-key");
		});

		it("treats a trap whose Escape loads another page as inconclusive", async () => {
			const result = await runFixture("escape-navigates.html");

			expect(result.outcome).toBe("inconclusive");
		});

		it("never presses Escape in a search field, which would clear it", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/search-escape.html`);
				const result = await runKeyboardTrapAudit(page.adaptor);
				const value = await page.adaptor.evaluate(
					() => document.querySelector<HTMLInputElement>("#search")?.value,
				);

				expect(result.outcome).toBe("trapped");
				expect(value).toBe("shoes");
			} finally {
				await page.close();
			}
		});

		it("never presses arrows on a splitter, leaving its value unchanged", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/arrow-guard.html`);
				const result = await runKeyboardTrapAudit(page.adaptor);
				const value = await page.adaptor.evaluate(() =>
					document.getElementById("splitter")?.getAttribute("aria-valuenow"),
				);

				expect(result.outcome).toBe("trapped");
				expect(value).toBe("50");
			} finally {
				await page.close();
			}
		});

		it("passes a roving-tabindex carousel, which presents one tab stop", async () => {
			const result = await runFixture("roving-carousel.html");

			expect(result.outcome).toBe("no-cycle");
		});

		it("never presses arrows on a radio, leaving the checked radio unchanged", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/radio-trap.html`);
				const result = await runKeyboardTrapAudit(page.adaptor);
				const checked = await page.adaptor.evaluate(
					() => document.querySelector<HTMLInputElement>("input:checked")?.id,
				);

				expect(result.outcome).toBe("trapped");
				expect(checked).toBe("small");
			} finally {
				await page.close();
			}
		});
	},
);
