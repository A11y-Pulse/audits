import { PlaywrightAdaptor as BrowserPlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor as BrowserPuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	describeEachEngine,
	type EngineHandle,
	type FixtureServer,
	startFixtureServer,
	WEBKIT_PARTIAL_TAB_LOOP,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import type { UnreachableControlsAdaptor } from "../../src/adaptor";
import { PlaywrightAdaptor } from "../../src/adaptors/playwright";
import { PuppeteerAdaptor } from "../../src/adaptors/puppeteer";
import { runUnreachableControlsAudit, type UnreachableControlsOptions } from "../../src/audit";
import type { UnreachableControlsResult } from "../../src/result";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
});

afterAll(async () => {
	await server.close();
});

/** Selector, verdict and reason of each unreachable control, in document order. */
function unreachable(result: UnreachableControlsResult): string[][] {
	return result.unreachable.map(({ selector, verdict, reason }) => [selector, verdict, reason]);
}

function missingRole(result: UnreachableControlsResult): string[][] {
	return result.missingRole.map(({ selector, verdict, reason }) => [selector, verdict, reason]);
}

const UNSUPPORTED = { "playwright-webkit": WEBKIT_PARTIAL_TAB_LOOP };
const VIEWPORT = { width: 1280, height: 800 };

// The audit's own adaptors ask the browser about listeners, which only Chromium answers.
describeEachEngine<UnreachableControlsAdaptor>(
	"unreachable controls audit (integration)",
	{
		adaptor: {
			puppeteer: (page) => new PuppeteerAdaptor(page),
			playwright: (page) => new PlaywrightAdaptor(page),
		},
		viewport: VIEWPORT,
		unsupported: UNSUPPORTED,
	},
	(engine) => suite(engine, engine.name === "puppeteer" || engine.name === "playwright-chromium"),
);

// The plain adaptors cannot, so every engine takes the path Firefox and WebKit always take.
describeEachEngine<UnreachableControlsAdaptor>(
	"unreachable controls audit without listener inspection (integration)",
	{
		adaptor: {
			puppeteer: (page) => new BrowserPuppeteerAdaptor(page),
			playwright: (page) => new BrowserPlaywrightAdaptor(page),
		},
		viewport: VIEWPORT,
		unsupported: UNSUPPORTED,
	},
	(engine) => suite(engine, false),
);

function suite(engine: EngineHandle<UnreachableControlsAdaptor>, inspects: boolean): void {
	async function runFixture(
		name: string,
		options?: UnreachableControlsOptions,
	): Promise<UnreachableControlsResult> {
		const page = await engine.newPage();

		try {
			await page.goto(`${server.url}/${name}`);

			return await runUnreachableControlsAudit(page.adaptor, options);
		} finally {
			await page.close();
		}
	}

	it("says whether the browser was asked about listeners", async () => {
		const result = await runFixture("listener-div.html");

		expect(result.listenersInspected).toBe(inspects);
	});

	it("reports a div with a click listener and no tab stop", async () => {
		const result = await runFixture("listener-div.html");

		expect(result.outcome).toBe("findings");
		expect(missingRole(result)).toEqual([]);

		if (inspects) {
			expect(unreachable(result)).toEqual([
				["#buy", "failed", "click-handler"],
				["#details", "failed", "click-handler"],
			]);
			expect(result.unreachable[0]).toMatchObject({
				html: '<div id="buy" class="pointer">',
				text: "Buy now",
				signals: { listeners: ["click"], role: null, cursorPointer: true, tabindex: null },
			});
			expect(result.summary.failed).toBe(2);
		} else {
			// A listener added with addEventListener is invisible here; the cursor is all there is.
			expect(unreachable(result)).toEqual([["#buy", "review", "pointer-cursor"]]);
			expect(result.summary.failed).toBe(0);
		}

		expect(result.summary.checked).toBe(1);
		expect(result.summary.sessionEnd).toBe("completed");
	});

	it("passes the same control given a tab stop and a role", async () => {
		const result = await runFixture("role-button.html");

		expect(result.outcome).toBe("clean");
		expect(result.unreachable).toEqual([]);
		expect(result.missingRole).toEqual([]);
		expect(result.summary.checked).toBe(2);
	});

	it("reports focusable click targets that expose no role", async () => {
		const result = await runFixture("focusable-no-role.html");

		expect(result.unreachable).toEqual([]);
		expect(result.summary.checked).toBe(5);

		if (inspects) {
			expect(missingRole(result)).toEqual([
				["#buy", "failed", "handler-without-role"],
				["#save", "failed", "handler-without-role"],
				["#hint", "review", "pointer-cursor"],
			]);
			expect(result.missingRole[0]).toMatchObject({
				tabIndex: 1,
				computedRole: "generic",
				signals: { listeners: ["click", "keydown"], role: null, tabindex: 0 },
			});
		} else {
			expect(missingRole(result)).toEqual([
				["#buy", "review", "pointer-cursor"],
				["#save", "failed", "handler-without-role"],
				["#hint", "review", "pointer-cursor"],
			]);
			expect(result.missingRole[1]).toMatchObject({ tabIndex: 2, computedRole: null });
		}
	});

	it("passes a clickable card whose link does the same thing", async () => {
		const result = await runFixture("card-link.html");

		expect(result.outcome).toBe("clean");
		expect(result.unreachable).toEqual([]);
	});

	it("passes tabs and buttons that share one roving tab stop", async () => {
		const result = await runFixture("tablist-roving.html");

		expect(result.outcome).toBe("clean");
		expect(result.unreachable).toEqual([]);
		expect(result.missingRole).toEqual([]);
		expect(result.summary.checked).toBe(2);
	});

	it("passes a page whose framework listens once at the root", async () => {
		const result = await runFixture("delegated-root.html");

		expect(result.outcome).toBe("clean");
		expect(result.unreachable).toEqual([]);
		expect(result.summary.checked).toBe(3);
	});

	it("reports a custom dropdown and its options that only a pointer can use", async () => {
		const result = await runFixture("custom-dropdown.html");

		expect(unreachable(result)).toEqual([
			["#size", "failed", "click-handler"],
			["#opt-1", "failed", "click-handler"],
			["#opt-2", "failed", "click-handler"],
			["#opt-3", "failed", "click-handler"],
		]);
		expect(result.summary.failed).toBe(4);
	});

	it("asks for review when only the pointer cursor suggests a control", async () => {
		const result = await runFixture("cursor-only.html");

		expect(result.outcome).toBe("findings");
		expect(unreachable(result)).toEqual([["#promo", "review", "pointer-cursor"]]);
		expect(result.summary.failed).toBe(0);
	});

	it("reports options of a listbox nothing can focus, and passes one a combobox drives", async () => {
		const result = await runFixture("unmanaged-listbox.html");

		expect(unreachable(result)).toEqual([
			["#red", "failed", "widget-role"],
			["#green", "failed", "widget-role"],
		]);
	});

	it("reports a label whose checkbox is display: none", async () => {
		const result = await runFixture("hidden-checkbox.html");

		expect(unreachable(result)).toEqual([["#gift-label", "failed", "hidden-control-label"]]);
		expect(result.summary.checked).toBe(2);
	});

	it("judges a label by whether its control is rendered, and passes one with a focusable stand-in", async () => {
		const result = await runFixture("hidden-controls.html");

		expect(unreachable(result)).toEqual([["#gift-label", "failed", "hidden-control-label"]]);
		expect(result.missingRole).toEqual([]);
		expect(result.summary.checked).toBe(3);
	});

	it("passes framework roots and portal containers that hold nothing focusable", async () => {
		const result = await runFixture("framework-roots.html");

		expect(result.listenersInspected).toBe(inspects);
		expect(result.outcome).toBe("clean");
		expect(result.unreachable).toEqual([]);
		expect(result.summary.checked).toBe(1);
	});

	it("keeps real controls ahead of a click listener that sits on every element", async () => {
		const result = await runFixture("analytics-listeners.html");

		expect(unreachable(result)).toEqual(
			inspects
				? [
						["#close-banner", "failed", "click-handler"],
						["#open-chat", "failed", "click-handler"],
						["#banner-text", "review", "blanket-listener"],
						["#title", "review", "blanket-listener"],
						["#intro", "review", "blanket-listener"],
						["#list", "review", "blanket-listener"],
						["#item-1", "review", "blanket-listener"],
					]
				: [
						["#close-banner", "review", "pointer-cursor"],
						["#open-chat", "failed", "click-handler"],
					],
		);
		expect(result.summary.failed).toBe(inspects ? 2 : 1);
		// Only a sample of the blanket listeners is listed.
		expect(result.truncated).toBe(inspects);
	});

	it("keeps real controls when a blanket listener would fill the finding limit", async () => {
		const result = await runFixture("analytics-listeners.html", { findingLimit: 3 });

		expect(unreachable(result).slice(0, 2)).toEqual(
			inspects
				? [
						["#close-banner", "failed", "click-handler"],
						["#open-chat", "failed", "click-handler"],
					]
				: [
						["#close-banner", "review", "pointer-cursor"],
						["#open-chat", "failed", "click-handler"],
					],
		);
		expect(result.unreachable).toHaveLength(inspects ? 3 : 2);
	});

	it("sends a focusable container whose listeners serve its buttons for review", async () => {
		const result = await runFixture("focused-container.html");

		expect(result.unreachable).toEqual([]);
		expect(missingRole(result)).toEqual(
			inspects
				? [
						["#orders", "review", "container-handler"],
						["#apply", "failed", "handler-without-role"],
					]
				: [],
		);
	});

	it("finds a click target inside a shadow root", async () => {
		const result = await runFixture("shadow.html");

		expect(unreachable(result)).toEqual([["#gallery >>> div.zoom", "failed", "click-handler"]]);
	});

	it("leaves hidden, disabled, inert and already-reachable click targets alone", async () => {
		const result = await runFixture("excluded.html");

		expect(result.outcome).toBe("clean");
		expect(result.unreachable).toEqual([]);
		expect(result.missingRole).toEqual([]);
	});

	it("reports only the real gaps on a storefront page", async () => {
		const result = await runFixture("storefront.html");
		const listenerOnly = inspects ? ["failed", "click-handler"] : ["review", "pointer-cursor"];

		expect(unreachable(result)).toEqual([
			["#nav-sale", "failed", "click-handler"],
			["#card-1", ...listenerOnly],
			["#swatch-1", "failed", "widget-role"],
			["#sort-name", ...listenerOnly],
		]);
		expect(result.missingRole).toEqual([]);
		expect(result.truncated).toBe(false);
	});

	it("is inconclusive when its element limit stops the pass early", async () => {
		const result = await runFixture("early-end.html", { elementLimit: 2 });

		expect(result.outcome).toBe("inconclusive");
		expect(result.inconclusiveReason).toBe("element-limit");
		expect(result.unreachable).toEqual([]);
		expect(result.summary.reachedLimit).toBe(true);
	});

	it("is inconclusive when the page navigates during the pass", async () => {
		const result = await runFixture("navigates.html");

		expect(result.outcome).toBe("inconclusive");
		expect(result.inconclusiveReason).toBe("session-ended-early");
		expect(result.summary.sessionEnd).toBe("navigation");
		expect(result.unreachable).toEqual([]);
	});

	it("cuts the findings at findingLimit, keeping failures first", async () => {
		const result = await runFixture("custom-dropdown.html", { findingLimit: 2 });

		expect(unreachable(result)).toEqual([
			["#size", "failed", "click-handler"],
			["#opt-1", "failed", "click-handler"],
		]);
		expect(result.truncated).toBe(true);
	});

	it("leaves nothing behind on the page", async () => {
		const page = await engine.newPage();

		try {
			await page.goto(`${server.url}/custom-dropdown.html`);
			await runUnreachableControlsAudit(page.adaptor);

			const leftovers = await page.adaptor.evaluate(() =>
				Object.keys(window).filter((key) => key.toLowerCase().includes("a11ypulse")),
			);

			expect(leftovers).toEqual([]);
		} finally {
			await page.close();
		}
	});
}
