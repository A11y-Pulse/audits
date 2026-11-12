import { PlaywrightAdaptor } from "@a11y-pulse/browser-adaptor/playwright";
import { PuppeteerAdaptor } from "@a11y-pulse/browser-adaptor/puppeteer";
import { PlaywrightAdaptor as ReflowPlaywrightAdaptor } from "@a11y-pulse/reflow-audit/playwright";
import { PuppeteerAdaptor as ReflowPuppeteerAdaptor } from "@a11y-pulse/reflow-audit/puppeteer";
import { PlaywrightAdaptor as ResizeTextPlaywrightAdaptor } from "@a11y-pulse/resize-text-audit/playwright";
import { PuppeteerAdaptor as ResizeTextPuppeteerAdaptor } from "@a11y-pulse/resize-text-audit/puppeteer";
import { PlaywrightAdaptor as TextSpacingPlaywrightAdaptor } from "@a11y-pulse/text-spacing-audit/playwright";
import { PuppeteerAdaptor as TextSpacingPuppeteerAdaptor } from "@a11y-pulse/text-spacing-audit/puppeteer";
import type { UnreachableControlsAdaptor } from "@a11y-pulse/unreachable-controls-audit";
import { inspectElements as inspectWithPlaywright } from "@a11y-pulse/unreachable-controls-audit/playwright";
import { inspectElements as inspectWithPuppeteer } from "@a11y-pulse/unreachable-controls-audit/puppeteer";
import type { Page as PlaywrightPage } from "playwright-core";
import type { Page as PuppeteerPage } from "puppeteer";
import type { Browser, Engine } from "./cli-args";
import type { AuditAdaptors, ProgressCallback, WarningCallback } from "./run-audits";

const DEFAULT_VIEWPORT = { width: 1280, height: 800 };

// Puppeteer's `networkidle2`: no more than two connections open for 500ms.
const PUPPETEER_NETWORK_IDLE_CONCURRENCY = 2;

const SCREENSHOT_CLIP_SCALE = 2;

/** Milliseconds the page is given to fire its `load` event. */
export const DEFAULT_NAVIGATION_TIMEOUT = 30_000;

/**
 * The most the network is waited on to go quiet after `load`. A page that polls or holds a
 * connection open never does, and is audited as it stands once this has passed.
 */
export const MAX_IDLE_TIMEOUT = 10_000;

const HTML_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];

export type Session = {
	adaptors: AuditAdaptors;
	/** Close the browser. Safe to call more than once. */
	close: () => Promise<void>;
};

export type OpenPageOptions = {
	onProgress?: ProgressCallback;
	onWarning?: WarningCallback;
	/** Milliseconds to wait for the page's `load` event. Defaults to `DEFAULT_NAVIGATION_TIMEOUT`. */
	timeout?: number;
	/**
	 * Milliseconds to wait for the network to go quiet after `load` before auditing anyway. Defaults
	 * to `timeout`, capped at `MAX_IDLE_TIMEOUT`.
	 */
	idleTimeout?: number;
	/** Audit the page even when it answers with an HTTP error status or a non-HTML content type. */
	ignoreHttpErrors?: boolean;
};

type ResolvedOptions = Required<OpenPageOptions>;

/** The page could not be loaded as something worth auditing. */
export class PageLoadError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "PageLoadError";
	}
}

/**
 * Build every audit's adaptor around one Puppeteer page.
 */
export function puppeteerAdaptors(page: PuppeteerPage): AuditAdaptors {
	// The one adaptor that dismisses dialogs also answers the unreachable controls audit's
	// question about listeners, which only the browser can: a second adaptor on the same page would
	// dismiss every dialog twice. The runner owns the page, so dialogs are dismissed for the whole
	// run, not only while a tab session is under way.
	const browser: UnreachableControlsAdaptor = Object.assign(
		new PuppeteerAdaptor(page, { dismissDialogs: "always" }),
		{
			inspectElements: (stashKey: string, count: number, roles: readonly number[]) =>
				inspectWithPuppeteer(page, stashKey, count, roles),
		},
	);

	return {
		browser,
		unreachableControls: browser,
		reflow: new ReflowPuppeteerAdaptor(page),
		textSpacing: new TextSpacingPuppeteerAdaptor(page),
		resizeText: new ResizeTextPuppeteerAdaptor(page),
		navigate: async (url) => {
			await page.goto(url, { waitUntil: "load" });
		},
		isClosed: () => page.isClosed() || !page.browser().connected,
	};
}

/**
 * Build every audit's adaptor around one Playwright page.
 */
export function playwrightAdaptors(
	page: PlaywrightPage,
	screenshotClipScale?: number,
): AuditAdaptors {
	// Chromium only: Firefox and WebKit have no DevTools session, and the audit then goes by what
	// a page script can see.
	const browser: UnreachableControlsAdaptor = Object.assign(
		new PlaywrightAdaptor(page, { screenshotClipScale, dismissDialogs: "always" }),
		{
			inspectElements: (stashKey: string, count: number, roles: readonly number[]) =>
				inspectWithPlaywright(page, stashKey, count, roles),
		},
	);

	return {
		browser,
		unreachableControls: browser,
		reflow: new ReflowPlaywrightAdaptor(page),
		textSpacing: new TextSpacingPlaywrightAdaptor(page),
		resizeText: new ResizeTextPlaywrightAdaptor(page),
		navigate: async (url) => {
			await page.goto(url, { waitUntil: "load" });
		},
		isClosed: () => page.isClosed() || page.context().browser()?.isConnected() === false,
	};
}

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

function isTimeout(error: unknown): boolean {
	return error instanceof Error && error.name === "TimeoutError";
}

type LoadedResponse = { status: number; contentType: string | undefined };

/**
 * Why a response is not a page worth auditing, or `undefined` when it is one. An error page and a
 * browser's own viewer for JSON or plain text both audit cleanly, which says nothing about the site.
 */
export function responseProblem(url: string, response: LoadedResponse): string | undefined {
	if (response.status >= 400) {
		return `${url} responded with HTTP ${response.status}`;
	}

	const contentType = response.contentType?.split(";")[0]?.trim().toLowerCase();

	// No header at all leaves the browser to sniff the type, which is HTML more often than not.
	if (contentType && !HTML_CONTENT_TYPES.includes(contentType)) {
		return `${url} is ${contentType}, not an HTML page`;
	}

	return undefined;
}

function checkResponse(
	url: string,
	response: LoadedResponse | null,
	options: ResolvedOptions,
): void {
	const problem = response ? responseProblem(url, response) : undefined;

	if (problem === undefined) {
		return;
	}

	if (!options.ignoreHttpErrors) {
		throw new PageLoadError(`${problem}. Pass --ignore-http-errors to audit it anyway.`);
	}

	options.onWarning(`${problem}. Auditing it anyway.`);
}

async function navigationFailure(url: string, timeout: number, error: unknown): Promise<never> {
	if (isTimeout(error)) {
		throw new PageLoadError(
			`${url} did not finish loading within ${timeout}ms. Raise the limit with --timeout.`,
		);
	}

	throw error;
}

async function settle(wait: () => Promise<unknown>, options: ResolvedOptions): Promise<void> {
	options.onProgress("Waiting for network idle");

	try {
		await wait();
	} catch (error) {
		if (!isTimeout(error)) {
			throw error;
		}

		options.onWarning(
			`The network was still busy after ${options.idleTimeout}ms. Auditing the page as it stands.`,
		);
	}
}

/** Milliseconds a browser is given to close before it is killed, or left for the process to end. */
export const CLOSE_TIMEOUT = 5_000;

/**
 * Wrap `close` so a second call, from a signal handler racing the normal exit, is a no-op, and so
 * a browser that will not close cleanly (its page may be stuck in a loop) cannot hold the caller
 * up: after `CLOSE_TIMEOUT` it is killed with `kill`, where there is a way to.
 */
function closeOnce(close: () => Promise<void>, kill?: () => void): () => Promise<void> {
	let closing: Promise<void> | undefined;

	return () => {
		closing ??= new Promise<void>((resolve) => {
			const timer = setTimeout(() => {
				try {
					kill?.();
				} catch {}

				resolve();
			}, CLOSE_TIMEOUT);

			// A browser that is already gone has nothing left to close.
			close()
				.catch(() => {})
				.finally(() => {
					clearTimeout(timer);
					resolve();
				});
		});

		return closing;
	};
}

async function launchPuppeteer(url: string, options: ResolvedOptions): Promise<Session> {
	const { default: puppeteer } = await load<typeof import("puppeteer")>(
		"puppeteer",
		"npm install puppeteer",
	);

	options.onProgress("Launching Chrome");
	const browser = await puppeteer.launch({ defaultViewport: DEFAULT_VIEWPORT });
	const close = closeOnce(
		() => browser.close(),
		() => browser.process()?.kill("SIGKILL"),
	);

	try {
		const page = await browser.newPage();
		// Built before the page loads: the adaptor is what dismisses a dialog raised while loading,
		// which would otherwise block the navigation until it timed out.
		const adaptors = puppeteerAdaptors(page);

		options.onProgress("Loading page");
		const response = await page
			.goto(url, { waitUntil: "load", timeout: options.timeout })
			.catch((error) => navigationFailure(url, options.timeout, error));

		checkResponse(
			url,
			response && { status: response.status(), contentType: response.headers()["content-type"] },
			options,
		);

		await settle(
			() =>
				page.waitForNetworkIdle({
					concurrency: PUPPETEER_NETWORK_IDLE_CONCURRENCY,
					timeout: options.idleTimeout,
				}),
			options,
		);

		return { adaptors, close };
	} catch (error) {
		// Nothing else holds the browser yet, so a failure here would otherwise leave it running and
		// the process unable to exit.
		await close();

		throw error;
	}
}

async function launchPlaywright(
	url: string,
	browserName: Browser,
	options: ResolvedOptions,
): Promise<Session> {
	const playwright = await load<typeof import("playwright-core")>(
		"playwright-core",
		"npm install playwright-core && npx playwright-core install",
	);

	// Only Chromium re-scales screenshots. Other browsers should not attempt to capture at a
	// higher pixel density.
	const screenshotClipScale = browserName === "chromium" ? SCREENSHOT_CLIP_SCALE : 1;

	options.onProgress(`Launching ${browserName}`);
	const browser = await playwright[browserName].launch();
	const close = closeOnce(() => browser.close());

	try {
		const page = await browser.newPage({ viewport: DEFAULT_VIEWPORT });
		const adaptors = playwrightAdaptors(page, screenshotClipScale);

		options.onProgress("Loading page");
		const response = await page
			.goto(url, { waitUntil: "load", timeout: options.timeout })
			.catch((error) => navigationFailure(url, options.timeout, error));

		checkResponse(
			url,
			response && { status: response.status(), contentType: response.headers()["content-type"] },
			options,
		);

		await settle(
			() => page.waitForLoadState("networkidle", { timeout: options.idleTimeout }),
			options,
		);

		return { adaptors, close };
	} catch (error) {
		await close();

		throw error;
	}
}

/**
 * Launch the chosen engine, open `url`, and build the adaptors every audit is driven through.
 * Rejects with a `PageLoadError` when the page does not load, or loads as an error page or
 * something other than HTML.
 */
export function openPage(
	url: string,
	engine: Engine,
	browser: Browser,
	options: OpenPageOptions | ProgressCallback = {},
): Promise<Session> {
	const given = typeof options === "function" ? { onProgress: options } : options;
	const timeout = given.timeout ?? DEFAULT_NAVIGATION_TIMEOUT;
	const resolved: ResolvedOptions = {
		onProgress: given.onProgress ?? (() => {}),
		onWarning: given.onWarning ?? (() => {}),
		timeout,
		// 0 is "no limit" to both libraries, which for the idle wait would be a hang.
		idleTimeout: given.idleTimeout ?? Math.min(timeout || MAX_IDLE_TIMEOUT, MAX_IDLE_TIMEOUT),
		ignoreHttpErrors: given.ignoreHttpErrors ?? false,
	};

	return engine === "playwright"
		? launchPlaywright(url, browser, resolved)
		: launchPuppeteer(url, resolved);
}
