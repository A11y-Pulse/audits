import type { BrowserAdaptor } from "@a11y-pulse/browser-adaptor";
import { getSelector } from "@a11y-pulse/browser-adaptor/dom";
import {
	type ActiveElementInfo,
	activeElementHandleScript,
	type BaselinePayload,
	baselineScript,
	clearMarkersScript,
	elementStylesScript,
	hasFocusScript,
	heldFocusScript,
	markActiveElementScript,
	probeActiveElementScript,
} from "@a11y-pulse/tab-orchestrator";
import { vi } from "vitest";
import { locationHrefScript } from "../../tab-orchestrator/src/browser-scripts";
import { asEvaluate } from "./fake-evaluate";

export const STABLE_HREF = "https://example.test/";

const EMPTY_STYLES = { element: {}, before: {}, after: {} };

export type TabLoopScript = {
	/**
	 * Whether the page has focus when the session checks before each Tab press, by press. Also what
	 * the first check after that press answers, unless `focusAfterTab` says otherwise.
	 */
	focusBeforeTab?: boolean[];
	/** What the first focus check after each Tab press answers, by press. */
	focusAfterTab?: boolean[];
	/** What every later check after the same press answers, once the session has re-asserted focus. */
	restoresFocus?: boolean;
	/** What each probe of the focused element answers, in order. Past the end, nothing is focused. */
	active?: Array<Omit<ActiveElementInfo, "selector"> | null>;
	/** Why a repeated element held focus. Defaults to a control moving between its own parts. */
	heldFocus?: { prevented: boolean; followed: boolean };
	/** What the baseline answers. Defaults to no marked elements. */
	baseline?: BaselinePayload;
};

export function loopAdaptor(script: TabLoopScript): BrowserAdaptor {
	let activeCall = 0;
	let dynamicMarker: number | undefined;
	let stopIndex = -1;
	let tabbed = false;
	let readsSinceTab = 0;

	return {
		ensureFocusReporting: vi.fn(async () => {}),
		evaluate: asEvaluate(async (fn, ...args) => {
			if (fn === markActiveElementScript) {
				// One unmarked element per script: it keeps the marker it was first given.
				dynamicMarker ??= args[1] as number;

				return dynamicMarker;
			}

			if (fn === heldFocusScript) {
				return script.heldFocus ?? { prevented: false, followed: true };
			}

			if (fn === baselineScript) {
				return script.baseline ?? { styles: [EMPTY_STYLES], entries: [] };
			}

			if (fn === probeActiveElementScript) {
				tabbed = false;

				return (
					script.active?.[activeCall++] ?? {
						index: null,
						isBody: true,
						isIframe: false,
						html: "",
						styles: EMPTY_STYLES,
						rect: { x: 0, y: 0, width: 0, height: 0 },
					}
				);
			}

			if (fn === getSelector) {
				return "#fake";
			}

			if (fn === elementStylesScript) {
				return EMPTY_STYLES;
			}

			if (fn === clearMarkersScript) {
				return undefined;
			}

			if (fn === locationHrefScript) {
				return STABLE_HREF;
			}

			if (fn === hasFocusScript) {
				if (!tabbed) {
					return script.focusBeforeTab?.[stopIndex + 1] ?? false;
				}

				if (readsSinceTab++ > 0) {
					return script.restoresFocus ?? false;
				}

				return script.focusAfterTab?.[stopIndex] ?? script.focusBeforeTab?.[stopIndex] ?? false;
			}

			return false;
		}),
		async evaluateHandle(fn) {
			if (fn === activeElementHandleScript) {
				return { kind: "active" };
			}

			return {};
		},
		async disposeRef() {},
		async pressTab() {
			stopIndex++;
			tabbed = true;
			readsSinceTab = 0;
		},
		async pressEnter() {},
		async pressKey() {},
		async screenshotClip() {
			return new Uint8Array([1]);
		},
	};
}
