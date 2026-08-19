import { createContextChangeOnFocusAudit } from "@a11y-pulse/context-change-on-focus-audit";
import { createFocusAppearanceAudit } from "@a11y-pulse/focus-appearance-audit";
import { createFocusNotObscuredAudit } from "@a11y-pulse/focus-not-obscured-audit";
import puppeteer, { type Browser } from "puppeteer";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { BrowserAdaptor } from "../../src/adaptor";
import { PuppeteerAdaptor } from "../../src/adaptors/puppeteer";
import { createTabOrchestrator } from "../../src/orchestrator";
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

describe("shared session across three audits (integration)", () => {
	it("tabs once and stops screenshotting after appearance disconnects", async () => {
		const page = await browser.newPage();
		const press = page.keyboard.press.bind(page.keyboard);
		let tabs = 0;
		page.keyboard.press = async (key, opts) => {
			if (key === "Tab") {
				tabs++;
			}
			return press(key, opts);
		};
		let clips = 0;
		const inner = new PuppeteerAdaptor(page);
		const adaptor: BrowserAdaptor = {
			evaluate: inner.evaluate.bind(inner),
			evaluateHandle: inner.evaluateHandle.bind(inner),
			disposeRef: inner.disposeRef.bind(inner),
			pressTab: inner.pressTab.bind(inner),
			screenshotClip: async (clip, scale) => {
				clips++;
				return inner.screenshotClip(clip, scale);
			},
			get screenshotClipScale() {
				return inner.screenshotClipScale;
			},
			ensureFocusReporting: inner.ensureFocusReporting.bind(inner),
		};

		await page.goto(`${server.url}/mixed-focus.html`);

		const orchestrator = createTabOrchestrator(adaptor, {
			screenshotSettleDelay: 33,
		});
		const focus = createFocusAppearanceAudit({
			elementLimit: 1,
			skipStyleCheck: true,
		});
		const obscured = createFocusNotObscuredAudit();
		const context = createContextChangeOnFocusAudit();
		orchestrator.attach(focus);
		orchestrator.attach(obscured);
		orchestrator.attach(context);
		await orchestrator.run();

		expect(focus.result.elements).toHaveLength(1);
		expect(obscured.result.elements.length).toBeGreaterThan(1);
		expect(context.result.elements.length).toBeGreaterThan(1);
		expect(clips).toBe(2); // one unfocusedPair = focused + unfocused, only stop 1
		// The session ends naturally once Tab lands on <body> (or revisits an
		// already-seen element) with nothing left to tab to; detecting that
		// requires one more real Tab press than there are real elements to
		// report. This is deliberate, pre-existing orchestrator behaviour, not
		// something this fixture can tune away: `orchestrator.test.ts`'s
		// `loopAdaptor` helper encodes the same contract by defaulting its
		// (N+1)th `probeActiveElementScript` response to `isBody: true` after
		// N scripted real elements. See task-12-report.md for the RED-run
		// evidence (tabs=4, obscured.result.elements.length=3) that surfaced
		// this off-by-one against the brief's literal `toBe(...)`.
		expect(tabs).toBe(obscured.result.elements.length + 1);
		await page.close();
	});
});
