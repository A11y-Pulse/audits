import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import { PlaywrightAdaptor as ReflowPlaywrightAdaptor } from "@a11y-pulse/reflow-audit/playwright";
import { PuppeteerAdaptor as ReflowPuppeteerAdaptor } from "@a11y-pulse/reflow-audit/puppeteer";
import { PlaywrightAdaptor as TextSpacingPlaywrightAdaptor } from "@a11y-pulse/text-spacing-audit/playwright";
import { PuppeteerAdaptor as TextSpacingPuppeteerAdaptor } from "@a11y-pulse/text-spacing-audit/puppeteer";
import type { Browser, Engine } from "./cli-args";
import type { AuditAdaptors } from "./run-audits";

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

export type Session = {
	adaptors: AuditAdaptors;
	close: () => Promise<void>;
};

async function load<T>(specifier: string, install: string): Promise<T> {
	try {
		return (await import(specifier)) as T;
	} catch (error) {
		// ERR_MODULE_NOT_FOUND also fires for a dependency missing further down, so only the code
		// plus a message naming this specifier means the engine itself is absent. Anything else is a
		// fault inside the module, which the caller needs to see verbatim.
		const missing =
			(error as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND" &&
			(error as Error).message.includes(specifier);

		if (!missing) {
			throw error;
		}

		throw new Error(`${specifier} is not installed. Run \`${install}\` and try again.`);
	}
}

async function launchPuppeteer(url: string): Promise<Session> {
	const { default: puppeteer } = await load<typeof import("puppeteer")>(
		"puppeteer",
		"npm install puppeteer",
	);

	const browser = await puppeteer.launch({ defaultViewport: DEFAULT_VIEWPORT });
	const page = await browser.newPage();
	await page.goto(url, { waitUntil: "networkidle2" });

	return {
		adaptors: {
			browser: new PuppeteerAdaptor(page),
			reflow: new ReflowPuppeteerAdaptor(page),
			textSpacing: new TextSpacingPuppeteerAdaptor(page),
		},
		close: () => browser.close(),
	};
}

async function launchPlaywright(url: string, browserName: Browser): Promise<Session> {
	const playwright = await load<typeof import("playwright-core")>(
		"playwright-core",
		"npm install playwright-core && npx playwright-core install",
	);

	const browser = await playwright[browserName].launch();
	const page = await browser.newPage({ viewport: DEFAULT_VIEWPORT });
	await page.goto(url, { waitUntil: "networkidle" });

	return {
		adaptors: {
			browser: new PlaywrightAdaptor(page),
			reflow: new ReflowPlaywrightAdaptor(page),
			textSpacing: new TextSpacingPlaywrightAdaptor(page),
		},
		close: () => browser.close(),
	};
}

/**
 * Launch the chosen engine, open `url`, and build the adaptors every audit is driven through.
 */
export function openPage(url: string, engine: Engine, browser: Browser): Promise<Session> {
	return engine === "playwright" ? launchPlaywright(url, browser) : launchPuppeteer(url);
}
