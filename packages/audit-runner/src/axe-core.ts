import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import axe, { type AxeResults, type RunOptions } from "axe-core";

type AxeWindow = Window & { axe: typeof axe };

function injectAxeScript(source: string): void {
	// axe-core ships as a classic script, so it has to be evaluated rather than imported. The
	// page's own CSP does not apply: the automation library evaluates this out of band.
	new Function(source)();
}

function runAxeScript(options: RunOptions): Promise<AxeResults> {
	return (window as unknown as AxeWindow).axe.run(options);
}

/**
 * Inject axe-core into the page and run it.
 */
export async function runAxeCore(
	browser: BrowserAdaptor,
	options: RunOptions = {},
): Promise<AxeResults> {
	await browser.evaluate(injectAxeScript, axe.source);

	return browser.evaluate(runAxeScript, options);
}
