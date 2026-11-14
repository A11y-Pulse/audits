import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import axe, { type AxeResults, type RunOptions } from "axe-core";

type AxeWindow = Window & { axe?: typeof axe; Function: FunctionConstructor };

/**
 * Evaluate axe-core in the page and in every same-origin frame under it. axe-core tests a frame by
 * messaging the copy of itself inside it, so a frame without one is reported as `frame-tested`
 * needing review rather than being scanned.
 */
function injectAxeScript(source: string): void {
	const inject = (target: AxeWindow): void => {
		// axe-core ships as a classic script, so it has to be evaluated rather than imported. The
		// page's own CSP does not apply: the automation library evaluates this out of band.
		if (!target.axe) {
			new target.Function(source)();
		}

		for (const frame of Array.from(target.document.querySelectorAll("iframe, frame"))) {
			try {
				const child = (frame as HTMLIFrameElement).contentWindow as AxeWindow | null;

				// Reading `document` throws for a cross-origin frame, which axe-core then reports itself.
				if (child?.document) {
					inject(child);
				}
			} catch {}
		}
	};

	inject(window as unknown as AxeWindow);
}

function runAxeScript(options: RunOptions): Promise<AxeResults> {
	return (window as unknown as { axe: typeof axe }).axe.run(options);
}

/**
 * Inject axe-core into the page and its same-origin frames, and run it.
 */
export async function runAxeCore(
	browser: BrowserAdaptor,
	options: RunOptions = {},
): Promise<AxeResults> {
	await browser.evaluate(injectAxeScript, axe.source);

	return browser.evaluate(runAxeScript, options);
}
