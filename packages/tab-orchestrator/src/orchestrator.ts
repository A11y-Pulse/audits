import type { BrowserAdaptor } from "./adaptor";
import type { TabConsumer } from "./types";

export const DEFAULT_SCREENSHOT_SETTLE_DELAY = 33;
export const DEFAULT_SCREENSHOT_CLIP_BUFFER = 10;
export const DEFAULT_MARKER_LIMIT = 1024;
export const MARKER_ATTR = "data-a11y-focus-idx";

export type TabSessionOptions = {
	screenshotSettleDelay?: number;
	screenshotClipBuffer?: number;
	markerLimit?: number;
	baselineElementLimit?: number;
};

export type TabOrchestrator = {
	attach(consumer: TabConsumer): void;
	run(): Promise<void>;
};

export function createTabOrchestrator(
	adaptor: BrowserAdaptor,
	options: TabSessionOptions = {},
): TabOrchestrator {
	const consumers: TabConsumer[] = [];
	let started = false;
	let ran = false;

	return {
		attach(consumer) {
			if (started) {
				throw new Error("Cannot attach after run() has started");
			}
			consumers.push(consumer);
		},
		async run() {
			if (ran) {
				throw new Error("run() has already been called");
			}
			ran = true;
			started = true;

			if (consumers.length === 0) {
				return;
			}

			void adaptor;
			void options;
			throw new Error("tab loop not implemented");
		},
	};
}
