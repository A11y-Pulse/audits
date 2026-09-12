import { existsSync } from "node:fs";
import type { Page as PlaywrightPage } from "playwright-core";
import { chromium, firefox, webkit } from "playwright-core";
import type { Page as PuppeteerPage } from "puppeteer";
import puppeteer from "puppeteer";
import { afterAll, beforeAll, describe, it } from "vitest";

export type EngineName =
	| "puppeteer"
	| "playwright-chromium"
	| "playwright-firefox"
	| "playwright-webkit";

/**
 * Builds the audit's adaptor from whichever page type the engine produced. Every audit declares its
 * own adaptor interface, so the harness stays generic over it.
 */
export type AdaptorFactories<A> = {
	puppeteer: (page: PuppeteerPage) => A;
	playwright: (page: PlaywrightPage) => A;
};

export type EngineOptions<A> = {
	adaptor: AdaptorFactories<A>;

	/**
	 * Engines whose results this audit cannot trust, mapped to why. The suite is skipped there and
	 * the reason is printed with it, so the gap stays visible rather than looking like coverage.
	 */
	unsupported?: Partial<Record<EngineName, string>>;

	/**
	 * The adaptor's `screenshotClipScale`. Chromium applies the scale per capture, but Firefox and
	 * WebKit can only capture at the context's own device scale factor, so they are given a context
	 * matching it. Suites that never screenshot can leave it at 1.
	 */
	screenshotClipScale?: number;

	viewport?: { width: number; height: number };
};

export type EnginePage<A> = {
	adaptor: A;
	goto: (url: string) => Promise<void>;
	close: () => Promise<void>;
	bringToFront: () => Promise<void>;
	viewportSize: () => { width: number; height: number } | null;
	url: () => string;

	/** Fires if the page ever opens a real popup window. */
	onPopup: (listener: () => void) => void;

	/** Every key pressed through the page's keyboard, in order. */
	keyPresses: string[];
};

export type EngineHandle<A> = {
	name: EngineName;
	driver: "puppeteer" | "playwright";
	newPage: () => Promise<EnginePage<A>>;
};

type LaunchedEngine<A> = {
	newPage: () => Promise<EnginePage<A>>;
	close: () => Promise<void>;
};

type Keyboard = {
	// biome-ignore lint/suspicious/noExplicitAny: each engine types `key` as its own union of key names.
	press: (key: any, options?: any) => Promise<void>;
};

export const WEBKIT_NO_LINK_FOCUS = "WebKit does not move focus to links when Tab is pressed";

export const WEBKIT_PARTIAL_TAB_LOOP = `${WEBKIT_NO_LINK_FOCUS}, so the audit only reaches a subset of the page`;

const DEFAULT_VIEWPORT = { width: 800, height: 600 };

const PLAYWRIGHT_TYPES = {
	"playwright-chromium": chromium,
	"playwright-firefox": firefox,
	"playwright-webkit": webkit,
} as const;

// Only Puppeteer is a dev dependency. When Playwright's browsers are not installed, we skip running
// the suite for those browsers.
function browserInstalled(name: EngineName): boolean {
	if (name === "puppeteer") {
		return true;
	}

	try {
		return existsSync(PLAYWRIGHT_TYPES[name].executablePath());
	} catch {
		return false;
	}
}

/**
 * Whether an absent browser should fail its suite instead of skipping it.
 */
function browsersRequired(): boolean {
	const value = process.env.A11Y_PULSE_REQUIRE_BROWSERS?.trim();

	return !!value && value !== "0" && value !== "false";
}

export const ENGINE_NAMES: readonly EngineName[] = [
	"puppeteer",
	"playwright-chromium",
	"playwright-firefox",
	"playwright-webkit",
];

// Presses are recorded at the page rather than on the adaptor, so a press from anywhere else in the
// audit is counted too.
function recordPresses(keyboard: Keyboard, keyPresses: string[]): void {
	const press = keyboard.press.bind(keyboard);
	keyboard.press = async (key: string, options?: unknown) => {
		keyPresses.push(key);

		return press(key, options);
	};
}

/**
 * The engines to run, narrowed by the A11Y_PULSE_ENGINES environment variable when it is set to a
 * comma-separated list of names.
 */
export function selectedEngines(): readonly EngineName[] {
	const requested = process.env.A11Y_PULSE_ENGINES?.trim();

	if (!requested) {
		return ENGINE_NAMES;
	}

	const names = requested.split(",").map((name) => name.trim());
	const unknown = names.filter((name) => !ENGINE_NAMES.includes(name as EngineName));

	if (unknown.length > 0) {
		throw new Error(
			`Unknown engine(s) in A11Y_PULSE_ENGINES: ${unknown.join(", ")}. Expected ${ENGINE_NAMES.join(", ")}.`,
		);
	}

	return names as EngineName[];
}

async function launchPuppeteer<A>(options: EngineOptions<A>): Promise<LaunchedEngine<A>> {
	const viewport = options.viewport ?? DEFAULT_VIEWPORT;
	const browser = await puppeteer.launch({ defaultViewport: viewport });

	return {
		newPage: async () => {
			const page = await browser.newPage();
			const keyPresses: string[] = [];
			recordPresses(page.keyboard, keyPresses);

			return {
				adaptor: options.adaptor.puppeteer(page),
				goto: async (url) => {
					await page.goto(url, { waitUntil: "load" });
				},
				close: () => page.close(),
				bringToFront: () => page.bringToFront(),
				viewportSize: () => {
					const current = page.viewport();

					return current ? { width: current.width, height: current.height } : null;
				},
				url: () => page.url(),
				onPopup: (listener) => {
					page.once("popup", listener);
				},
				keyPresses,
			};
		},
		close: () => browser.close(),
	};
}

async function launchPlaywright<A>(
	name: Exclude<EngineName, "puppeteer">,
	options: EngineOptions<A>,
): Promise<LaunchedEngine<A>> {
	const browser = await PLAYWRIGHT_TYPES[name].launch();
	// Chromium screenshots over CDP, which applies the clip scale itself. The other two can only
	// capture at the context's device scale factor, so it has to carry the scale instead.
	const deviceScaleFactor = name === "playwright-chromium" ? 1 : (options.screenshotClipScale ?? 1);

	return {
		newPage: async () => {
			const page = await browser.newPage({
				viewport: options.viewport ?? DEFAULT_VIEWPORT,
				deviceScaleFactor,
			});
			const keyPresses: string[] = [];
			recordPresses(page.keyboard, keyPresses);

			return {
				adaptor: options.adaptor.playwright(page),
				goto: async (url) => {
					await page.goto(url, { waitUntil: "load" });
				},
				close: () => page.close(),
				bringToFront: () => page.bringToFront(),
				viewportSize: () => page.viewportSize(),
				url: () => page.url(),
				onPopup: (listener) => {
					page.once("popup", listener);
				},
				keyPresses,
			};
		},
		close: () => browser.close(),
	};
}

function launch<A>(name: EngineName, options: EngineOptions<A>): Promise<LaunchedEngine<A>> {
	return name === "puppeteer" ? launchPuppeteer(options) : launchPlaywright(name, options);
}

/**
 * Run the same integration suite once per browser engine, launching one browser per engine.
 */
export function describeEachEngine<A>(
	name: string,
	options: EngineOptions<A>,
	body: (engine: EngineHandle<A>) => void,
): void {
	for (const engineName of selectedEngines()) {
		const unsupported = options.unsupported?.[engineName];

		if (unsupported) {
			describe.skip(`${name} (${engineName}: ${unsupported})`, () => {
				it("is not supported on this engine", () => {});
			});

			continue;
		}

		if (!browserInstalled(engineName)) {
			const install = `npx playwright-core install ${engineName.replace("playwright-", "")}`;

			// Skipping keeps a plain install usable, but it also turns missing coverage into a green
			// run, so CI sets A11Y_PULSE_REQUIRE_BROWSERS to make the gap fail instead.
			if (browsersRequired()) {
				describe(`${name} (${engineName})`, () => {
					it("has its browser installed", () => {
						throw new Error(
							`No browser installed for ${engineName}, and A11Y_PULSE_REQUIRE_BROWSERS is set. Run \`${install}\`.`,
						);
					});
				});

				continue;
			}

			describe.skip(`${name} (${engineName}: browser not installed, run \`${install}\`)`, () => {
				it("has no browser installed", () => {});
			});

			continue;
		}

		describe(`${name} (${engineName})`, () => {
			let launched: LaunchedEngine<A>;

			beforeAll(async () => {
				launched = await launch(engineName, options);
			});

			afterAll(async () => {
				await launched.close();
			});

			body({
				name: engineName,
				driver: engineName === "puppeteer" ? "puppeteer" : "playwright",
				newPage: () => launched.newPage(),
			});
		});
	}
}
