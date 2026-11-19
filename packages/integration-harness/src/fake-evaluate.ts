import type { BrowserAdaptor, PageFunction } from "@a11y-pulse/browser-adaptor";

export type EvaluateDispatch = (fn: PageFunction, ...args: unknown[]) => Promise<unknown>;

export function asEvaluate(dispatch: EvaluateDispatch): BrowserAdaptor["evaluate"] {
	return dispatch as BrowserAdaptor["evaluate"];
}

export function asDispatch(evaluate: BrowserAdaptor["evaluate"]): EvaluateDispatch {
	return evaluate as EvaluateDispatch;
}
