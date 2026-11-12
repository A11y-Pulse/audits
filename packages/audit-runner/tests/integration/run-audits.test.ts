import {
	describeEachEngine,
	type FixtureServer,
	startFixtureServer,
	WEBKIT_PARTIAL_TAB_LOOP,
} from "@a11y-pulse/integration-harness";
import type { Result } from "axe-core";
import { afterAll, beforeAll, expect, it } from "vitest";
import { AUDIT_FAILED_TAG, BrowserClosedError } from "../../src/audit-failure";
import {
	AUDIT_IDS,
	type AuditAdaptors,
	type AuditRunnerResult,
	runAllAudits,
} from "../../src/run-audits";
import { toJson } from "../../src/serialise";
import { CONTEXT_CHANGE_ON_FOCUS_AUDIT_ID } from "../../src/to-axe/context-change-on-focus";
import { DISCLOSURE_OPERABILITY_AUDIT_ID } from "../../src/to-axe/disclosure-operability";
import { FOCUS_APPEARANCE_AUDIT_ID } from "../../src/to-axe/focus-appearance";
import { FOCUS_INDICATOR_CONTRAST_AUDIT_ID } from "../../src/to-axe/focus-indicator-contrast";
import { FOCUS_NOT_OBSCURED_AUDIT_ID } from "../../src/to-axe/focus-not-obscured";
import { KEYBOARD_TRAP_AUDIT_ID } from "../../src/to-axe/keyboard-trap";
import { MOVING_CONTENT_AUDIT_ID } from "../../src/to-axe/moving-content";
import { ACCESSIBLE_AUTHENTICATION_AUDIT_ID } from "../../src/to-axe/paste-blocking";
import { REFLOW_AUDIT_ID } from "../../src/to-axe/reflow";
import { RESIZE_TEXT_AUDIT_ID } from "../../src/to-axe/resize-text";
import { SKIP_LINK_AUDIT_ID } from "../../src/to-axe/skip-link";
import { TEXT_SPACING_AUDIT_ID } from "../../src/to-axe/text-spacing";
import {
	CONTROL_WITHOUT_ROLE_AUDIT_ID,
	KEYBOARD_REACHABILITY_AUDIT_ID,
} from "../../src/to-axe/unreachable-controls";
import { BACK_SETTLE_MS, type HostileServer, startHostileServer } from "../helpers/hostile-server";
import { adaptors } from "./helpers/adaptors";

let server: FixtureServer;
let hostile: HostileServer;

// The moving content audit watches the page for five seconds. Only the tests about it wait.
const NO_WATCHING = { skip: [MOVING_CONTENT_AUDIT_ID] };

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url));
	hostile = await startHostileServer();
});

afterAll(async () => {
	await server.close();
	await hostile.close();
});

/** The entries reporting audits that could not be completed, by audit id. */
function failedAudits(result: AuditRunnerResult): Map<string, string> {
	return new Map(
		result.incomplete
			.filter((audit) => audit.tags.includes(AUDIT_FAILED_TAG))
			.map((audit) => [audit.id, audit.description]),
	);
}

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

			// The audits with a step of their own report even with nothing to find. The focus indicator
			// contrast check only reports indicators it measured, and has its own test.
			for (const id of [
				MOVING_CONTENT_AUDIT_ID,
				ACCESSIBLE_AUTHENTICATION_AUDIT_ID,
				KEYBOARD_REACHABILITY_AUDIT_ID,
				CONTROL_WITHOUT_ROLE_AUDIT_ID,
				RESIZE_TEXT_AUDIT_ID,
				DISCLOSURE_OPERABILITY_AUDIT_ID,
			]) {
				expect(ids, id).toContain(id);
			}

			expect(failedAudits(result)).toEqual(new Map());

			// axe-core's own rules report alongside the A11y Pulse audits.
			expect(result.passes.some((audit) => audit.id === "document-title")).toBe(true);

			expect(find(result.violations, REFLOW_AUDIT_ID)?.nodes[0]?.target).toEqual(["#wide"]);
			expect(find(result.passes, SKIP_LINK_AUDIT_ID)?.nodes).toHaveLength(1);

			expect(page.viewportSize()).toMatchObject({ width: 1280, height: 800 });
			await page.close();
		});

		it("tabs the page once for every tab-driven audit", async () => {
			const page = await engine.newPage();

			await page.goto(`${server.url}/kitchen-sink.html`);

			const result = await runAllAudits(page.adaptor, {
				...NO_WATCHING,
				focusAppearance: { skipStyleCheck: true },
			});

			const nodeCount = (id: string): number =>
				[result.violations, result.incomplete, result.passes]
					.flat()
					.filter((audit) => audit.id === id)
					.reduce((total, audit) => total + audit.nodes.length, 0);

			const stops = nodeCount(FOCUS_NOT_OBSCURED_AUDIT_ID);
			expect(nodeCount(FOCUS_APPEARANCE_AUDIT_ID)).toBe(stops);

			// The unreachable controls audit rode the same pass: it reports, and reached a verdict.
			expect(find(result.passes, KEYBOARD_REACHABILITY_AUDIT_ID)).toBeDefined();

			// One pass is a Tab per stop and one more to leave the page. What is left over is the skip
			// link audit tabbing to the first few stops; a second pass would add at least another
			// `stops + 1`.
			const tabs = page.keyPresses.filter((key) => key === "Tab").length;
			const skipLinkTabs = tabs - (stops + 1);
			expect(stops).toBe(4);
			expect(skipLinkTabs).toBeGreaterThanOrEqual(0);
			expect(skipLinkTabs).toBeLessThanOrEqual(3);

			await page.close();
		});

		it("reports the contrast of focus indicators from the tab pass's own measurements", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/kitchen-sink.html`);

			const result = await runAllAudits(page.adaptor, NO_WATCHING);
			const measured = [result.violations, result.incomplete, result.passes]
				.flat()
				.filter((audit) => audit.id === FOCUS_INDICATOR_CONTRAST_AUDIT_ID)
				.flatMap((audit) => audit.nodes);

			expect(measured.length).toBeGreaterThan(0);
			expect(measured[0]?.any[0]?.data).toMatchObject({ method: expect.any(String) });

			// One Tab per stop and one to leave, plus the skip link audit's few: no second pass.
			const stops = [result.violations, result.incomplete, result.passes]
				.flat()
				.filter((audit) => audit.id === FOCUS_NOT_OBSCURED_AUDIT_ID)
				.reduce((total, audit) => total + audit.nodes.length, 0);
			const tabs = page.keyPresses.filter((key) => key === "Tab").length;
			expect(tabs).toBeLessThanOrEqual(stops + 1 + 3);

			await page.close();
		});

		it("leaves out the audits it is told to skip, and their work", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/kitchen-sink.html`);

			const started = performance.now();
			const steps: string[] = [];
			const result = await runAllAudits(page.adaptor, {
				skip: AUDIT_IDS.filter((id) => id !== REFLOW_AUDIT_ID && id !== FOCUS_APPEARANCE_AUDIT_ID),
				focusAppearance: { skipStyleCheck: true },
				onProgress: (step) => steps.push(step),
			});

			expect(auditIds(result)).toEqual(new Set([FOCUS_APPEARANCE_AUDIT_ID, REFLOW_AUDIT_ID]));
			expect(steps).toEqual(["Tabbing through focusable elements", "Running reflow audit"]);
			// Nothing watched the page for five seconds.
			expect(performance.now() - started).toBeLessThan(5000);

			await page.close();
		});

		it("presses no keys when every keyboard-driven audit is skipped", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/kitchen-sink.html`);

			const result = await runAllAudits(page.adaptor, {
				skip: AUDIT_IDS.filter((id) => id !== "axe-core" && id !== TEXT_SPACING_AUDIT_ID),
			});

			expect(page.keyPresses).toEqual([]);
			expect(auditIds(result)).toContain(TEXT_SPACING_AUDIT_ID);
			expect(auditIds(result)).toContain("document-title");

			await page.close();
		});

		it("rejects an audit id it does not know rather than silently running everything", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/kitchen-sink.html`);

			await expect(runAllAudits(page.adaptor, { skip: ["moving-contnet"] })).rejects.toThrow(
				/unknown audit moving-contnet/,
			);

			await page.close();
		});

		it("does not run the resize text audit from a phone-sized viewport", async () => {
			const page = await engine.newPage();
			await page.adaptor.reflow.setViewport({ width: 390, height: 844 });
			await page.goto(`${server.url}/kitchen-sink.html`);

			const result = await runAllAudits(page.adaptor, {
				skip: AUDIT_IDS.filter((id) => id !== RESIZE_TEXT_AUDIT_ID),
			});

			expect(find(result.inapplicable, RESIZE_TEXT_AUDIT_ID)).toBeDefined();
			expect(auditIds(result)).toEqual(new Set([RESIZE_TEXT_AUDIT_ID]));
			expect(page.viewportSize()).toMatchObject({ width: 390, height: 844 });

			await page.close();
		});

		it("serialises screenshot evidence as base64", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/kitchen-sink.html`);

			const result = await runAllAudits(page.adaptor, {
				...NO_WATCHING,
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

		it("names the element whose focus tries to navigate, and stays on the page", async () => {
			const page = await engine.newPage();
			const url = `${hostile.url}/nav-on-focus.html`;
			await page.goto(url);

			// Browsers with the Navigation API let the tab pass cancel the navigation and carry on.
			// In the others the page leaves and is brought back, as in the next test.
			const cancellable = await page.adaptor.browser.evaluate(() => "navigation" in window);
			const warnings: string[] = [];
			const result = await runAllAudits(page.adaptor, {
				...NO_WATCHING,
				focusAppearance: { skipStyleCheck: true },
				onWarning: (message) => warnings.push(message),
			});
			const contextChange = find(result.violations, CONTEXT_CHANGE_ON_FOCUS_AUDIT_ID);

			expect(result.url).toBe(url);
			expect(page.url().replace(/#.*$/, "")).toBe(url);
			expect(contextChange?.nodes).toHaveLength(1);

			if (cancellable) {
				expect(warnings).toEqual([]);
				expect(contextChange?.nodes[0]?.target).toEqual(["#jumpy"]);
				expect(contextChange?.nodes[0]?.failureSummary).toContain(
					`a page navigation (to ${hostile.url}/other.html)`,
				);
			} else {
				expect(warnings).toEqual([
					expect.stringContaining(`navigated to ${hostile.url}/other.html`),
				]);
				expect(contextChange?.nodes[0]?.failureSummary).toContain(
					`The element after this one in the tab order navigated the page to ${hostile.url}/other.html`,
				);
			}

			expect(find(result.violations, REFLOW_AUDIT_ID)?.nodes[0]?.target).toEqual(["#wide"]);
			expect(find(result.passes, SKIP_LINK_AUDIT_ID)?.nodes).toHaveLength(1);
			expect(failedAudits(result).has(REFLOW_AUDIT_ID)).toBe(false);

			await page.close();
		});

		it("returns to the page when focusing an element navigates away", async () => {
			const page = await engine.newPage();
			const url = `${hostile.url}/back-on-focus.html`;
			await page.goto(`${hostile.url}/other.html`);
			await page.goto(url);

			const warnings: string[] = [];
			const result = await runAllAudits(page.adaptor, {
				...NO_WATCHING,
				focusAppearance: { skipStyleCheck: true },
				contextChangeOnFocus: { screenshotSettleDelay: 2 * BACK_SETTLE_MS },
				onWarning: (message) => warnings.push(message),
			});

			// The audits that follow the tab pass measured the page the report names, not /other.html.
			expect(result.url).toBe(url);
			expect(page.url().replace(/#.*$/, "")).toBe(url);
			expect(warnings).toEqual([expect.stringContaining(`navigated to ${hostile.url}/other.html`)]);
			expect(find(result.violations, REFLOW_AUDIT_ID)?.nodes[0]?.target).toEqual(["#wide"]);
			expect(find(result.passes, SKIP_LINK_AUDIT_ID)?.nodes).toHaveLength(1);
			expect(auditIds(result)).toContain(TEXT_SPACING_AUDIT_ID);
			expect(failedAudits(result).has(REFLOW_AUDIT_ID)).toBe(false);

			// The element that left could not be read, so the violation is pinned on the link before it.
			const contextChange = find(result.violations, CONTEXT_CHANGE_ON_FOCUS_AUDIT_ID);

			expect(contextChange?.nodes).toHaveLength(1);
			expect(contextChange?.nodes[0]?.html).toContain('href="#c"');
			expect(contextChange?.nodes[0]?.failureSummary).toContain(
				`The element after this one in the tab order navigated the page to ${hostile.url}/other.html`,
			);

			await page.close();
		});

		it("returns to the page from inside it when the adaptors cannot navigate", async () => {
			const page = await engine.newPage();
			const url = `${hostile.url}/back-on-focus.html`;
			await page.goto(`${hostile.url}/other.html`);
			await page.goto(url);

			const result = await runAllAudits(
				{ ...page.adaptor, navigate: undefined },
				{ ...NO_WATCHING, focusAppearance: { skipStyleCheck: true } },
			);

			expect(page.url().replace(/#.*$/, "")).toBe(url);
			expect(find(result.violations, REFLOW_AUDIT_ID)?.nodes[0]?.target).toEqual(["#wide"]);

			await page.close();
		});

		it("finishes on a page that raises a dialog when an element is focused", async () => {
			const page = await engine.newPage();
			await page.goto(`${hostile.url}/alert-on-focus.html`);

			const result = await runAllAudits(page.adaptor, {
				...NO_WATCHING,
				focusAppearance: { skipStyleCheck: true },
			});

			expect(failedAudits(result)).toEqual(new Map());

			// The tab pass went on past the button that raised the dialog.
			const tabbed = [result.violations, result.incomplete, result.passes]
				.flat()
				.filter((audit) => audit.id === FOCUS_NOT_OBSCURED_AUDIT_ID)
				.flatMap((audit) => audit.nodes.map((node) => node.target[0]));
			expect(tabbed).toContain("#noisy");
			expect(tabbed).toContain("#after");

			await page.close();
		});

		it("reports an audit that throws as incomplete and keeps every other result", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/kitchen-sink.html`);

			const reflow = new Proxy(page.adaptor.reflow, {
				get: (target, property, receiver) =>
					property === "setViewport"
						? async () => {
								throw new Error("The viewport refused to resize");
							}
						: Reflect.get(target, property, receiver),
			});

			const result = await runAllAudits(
				{ ...page.adaptor, reflow },
				{ ...NO_WATCHING, focusAppearance: { skipStyleCheck: true } },
			);

			expect(failedAudits(result)).toEqual(
				new Map([[REFLOW_AUDIT_ID, expect.stringContaining("The viewport refused to resize")]]),
			);
			// Never a pass, and never missing: a reader must be able to tell it did not run.
			expect(find(result.passes, REFLOW_AUDIT_ID)).toBeUndefined();
			expect(find(result.violations, REFLOW_AUDIT_ID)).toBeUndefined();

			expect(result.passes.some((audit) => audit.id === "document-title")).toBe(true);
			expect(find(result.passes, SKIP_LINK_AUDIT_ID)?.nodes).toHaveLength(1);
			expect(find(result.violations, FOCUS_NOT_OBSCURED_AUDIT_ID)).toBeDefined();
			expect(auditIds(result)).toContain(TEXT_SPACING_AUDIT_ID);

			await page.close();
		});

		it("runs axe-core inside a same-origin frame, with the options it was given", async () => {
			const page = await engine.newPage();
			await page.goto(`${hostile.url}/framed.html`);

			const onlyAxe = { skip: AUDIT_IDS.filter((id) => id !== "axe-core") };
			const result = await runAllAudits(page.adaptor, onlyAxe);

			// The image is inside the frame: its target is the frame, then the image within it.
			expect(find(result.violations, "image-alt")?.nodes.map((node) => node.target)).toEqual([
				["#embed", "#unlabelled"],
			]);
			// A frame axe-core could not get into is reported under this rule for review instead.
			expect(find(result.incomplete, "frame-tested")).toBeUndefined();
			expect(auditIds(result).size).toBeGreaterThan(5);

			const narrowed = await runAllAudits(page.adaptor, {
				...onlyAxe,
				axe: { runOnly: { type: "rule", values: ["image-alt"] } },
			});

			expect([...auditIds(narrowed)]).toEqual(["image-alt"]);
			expect(find(narrowed.violations, "image-alt")?.nodes).toHaveLength(1);

			await page.close();
		});

		it("keeps the results of earlier audits when one hangs until the time limit", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/kitchen-sink.html`);

			// The reflow audit asks for the viewport and is never answered.
			const reflow = new Proxy(page.adaptor.reflow, {
				get: (target, property, receiver) =>
					property === "getViewport"
						? () => new Promise<never>(() => {})
						: Reflect.get(target, property, receiver),
			});

			const result = await runAllAudits(
				{ ...page.adaptor, reflow },
				{ ...NO_WATCHING, focusAppearance: { skipStyleCheck: true }, maxDuration: 20_000 },
			);

			const failures = failedAudits(result);

			// The audit that hung says it was cut off, and the two steps after it (the keyboard trap's
			// escape attempts and the disclosure audit) that they never started.
			expect(failures.get(REFLOW_AUDIT_ID)).toContain("time limit while it was running");

			for (const id of [KEYBOARD_TRAP_AUDIT_ID, DISCLOSURE_OPERABILITY_AUDIT_ID]) {
				expect(failures.get(id)).toContain(
					"skipped because the run reached its 20000ms time limit",
				);
			}

			expect([...failures.keys()].sort()).toEqual(
				[REFLOW_AUDIT_ID, KEYBOARD_TRAP_AUDIT_ID, DISCLOSURE_OPERABILITY_AUDIT_ID].sort(),
			);

			// Everything that finished before it is reported as it was found.
			expect(result.passes.some((audit) => audit.id === "document-title")).toBe(true);
			expect(find(result.passes, SKIP_LINK_AUDIT_ID)?.nodes).toHaveLength(1);
			expect(find(result.violations, FOCUS_NOT_OBSCURED_AUDIT_ID)).toBeDefined();
			expect(auditIds(result)).toContain(TEXT_SPACING_AUDIT_ID);
			expect(result.url).toBe(`${server.url}/kitchen-sink.html`);

			await page.close();
		});

		it("keeps the tab stops reached when the time limit falls inside the tab pass", async () => {
			const page = await engine.newPage();
			await page.goto(`${hostile.url}/many-buttons.html`);

			const warnings: string[] = [];
			const result = await runAllAudits(page.adaptor, {
				...NO_WATCHING,
				maxDuration: 9000,
				onWarning: (message) => warnings.push(message),
			});

			const failures = failedAudits(result);

			for (const id of [
				FOCUS_APPEARANCE_AUDIT_ID,
				FOCUS_NOT_OBSCURED_AUDIT_ID,
				CONTEXT_CHANGE_ON_FOCUS_AUDIT_ID,
				KEYBOARD_REACHABILITY_AUDIT_ID,
				CONTROL_WITHOUT_ROLE_AUDIT_ID,
			]) {
				expect(failures.has(id), `${id} should report what it saw`).toBe(false);
			}

			const reached = find(result.passes, FOCUS_NOT_OBSCURED_AUDIT_ID)?.nodes ?? [];

			expect(reached.length).toBeGreaterThan(10);
			expect(reached.length).toBeLessThan(800);
			expect(warnings.join("\n")).toMatch(/The tab pass reached its limit after \d+ tab stops/);

			await page.close();
		});

		it("returns within the time limit from a page that has stopped responding", async () => {
			const page = await engine.newPage();
			await page.goto(`${hostile.url}/blocked.html`);
			// The page's script stops yielding 50ms after load.
			await new Promise((resolve) => setTimeout(resolve, 300));

			const startedAt = Date.now();
			const result = await runAllAudits(page.adaptor, {
				maxDuration: 3000,
				url: `${hostile.url}/blocked.html`,
			});
			const took = Date.now() - startedAt;

			expect(took).toBeGreaterThanOrEqual(2900);
			expect(took).toBeLessThan(3000 + 2000);

			expect(result.url).toBe(`${hostile.url}/blocked.html`);
			expect(result.passes).toEqual([]);
			expect(result.violations).toEqual([]);
			expect([...failedAudits(result).keys()].sort()).toEqual([...AUDIT_IDS].sort());
			expect(result.testEnvironment.userAgent).toBe("");

			// Not awaited: a page stuck in a loop may never confirm that it closed.
			void page.close().catch(() => {});
		});

		it("abandons the run when the page closes under it", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/kitchen-sink.html`);

			let closing: Promise<void> | undefined;
			const run = runAllAudits(page.adaptor, {
				...NO_WATCHING,
				focusAppearance: { skipStyleCheck: true },
				onProgress: (step) => {
					if (step === "Tabbing through focusable elements") {
						closing = page.close();
					}
				},
			});

			// Rejected outright: a set of incomplete audits would read as a report on the page.
			await expect(run).rejects.toBeInstanceOf(BrowserClosedError);
			await closing;
		});

		it("reports the audits it never started as skipped once the time limit has passed", async () => {
			const page = await engine.newPage();
			await page.goto(`${server.url}/kitchen-sink.html`);

			// Held up after axe-core has run, for longer than the whole run is allowed.
			const result = await runAllAudits(page.adaptor, {
				...NO_WATCHING,
				maxDuration: 3000,
				onProgress: (step) => {
					if (step === "Checking image alt text") {
						const until = Date.now() + 3500;

						while (Date.now() < until) {}
					}
				},
			});

			expect(result.passes.some((audit) => audit.id === "document-title")).toBe(true);

			const failures = failedAudits(result);
			expect(failures.get(REFLOW_AUDIT_ID)).toContain("3000ms time limit");
			expect(failures.get(FOCUS_APPEARANCE_AUDIT_ID)).toContain("3000ms time limit");
			expect(failures.has("axe-core")).toBe(false);
			expect(find(result.passes, REFLOW_AUDIT_ID)).toBeUndefined();

			await page.close();
		});
	},
);
