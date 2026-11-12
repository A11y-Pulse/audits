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
	type DisclosureOperabilityOptions,
	type DisclosureOperabilityResult,
	runDisclosureOperabilityAudit,
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

type PageState = {
	url: string;
	scroll: [number, number];
	focused: string | null;
	expanded: Record<string, string | null>;
	shown: Record<string, boolean>;
	/** `checked` of every checkbox and radio, and `aria-checked` where it is set. */
	checked: Record<string, string>;
	/** What the fixture counted on `window.__fixture`: form submissions, handler calls and so on. */
	counters: Record<string, number>;
	/** Whether this engine lets a page-leaving navigation be stopped (the Navigation API). */
	canStopNavigation: boolean;
	leftovers: string[];
};

/** Everything the audit could have changed: states, what is on show, focus, scrolling, the URL. */
function pageStateScript(): PageState {
	const expanded: Record<string, string | null> = {};
	const shown: Record<string, boolean> = {};
	const checked: Record<string, string> = {};

	for (const element of document.querySelectorAll("[id]")) {
		const rect = element.getBoundingClientRect();

		shown[element.id] = rect.width > 0 && rect.height > 0;

		if (element instanceof HTMLInputElement && ["checkbox", "radio"].includes(element.type)) {
			checked[element.id] = String(element.checked);
		} else if (element.hasAttribute("aria-checked")) {
			checked[element.id] = element.getAttribute("aria-checked") ?? "";
		}

		if (element.hasAttribute("aria-expanded")) {
			expanded[element.id] = element.getAttribute("aria-expanded");
		}
	}

	return {
		url: location.href,
		scroll: [window.scrollX, window.scrollY],
		focused: document.activeElement === document.body ? null : (document.activeElement?.id ?? null),
		expanded,
		shown,
		checked,
		counters: {
			...((window as unknown as { __fixture?: Record<string, number> }).__fixture ?? {}),
		},
		canStopNavigation: "navigation" in window,
		leftovers: Object.keys(window).filter((key) => key.startsWith("__a11yPulse")),
	};
}

function prepareScript(focusId: string | null, scrollY: number): void {
	window.scrollTo(0, scrollY);

	if (focusId) {
		document.getElementById(focusId)?.focus({ preventScroll: true });
	}
}

function selectors(items: readonly { selector: string }[]): string[] {
	return items.map(({ selector }) => selector);
}

describeEachEngine<BrowserAdaptor>(
	"disclosure operability audit (integration)",
	{ adaptor: adaptors },
	(engine) => {
		type Run = { result: DisclosureOperabilityResult; before: PageState; after: PageState };

		async function runFixture(
			name: string,
			setup: { focusId?: string; scrollY?: number; options?: DisclosureOperabilityOptions } = {},
		): Promise<Run> {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/${name}`);
				await page.adaptor.evaluate(prepareScript, setup.focusId ?? null, setup.scrollY ?? 0);

				const before = await page.adaptor.evaluate(pageStateScript);
				const result = await runDisclosureOperabilityAudit(page.adaptor, setup.options);
				const after = await page.adaptor.evaluate(pageStateScript);

				return { result, before, after };
			} finally {
				await page.close();
			}
		}

		it("passes a button that toggles its region and reports the state", async () => {
			const { result, before, after } = await runFixture("button-disclosure.html");

			expect(result.failed).toEqual([]);
			expect(result.needsReview).toEqual([]);
			expect(result.skipped).toEqual([]);
			expect(result.passed).toEqual([
				{
					selector: "#delivery-toggle",
					html: '<button id="delivery-toggle" class="toggle" type="button" aria-expanded="false" aria-controls="delivery">',
					role: null,
					expanded: "false",
					controls: "#delivery",
					signals: [],
					keysTried: ["Enter", "Space"],
					attempts: [
						{
							key: "Enter",
							expandedBefore: "false",
							expandedAfter: "true",
							contentChanged: true,
							restoredBy: "Enter",
						},
						{
							key: "Space",
							expandedBefore: "false",
							expandedAfter: "true",
							contentChanged: true,
							restoredBy: "Space",
						},
					],
					pointer: { click: null, hover: null },
					openedOnFocus: false,
					restored: true,
				},
			]);
			expect(result.stopped).toBeNull();
			expect(result.summary).toEqual({
				checked: 1,
				failed: 0,
				needsReview: 0,
				passed: 1,
				skipped: 0,
				unchecked: 0,
			});
			expect(after).toEqual(before);
		});

		it("fails controls that a click operates and the keyboard cannot", async () => {
			const { result, before, after } = await runFixture("div-click-only.html");

			expect(selectors(result.failed)).toEqual(["#brand-filter", "#price-filter"]);
			expect(result.failed[0]).toMatchObject({
				role: "button",
				controls: "#brand-options",
				signals: ["keyboard-inoperable"],
				keysTried: ["Enter", "Space"],
				attempts: [
					{ key: "Enter", expandedAfter: "false", contentChanged: false, restoredBy: null },
					{ key: "Space", expandedAfter: "false", contentChanged: false, restoredBy: null },
				],
				pointer: { click: true, hover: null },
				restored: true,
			});
			expect(result.failed[1]).toMatchObject({
				role: null,
				controls: "#price-options",
				signals: ["not-focusable"],
				keysTried: [],
				attempts: [],
				pointer: { click: true, hover: null },
				restored: true,
			});
			expect(result.needsReview).toEqual([]);
			expect(result.passed).toEqual([]);
			expect(after).toEqual(before);
		});

		it("fails triggers that show content without reporting it, and leaves other buttons alone", async () => {
			const { result, before, after } = await runFixture("no-state-update.html", {
				options: { includeControlsOnly: true },
			});

			// #sort-button names content that is already on show, so it is not a disclosure.
			expect(result.summary).toMatchObject({ checked: 3, failed: 2, needsReview: 1, passed: 0 });
			expect(selectors(result.failed)).toEqual(["#stale-toggle", "#faq-toggle"]);
			expect(result.failed[0]).toMatchObject({
				expanded: "false",
				controls: null,
				signals: ["state-not-exposed"],
				attempts: [
					{ key: "Enter", expandedBefore: "false", expandedAfter: "false", contentChanged: true },
					{ key: "Space", expandedBefore: "false", expandedAfter: "false", contentChanged: true },
				],
			});
			expect(result.failed[1]).toMatchObject({
				expanded: null,
				controls: "#faq-answer",
				signals: ["state-not-exposed"],
				attempts: [
					{ key: "Enter", expandedBefore: null, expandedAfter: null, contentChanged: true },
					{ key: "Space", expandedBefore: null, expandedAfter: null, contentChanged: true },
				],
			});
			expect(selectors(result.needsReview)).toEqual(["#empty-toggle"]);
			expect(result.needsReview[0]).toMatchObject({
				signals: ["state-without-content"],
				attempts: [
					{ key: "Enter", expandedAfter: "true", contentChanged: false, restoredBy: "Enter" },
					{ key: "Space", expandedAfter: "true", contentChanged: false, restoredBy: "Space" },
				],
			});
			expect(after).toEqual(before);
		});

		it("leaves a button with aria-controls and no aria-expanded alone unless asked to operate it", async () => {
			const { result, before, after } = await runFixture("no-state-update.html");

			expect(result.summary).toMatchObject({ checked: 2, failed: 1, needsReview: 1, skipped: 0 });
			expect(selectors(result.failed)).toEqual(["#stale-toggle"]);
			expect(selectors(result.needsReview)).toEqual(["#empty-toggle"]);
			expect(after).toEqual(before);
		});

		it("fails a menu that only opens on hover and passes one its button also toggles", async () => {
			const { result, before, after } = await runFixture("hover-menu.html");

			expect(selectors(result.failed)).toEqual(["#menu-tents"]);
			expect(result.failed[0]).toMatchObject({
				controls: "#tents-panel",
				signals: ["keyboard-inoperable"],
				// Enter clicked the button to no effect, so Space and a scripted click are not sent:
				// they would only click it again.
				keysTried: ["Enter"],
				pointer: { click: false, hover: true },
				restored: true,
			});
			expect(selectors(result.passed)).toEqual(["#menu-packs"]);
			expect(result.needsReview).toEqual([]);
			expect(after).toEqual(before);
		});

		it("passes every panel of an accordion and restores each, with focus and scrolling", async () => {
			const { result, before, after } = await runFixture("accordion.html", {
				focusId: "contact",
				scrollY: 120,
			});

			expect(before.focused).toBe("contact");
			expect(before.scroll).toEqual([0, 120]);

			expect(result.failed).toEqual([]);
			expect(result.needsReview).toEqual([]);
			expect(selectors(result.passed)).toEqual(["#q1", "#q2", "#q3"]);
			// The first panel starts open: closing it is the change, and it is opened again.
			expect(result.passed[0]).toMatchObject({
				expanded: "true",
				attempts: [
					{ key: "Enter", expandedBefore: "true", expandedAfter: "false", restoredBy: "Enter" },
					{ key: "Space", expandedBefore: "true", expandedAfter: "false", restoredBy: "Space" },
				],
			});
			expect(result.passed[1]).toMatchObject({
				expanded: "false",
				controls: "#a2",
				attempts: [
					{ key: "Enter", expandedAfter: "true", contentChanged: true, restoredBy: "Enter" },
					{ key: "Space", expandedAfter: "true", contentChanged: true, restoredBy: "Space" },
				],
			});
			expect(after).toEqual(before);
		});

		it("passes a menu button that moves focus into its menu and closes on Escape", async () => {
			const { result, before, after } = await runFixture("menu-button.html");

			expect(result.failed).toEqual([]);
			expect(result.needsReview).toEqual([]);
			expect(selectors(result.passed)).toEqual(["#account-button"]);
			expect(result.passed[0]).toMatchObject({
				controls: "#account-menu",
				attempts: [
					{ key: "Enter", expandedAfter: "true", contentChanged: true, restoredBy: "Escape" },
					{ key: "Space", expandedAfter: "true", contentChanged: true, restoredBy: "Escape" },
				],
				restored: true,
			});
			expect(after).toEqual(before);
		});

		it("never activates links that leave the page, submit buttons or text fields", async () => {
			const { result, before, after } = await runFixture("navigating-link.html");

			expect(result.failed).toEqual([]);
			expect(result.needsReview).toEqual([]);
			expect(result.passed).toEqual([]);
			expect(result.skipped.map(({ selector, reason }) => [selector, reason])).toEqual([
				["#shop-link", "navigating-link"],
				["#wrapped", "navigating-link"],
				["#subscribe", "submits-form"],
				["#disabled-toggle", "disabled"],
				["#city", "text-entry"],
				["#mobile-menu", "hidden"],
			]);
			expect(result.summary).toEqual({
				checked: 0,
				failed: 0,
				needsReview: 0,
				passed: 0,
				skipped: 6,
				unchecked: 0,
			});
			expect(after.url).toMatch(/\/navigating-link\.html$/);
			expect(after).toEqual(before);
		});

		it("sends a trigger that removes itself for review and carries on with the rest", async () => {
			const { result, after } = await runFixture("removed-on-open.html");

			expect(result.failed).toEqual([]);
			expect(selectors(result.needsReview)).toEqual(["#show-replies"]);
			expect(result.needsReview[0]).toMatchObject({
				signals: ["trigger-removed"],
				keysTried: ["Enter"],
				restored: false,
			});
			expect(selectors(result.passed)).toEqual(["#sort"]);
			expect(result.stopped).toBeNull();
			expect(after.expanded).toEqual({ sort: "false" });
			expect(after.shown["sort-options"]).toBe(false);
			expect(after.leftovers).toEqual([]);
		});

		it("stops a trigger from loading another page, or stops itself where the engine cannot", async () => {
			const { result, before, after } = await runFixture("navigates-on-activate.html");

			expect(result.failed).toEqual([]);
			expect(result.passed).toEqual([]);

			if (before.canStopNavigation) {
				// The navigation never happened, and the audit carried on to the next trigger, which
				// has no handler on this page.
				expect(result.stopped).toBeNull();
				expect(selectors(result.needsReview)).toEqual(["#go", "#later"]);
				expect(result.needsReview[0]).toMatchObject({
					signals: ["navigation-blocked"],
					keysTried: ["Enter"],
					pointer: { click: null, hover: null },
					restored: true,
				});
				expect(result.needsReview[1]).toMatchObject({ signals: ["unresponsive"] });
				expect(result.summary).toMatchObject({ checked: 2, needsReview: 2, unchecked: 0 });
				expect(after.url).toMatch(/\/navigates-on-activate\.html$/);
				expect(after).toEqual(before);
			} else {
				expect(result.stopped).toBe("navigated");
				expect(selectors(result.needsReview)).toEqual(["#go"]);
				expect(result.needsReview[0]).toMatchObject({ signals: ["navigated"], restored: false });
				expect(result.summary).toMatchObject({ checked: 1, needsReview: 1, unchecked: 1 });
				expect(after.url).toMatch(/\/other\.html$/);
			}
		});

		it("stops a trigger from sending a form by script, and lets forms submit again afterwards", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/submits-from-script.html`);

				const before = await page.adaptor.evaluate(pageStateScript);
				const result = await runDisclosureOperabilityAudit(page.adaptor);
				const after = await page.adaptor.evaluate(pageStateScript);

				expect(after).toEqual(before);
				expect(after.url).toMatch(/\/submits-from-script\.html$/);
				expect(result.failed).toEqual([]);
				expect(selectors(result.needsReview)).toEqual(["#apply"]);
				expect(result.needsReview[0]).toMatchObject({
					signals: ["submit-blocked"],
					keysTried: ["Enter"],
					pointer: { click: null, hover: null },
					restored: true,
				});
				expect(selectors(result.passed)).toEqual(["#sort-toggle"]);

				// The block is lifted when the audit finishes: the page's own submit handler runs again.
				await page.adaptor.evaluate(() => {
					(document.getElementById("filters") as HTMLFormElement).requestSubmit();
				});

				expect((await page.adaptor.evaluate(pageStateScript)).counters).toEqual({ submits: 1 });
			} finally {
				await page.close();
			}
		});

		it("is not misled by a carousel that keeps moving slides in and out of the page", async () => {
			// Run several times: the carousel changes every 400ms, so each run meets it at a
			// different moment, and every one must reach the same verdicts.
			for (let run = 0; run < 4; run++) {
				const { result, before, after } = await runFixture("carousel-noise.html");

				expect(selectors(result.failed)).toEqual(["#filters-toggle"]);
				expect(result.failed[0]).toMatchObject({
					signals: ["keyboard-inoperable"],
					keysTried: ["Enter", "Space"],
					attempts: [
						{ key: "Enter", expandedAfter: "false", contentChanged: false, restoredBy: null },
						{ key: "Space", expandedAfter: "false", contentChanged: false, restoredBy: null },
					],
					pointer: { click: true, hover: null },
					restored: true,
				});
				expect(result.needsReview).toEqual([]);
				expect(selectors(result.passed)).toEqual(["#sort-toggle", "#help-toggle"]);

				for (const passed of result.passed) {
					expect(passed.attempts).toEqual([
						{
							key: "Enter",
							expandedBefore: "false",
							expandedAfter: "true",
							contentChanged: true,
							restoredBy: "Enter",
						},
						{
							key: "Space",
							expandedBefore: "false",
							expandedAfter: "true",
							contentChanged: true,
							restoredBy: "Space",
						},
					]);
				}

				expect(after).toEqual(before);
			}
		});

		it("lifts its blocks and puts focus back when it fails part-way through", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/submits-from-script.html`);
				await page.adaptor.evaluate(prepareScript, "q", 0);

				const before = await page.adaptor.evaluate(pageStateScript);

				// An adaptor whose keyboard fails the first time a key is pressed.
				const broken = new Proxy(page.adaptor, {
					get(target, key) {
						if (key === "pressKey") {
							return async () => {
								throw new Error("keyboard unplugged");
							};
						}

						const value = Reflect.get(target, key) as unknown;

						return typeof value === "function" ? value.bind(target) : value;
					},
				});

				await expect(runDisclosureOperabilityAudit(broken)).rejects.toThrow("keyboard unplugged");

				expect(await page.adaptor.evaluate(pageStateScript)).toEqual(before);

				await page.adaptor.evaluate(() => {
					(document.getElementById("filters") as HTMLFormElement).requestSubmit();
				});

				expect((await page.adaptor.evaluate(pageStateScript)).counters).toEqual({ submits: 1 });
			} finally {
				await page.close();
			}
		});

		it("passes a menu that opens on focus and reports it, and sends a silent one for review", async () => {
			const { result, before, after } = await runFixture("opens-on-focus.html");

			expect(result.failed).toEqual([]);
			expect(selectors(result.passed)).toEqual(["#menu-packs"]);
			expect(result.passed[0]).toMatchObject({
				openedOnFocus: true,
				keysTried: [],
				restored: true,
			});
			expect(selectors(result.needsReview)).toEqual(["#menu-boots"]);
			expect(result.needsReview[0]).toMatchObject({
				signals: ["opens-on-focus"],
				openedOnFocus: true,
				restored: true,
			});
			expect(after).toEqual(before);
		});

		it("samples a long page evenly and reports what it left out", async () => {
			const { result, before, after } = await runFixture("many.html", {
				options: { triggerLimit: 6 },
			});

			expect(selectors(result.passed)).toEqual([
				"#spec-0",
				"#spec-5",
				"#spec-10",
				"#spec-15",
				"#spec-20",
				"#spec-25",
			]);
			expect(result.summary).toEqual({
				checked: 6,
				failed: 0,
				needsReview: 0,
				passed: 6,
				skipped: 0,
				unchecked: 24,
			});
			expect(after).toEqual(before);
		});

		it("presses nothing into a dialog that took focus and kept it", async () => {
			const { result, after } = await runFixture("trap-dialog.html");

			// One activation opened the dialog. Nothing was pressed inside it and its form was not sent.
			expect(after.counters).toEqual({ submits: 0, keysInDialog: 0, opens: 1 });
			expect(after.url).toMatch(/\/trap-dialog\.html$/);
			expect(result.failed).toEqual([]);
			expect(result.passed).toEqual([]);
			expect(selectors(result.needsReview)).toEqual(["#reschedule"]);
			expect(result.needsReview[0]).toMatchObject({
				signals: ["not-restored"],
				keysTried: ["Enter"],
				attempts: [{ key: "Enter", expandedAfter: "true", contentChanged: true, restoredBy: null }],
				pointer: { click: null, hover: null },
				restored: false,
			});
			// The dialog is still open: the audit says so and does not pretend otherwise.
			expect(after.shown["reschedule-dialog"]).toBe(true);
			expect(after.leftovers).toEqual([]);
		});

		it("leaves checkboxes, radios and switches alone, and never submits their form", async () => {
			const { result, before, after } = await runFixture("checkbox-in-form.html");

			expect(after.counters).toEqual({ submits: 0 });
			expect(result.skipped.map(({ selector, reason }) => [selector, reason])).toEqual([
				["#other-address", "checkable"],
				["#delivery-pickup", "checkable"],
				["#gift-switch", "checkable"],
			]);
			expect(result.summary).toEqual({
				checked: 0,
				failed: 0,
				needsReview: 0,
				passed: 0,
				skipped: 3,
				unchecked: 0,
			});
			expect(before.checked).toEqual({
				"other-address": "false",
				"delivery-standard": "true",
				"delivery-pickup": "false",
				"gift-switch": "false",
			});
			expect(after).toEqual(before);
		});

		it("skips controls named for a destructive action and runs a silent handler once", async () => {
			const { result, before, after } = await runFixture("destructive-name.html");

			expect(after.counters).toEqual({
				"delete-account": 0,
				"sign-out": 0,
				"remove-card": 0,
				notifications: 1,
				export: 0,
			});
			expect(result.skipped.map(({ selector, reason }) => [selector, reason])).toEqual([
				["#delete-account", "risky-name"],
				["#sign-out", "risky-name"],
				["#remove-card", "risky-name"],
			]);
			expect(result.failed).toEqual([]);
			expect(selectors(result.needsReview)).toEqual(["#notifications"]);
			// Enter clicked the button and nothing changed: Space and a scripted click would only
			// have run the same handler again.
			expect(result.needsReview[0]).toMatchObject({
				signals: ["unresponsive"],
				keysTried: ["Enter"],
				pointer: { click: false, hover: false },
				restored: true,
			});
			expect(selectors(result.passed)).toEqual(["#privacy-toggle"]);
			expect({ ...after, counters: before.counters }).toEqual(before);
		});

		it("operates risky names and aria-controls-only buttons when asked to", async () => {
			const { result, after } = await runFixture("destructive-name.html", {
				options: { riskyNamePattern: null, includeControlsOnly: true },
			});

			expect(result.skipped).toEqual([]);
			expect(result.summary).toMatchObject({ checked: 6, passed: 1 });
			expect(after.counters).toEqual({
				"delete-account": 1,
				"sign-out": 1,
				"remove-card": 1,
				notifications: 1,
				export: 1,
			});
		});

		it("waits for a toggle that takes half a second to act", async () => {
			const { result, before, after } = await runFixture("slow-toggle.html");

			expect(result.failed).toEqual([]);
			expect(result.needsReview).toEqual([]);
			expect(selectors(result.passed)).toEqual(["#hours-toggle"]);
			expect(result.passed[0]).toMatchObject({
				attempts: [
					{ key: "Enter", expandedAfter: "true", contentChanged: true, restoredBy: "Enter" },
					{ key: "Space", expandedAfter: "true", contentChanged: true, restoredBy: "Space" },
				],
				pointer: { click: null, hover: null },
				restored: true,
			});
			expect(after).toEqual(before);
		});

		it("waits out a transition during which the toggle ignores input", async () => {
			const { result, before, after } = await runFixture("transition-locked.html");

			expect(result.failed).toEqual([]);
			expect(result.needsReview).toEqual([]);
			expect(selectors(result.passed)).toEqual(["#specs-toggle"]);
			expect(result.passed[0]).toMatchObject({
				attempts: [
					{ key: "Enter", expandedAfter: "true", contentChanged: true, restoredBy: "Enter" },
					{ key: "Space", expandedAfter: "true", contentChanged: true, restoredBy: "Space" },
				],
				restored: true,
			});
			expect(after).toEqual(before);
		});

		it("is inapplicable on a page with no disclosure triggers", async () => {
			const { result, before, after } = await runFixture("none.html");

			expect(result).toEqual({
				failed: [],
				needsReview: [],
				passed: [],
				skipped: [],
				stopped: null,
				summary: { checked: 0, failed: 0, needsReview: 0, passed: 0, skipped: 0, unchecked: 0 },
			});
			expect(after).toEqual(before);
		});
	},
);
