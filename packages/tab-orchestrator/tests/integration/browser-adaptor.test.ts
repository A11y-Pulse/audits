import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { getSelector, resolveSelector, truncateHtml } from "@a11y-pulse/browser-adaptor/dom";
import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import {
	describeEachEngine,
	type FixtureServer,
	isPng,
	pngSize,
	startFixtureServer,
	WEBKIT_NO_LINK_FOCUS,
} from "@a11y-pulse/integration-harness";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createTabOrchestrator } from "../../src/orchestrator";
import type { TabConsumer } from "../../src/types";

let server: FixtureServer;

beforeAll(async () => {
	server = await startFixtureServer(new URL("fixtures", import.meta.url), {
		headers: (pathname) =>
			pathname === "/csp.html"
				? { "Content-Security-Policy": "script-src 'none'; require-trusted-types-for 'script'" }
				: undefined,
	});
});

afterAll(async () => {
	await server.close();
});

function activeId(): string {
	return document.activeElement?.id ?? "";
}

function shadowButtonScript(): Element | null {
	return document.querySelector("x-card")?.shadowRoot?.querySelector("button") ?? null;
}

function lightButtonScript(): Element | null {
	return document.querySelector("button.x");
}

function outerHtmlScript(id: string): string {
	return document.getElementById(id)?.outerHTML ?? "";
}

// The driver's own page behind each adaptor, for tests that play the part of a caller who also
// listens to it directly. Both drivers' pages are event emitters with this much in common.
type DialogLike = { accept(): Promise<void> };
type RawPage = {
	on(event: "dialog", listener: (dialog: DialogLike) => void): unknown;
	off(event: "dialog", listener: (dialog: DialogLike) => void): unknown;
	listenerCount(event: "dialog"): number;
};

const rawPages = new WeakMap<BrowserAdaptor, RawPage>();

function remember(adaptor: BrowserAdaptor, page: unknown): BrowserAdaptor {
	rawPages.set(adaptor, page as RawPage);

	return adaptor;
}

function confirmScript(): boolean {
	return confirm("Leave this page?");
}

describeEachEngine<BrowserAdaptor>(
	"browser adaptors against a real page (integration)",
	{
		adaptor: {
			puppeteer: (page) => remember(new PuppeteerAdaptor(page), page),
			playwright: (page) => remember(new PlaywrightAdaptor(page), page),
		},
		screenshotClipScale: 2,
		unsupported: { "playwright-webkit": WEBKIT_NO_LINK_FOCUS },
	},
	(engine) => {
		it("passes serialisable arguments and element handles into the page function", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/markup.html`);
				const handle = await page.adaptor.evaluateHandle(lightButtonScript);

				const described = await page.adaptor.evaluate(
					(element: Element, prefix: string, extra: { suffix: string }) =>
						`${prefix}${element.textContent}${extra.suffix}`,
					handle,
					"<",
					{ suffix: ">" },
				);

				await page.adaptor.disposeRef(handle);
				expect(described).toBe("<Light>");
			} finally {
				await page.close();
			}
		});

		it("moves focus backwards on Shift+Tab, and the harness records the combination", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/autofocus.html`);
				await page.adaptor.ensureFocusReporting();
				await page.adaptor.pressKey("Shift+Tab");
				const backwards = await page.adaptor.evaluate(activeId);
				await page.adaptor.pressTab();
				const forwards = await page.adaptor.evaluate(activeId);

				expect(backwards).toBe("help");
				expect(forwards).toBe("email");
				expect(page.keyPresses).toEqual(["Shift+Tab", "Tab"]);
			} finally {
				await page.close();
			}
		});

		it("screenshots a clip at the requested scale without the page seeing a resize", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/markup.html`);
				await page.adaptor.evaluate(() => {
					(window as Window & { resizes?: number }).resizes = 0;
					window.addEventListener("resize", () => {
						(window as Window & { resizes?: number }).resizes!++;
					});
				});
				const bytes = await page.adaptor.screenshotClip({ x: 0, y: 0, width: 40, height: 20 }, 2);
				const resizes = await page.adaptor.evaluate(
					() => (window as Window & { resizes?: number }).resizes,
				);

				expect(isPng(bytes)).toBe(true);
				expect(pngSize(bytes)).toEqual({ width: 80, height: 40 });
				expect(resizes).toBe(0);
				expect(page.viewportSize()).toEqual({ width: 800, height: 600 });
			} finally {
				await page.close();
			}
		});

		it("keeps a page reporting focus after another page takes the foreground", async () => {
			const page = await engine.newPage();
			const other = await engine.newPage();

			try {
				await page.goto(`${server.url}/autofocus.html`);
				await other.goto(`${server.url}/markup.html`);
				await other.bringToFront();
				await page.adaptor.ensureFocusReporting();
				await page.adaptor.pressTab();

				const state = await page.adaptor.evaluate(() => ({
					hasFocus: document.hasFocus(),
					focusMatches: document.activeElement?.matches(":focus") ?? false,
				}));

				expect(state).toEqual({ hasFocus: true, focusMatches: true });
			} finally {
				await other.close();
				await page.close();
			}
		});

		it("counts each dialog it dismisses once", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/markup.html`);
				const stop = page.adaptor.startDismissingDialogs?.();
				const answer = await page.adaptor.evaluate(() => {
					alert("one");

					return confirm("two");
				});
				stop?.();

				expect(answer).toBe(false);
				expect(page.adaptor.takeDismissedDialogs?.()).toBe(2);
				expect(page.adaptor.takeDismissedDialogs?.()).toBe(0);
			} finally {
				await page.close();
			}
		});

		it("closes a dialog that was already open when it starts dismissing them", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/markup.html`);

				// Puppeteer leaves the dialog open, blocking the page; Playwright dismisses it at once,
				// nothing listening for dialogs.
				const raised = page.adaptor.evaluate(() => confirm("still here?"));
				await Promise.race([raised, new Promise((resolve) => setTimeout(resolve, 250))]);

				const stop = page.adaptor.startDismissingDialogs?.();
				const answer = await raised;
				const title = await page.adaptor.evaluate(() => document.title);
				stop?.();

				expect(answer).toBe(false);
				expect(typeof title).toBe("string");
				// It predates the dismissing, so it is not counted as one of its dialogs.
				expect(page.adaptor.takeDismissedDialogs?.()).toBe(0);
			} finally {
				await page.close();
			}
		});

		it("leaves a caller's own dialog handler alone once a session has ended", async () => {
			const page = await engine.newPage();
			const raw = rawPages.get(page.adaptor)!;
			const failures: unknown[] = [];
			const accept = (dialog: DialogLike): void => {
				dialog.accept().catch((error) => failures.push(error));
			};
			const consumer: TabConsumer = { capabilities: new Set(), onTabStop() {} };

			try {
				await page.goto(`${server.url}/alert-on-focus.html`);
				const before = raw.listenerCount("dialog");
				const orchestrator = createTabOrchestrator(page.adaptor, { screenshotSettleDelay: 0 });
				orchestrator.attach(consumer);
				const stats = await orchestrator.run();

				// The session dismissed the alert its tabbing raised, and took its listener with it.
				expect(stats.dialogsDismissed).toBe(1);
				expect(raw.listenerCount("dialog")).toBe(before);

				raw.on("dialog", accept);
				const answer = await page.adaptor.evaluate(confirmScript);

				// Accepted by the caller's handler, which nothing got to before it.
				expect(answer).toBe(true);
				expect(failures).toEqual([]);
				expect(page.adaptor.takeDismissedDialogs?.()).toBe(0);
			} finally {
				raw.off("dialog", accept);
				await page.close();
			}
		});

		it("lets a caller's handler answer a dialog while the adaptor is dismissing them", async () => {
			const page = await engine.newPage();
			const raw = rawPages.get(page.adaptor)!;
			const failures: unknown[] = [];
			const accept = (dialog: DialogLike): void => {
				dialog.accept().catch((error) => failures.push(error));
			};

			try {
				await page.goto(`${server.url}/markup.html`);
				const stop = page.adaptor.startDismissingDialogs?.();
				// Registered after the adaptor's listener, so it is called second.
				raw.on("dialog", accept);
				const answer = await page.adaptor.evaluate(confirmScript);
				stop?.();

				expect(answer).toBe(true);
				expect(failures).toEqual([]);
			} finally {
				raw.off("dialog", accept);
				await page.close();
			}
		});

		it("names an element in a shadow root so that it cannot be mistaken for one outside it", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/markup.html`);
				const shadow = await page.adaptor.evaluateHandle(shadowButtonScript);
				const light = await page.adaptor.evaluateHandle(lightButtonScript);
				const shadowSelector = await page.adaptor.evaluate(getSelector, shadow);
				const lightSelector = await page.adaptor.evaluate(getSelector, light);
				await page.adaptor.disposeRef(shadow);
				await page.adaptor.disposeRef(light);

				expect(shadowSelector).toBe("x-card >>> button.x");
				expect(lightSelector).toBe("button.x");

				// resolveSelector is itself a page function, so it travels as source like any other.
				const resolve = `(${resolveSelector.toString()})`;
				const texts = await page.adaptor.evaluate(
					(selectors: string[], source: string) => {
						const fn = new Function(`return ${source}`)() as (selector: string) => Element | null;

						return selectors.map((selector) => fn(selector)?.textContent ?? null);
					},
					[shadowSelector, lightSelector, "x-card >>> a", "nope >>> button"],
					resolve,
				);

				expect(texts).toEqual(["Shadow", "Light", null, null]);
			} finally {
				await page.close();
			}
		});

		it("keeps a whole opening tag whose attribute holds a >, and redacts a text field's value", async () => {
			const page = await engine.newPage();

			try {
				await page.goto(`${server.url}/markup.html`);
				const link = await page.adaptor.evaluate(outerHtmlScript, "next");
				const field = await page.adaptor.evaluate(outerHtmlScript, "email");

				// Browsers differ on whether they escape the > when serialising, so compare against
				// what this one produced rather than a fixed string.
				expect(link.endsWith(' class="btn primary">Next</a>')).toBe(true);
				expect(truncateHtml(link)).toBe(link.slice(0, -"Next</a>".length));
				expect(truncateHtml(field)).toBe('<input id="email" type="email" value="[redacted]">');

				// Another attribute mentioning a type must not pass for the input's own.
				const pin = truncateHtml(await page.adaptor.evaluate(outerHtmlScript, "card-pin"));

				expect(pin).not.toContain("hunter2");
				expect(pin).toContain('value="[redacted]"');
			} finally {
				await page.close();
			}
		});

		it("tabs through a page whose Content-Security-Policy forbids eval", async () => {
			const page = await engine.newPage();
			const selectors: string[] = [];
			const consumer: TabConsumer = {
				capabilities: new Set(),
				onTabStop(snapshot) {
					selectors.push(snapshot.activeElement.selector);
				},
			};

			try {
				await page.goto(`${server.url}/csp.html`);
				const orchestrator = createTabOrchestrator(page.adaptor, { screenshotSettleDelay: 0 });
				orchestrator.attach(consumer);
				const stats = await orchestrator.run();

				expect(selectors).toEqual(["#first", "#last"]);
				expect(stats.endReason).toBe("completed");
			} finally {
				await page.close();
			}
		});
	},
);
