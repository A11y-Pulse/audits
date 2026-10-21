import type { BrowserAdaptor } from "./adaptor";
import { getSelector } from "./get-selector";

type PickWindow = Window & { __a11yPulsePickedElement?: Element | null };

function pickStashedScript(stashKey: string, index: number): void {
	const stash = (window as unknown as Record<string, unknown>)[stashKey];

	(window as PickWindow).__a11yPulsePickedElement = Array.isArray(stash)
		? (stash[index] ?? null)
		: null;
}

function pickedElementScript(): Element | null {
	return (window as PickWindow).__a11yPulsePickedElement ?? null;
}

function releaseStashScript(stashKey: string): void {
	delete (window as unknown as Record<string, unknown>)[stashKey];
	delete (window as PickWindow).__a11yPulsePickedElement;
}

/**
 * Return a selector (see getSelector) for each element at `indices` of the array a page script
 * left on `window[stashKey]`.
 */
export async function stashedElementSelectors(
	adaptor: BrowserAdaptor,
	stashKey: string,
	indices: readonly number[],
): Promise<string[]> {
	const selectors: string[] = [];

	for (const index of indices) {
		await adaptor.evaluate(pickStashedScript, stashKey, index);
		const handle = await adaptor.evaluateHandle(pickedElementScript);

		try {
			selectors.push(await adaptor.evaluate(getSelector, handle));
		} finally {
			await adaptor.disposeRef(handle);
		}
	}

	return selectors;
}

/**
 * Remove the array on `window[stashKey]` from the page.
 */
export async function releaseStashedElements(
	adaptor: BrowserAdaptor,
	stashKey: string,
): Promise<void> {
	await adaptor.evaluate(releaseStashScript, stashKey);
}
